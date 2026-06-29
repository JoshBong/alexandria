// The loop driver — runs a SEQUENCE of Pharos turns toward a goal, replanning as the
// human injects ideas, until the done-condition holds or a guard trips.
//
// Pharos already runs ONE turn against a warm Keeper (handle()); this runs a loop of
// them. It is a thin orchestrator: it does not re-implement session management,
// compaction, or memory — it calls handle() per step (via the step runner) and reads
// the signals handle() already returns. See docs/auto-loop.md §2, §7.
//
// The boundary is the only checkpoint. Mid-step is sacred — inputs buffer and are
// drained only after a step finishes, in order: freshness reseed → drain + elaborate +
// replan the unlocked tail → next ready step. A quiet boundary just advances.
//
// Everything that would spawn `claude` is injected (handle / plan / replan / elaborate
// / verify / reseed), so the whole control flow is provable offline (P0). Live wiring
// is P1–P4.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loopPaths } from './paths.js';
import { loadPlan, savePlan, freshPlan, lockStep } from './plan-store.js';
import { drainInbox } from './inbox.js';
import { plan as planFn, replan as replanFn } from './plan.js';
import { makeElaborator } from './elaborate.js';
import { runStep } from './step.js';
import {
  nextReady,
  doneConditionHolds,
  allRemainingBlocked,
  guardsTrip,
  isStop,
} from './guards.js';
import { isTokenLow } from '../pharos/tokens.js';

// One durable line per step/boundary, to the loop's own log.jsonl (reuses logEvent's
// shape). Best-effort + gated on persist, like pharos/events.js.
function logLoop(event, ctx) {
  if (!ctx.persist) return;
  try {
    const file = ctx.paths.log;
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), loopId: ctx.loopId, ...event }) + '\n');
  } catch {
    /* instrumentation must never break the loop */
  }
}

// Freshness at the boundary: the canary/token signals handle() already surfaced this
// step. Low freshness → reseed before the next step. The canary becomes a
// machine-checked second-line drift trigger here (autonomous loops kill the human
// eyeball, so drift must be caught at the boundary, not left to ride to auto-compact).
function freshnessLow(signals = {}) {
  return signals.degraded || signals.compacting || isTokenLow(signals.contextTokens || 0);
}

// runLoop(goal, opts) → { status, plan, reason, iterations }
//   status: 'success' | 'stuck'
// Injectable seams (all default to the real modules; tests/sims pass mocks):
//   opts.handle, opts.verify   → step runner
//   opts.plan, opts.replan     → planner (default the deterministic P0 planners)
//   opts.elaborate / opts.ask  → input elaborator
//   opts.reseed                → freshness reseed (P2 wires handoff.js; P0 no-op)
//   opts.guards                → guard limits
//   opts.dir / opts.loopId     → loop state location
//   opts.persist               → write plan/log to disk (default true)
export async function runLoop(goal, opts = {}) {
  const loopId = opts.loopId || 'default';
  const paths = loopPaths(loopId, opts);
  const persist = opts.persist ?? true;
  const ctx = { loopId, paths, persist };

  const elaborate = opts.elaborate || makeElaborator({ ask: opts.ask });
  const doPlan = opts.plan || planFn;
  const doReplan = opts.replan || replanFn;
  const reseed = opts.reseed || (() => {}); // P0: no-op; P2 reuses handoff.js

  // Load an existing plan (resume) or build a fresh one and run the first planning pass.
  let plan = (persist && loadPlan(loopId, opts)) || freshPlan(loopId, goal, opts);
  if (plan.steps.length === 0) {
    await doPlan(plan, opts);
    if (persist) savePlan(plan, opts);
    logLoop({ event: 'plan', steps: plan.steps.length, done: plan.done }, ctx);
  }

  const state = { iterations: 0, boundariesSinceProgress: 0 };

  while (true) {
    state.iterations += 1;

    const step = nextReady(plan);

    // Nothing ready → are we done, or dead-ended?
    if (!step) {
      if (doneConditionHolds(plan, opts)) return exit('success', 'done-condition holds', plan, state, ctx);
      if (allRemainingBlocked(plan)) return exit('stuck', 'all remaining steps blocked', plan, state, ctx);
      // No ready step, not done, not blocked: only inbox input can unblock. Fall
      // through to the boundary so a buffered input can replan; if the boundary adds
      // nothing, the watchdog/blocked guard will halt.
    }

    let signals = {};
    if (step) {
      step.attempts = (step.attempts || 0) + 0; // touched at the boundary mark
      plan.cursor = plan.steps.indexOf(step);
      const outcome = await runStep(step, opts);
      // Mark + lock at the boundary (the only place the plan mutates for a step).
      step.attempts = outcome.attempts;
      if (outcome.status === 'done') {
        lockStep(plan, step.id); // done → locked prefix grows
      } else {
        step.status = 'parked'; // parked counts as progress (a hard step, not a spin)
      }
      signals = outcome.signals || {};
      state.boundariesSinceProgress = 0; // a step reached a terminal outcome → progress
      if (persist) savePlan(plan, opts);
      logLoop({ event: 'step', id: step.id, status: step.status, attempts: step.attempts }, ctx);
    } else {
      // A boundary with no step ran is a non-progress boundary — the watchdog ticks.
      state.boundariesSinceProgress += 1;
    }

    // ---- BOUNDARY ----
    // 1. freshness → reseed if drifting (clean context first, then replan into it)
    if (freshnessLow(signals)) {
      await reseed({ plan, signals, loopId });
      logLoop({ event: 'reseed', signals }, ctx);
    }

    // 2. drain the buffer (batched) → STOP check → elaborate → replan the unlocked tail
    const { drained, cursor } = drainInbox(plan.inboxDrained || 0, opts);
    if (drained.some(isStop)) {
      logLoop({ event: 'stop', via: 'inbox' }, ctx);
      return exit('stuck', 'human STOP', plan, state, ctx);
    }
    if (drained.length) {
      const elaborated = [];
      for (const input of drained) elaborated.push(await elaborate(input, { goal: plan.goal }));
      await doReplan(plan, elaborated, opts);
      plan.inboxDrained = cursor;
      if (persist) savePlan(plan, opts);
      logLoop({ event: 'replan', folded: drained.length, steps: plan.steps.length }, ctx);
    } else {
      plan.inboxDrained = cursor; // keep the cursor current even on a quiet boundary
    }

    // 3. guards (the watchdog is the real infinite-loop kill)
    const g = guardsTrip(plan, state, opts);
    if (g.tripped) return exit('stuck', g.reason, plan, state, ctx);

    if (persist) savePlan(plan, opts);
  }
}

function exit(status, reason, plan, state, ctx) {
  logLoop({ event: 'exit', status, reason, iterations: state.iterations }, ctx);
  return { status, reason, plan, iterations: state.iterations };
}
