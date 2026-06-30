// The planner — `plan` (first call) and `replan` (every later call). Same job:
// produce an ordered step list given the goal + locked prefix + new intent. Split
// into two named exports because the call sites differ, but they share the revise
// discipline (docs/auto-loop.md §6):
//
// - Revise, don't regenerate. Touch only what the new input affects; keep the rest
//   stable — no gratuitous step-id churn, never move the in-flight step.
// - The locked prefix is FROZEN. replan reorders only the unlocked tail and appends
//   the steps the elaborated input decomposed into.
// - Forcing rework of a done step requires an explicit unlock surfaced to the human
//   (handled by the driver via plan-store.unlockStep), never a silent reorder.
//
// Live planning (opts.ask) is P1. P0 ships deterministic planners so the control
// flow — ordering, locked prefix, buffer→replan — is provable offline.

import { unlockedTail } from './plan-store.js';
import { compileContract } from './contract.js';

// Stable id generator for new steps: max existing numeric suffix + 1, so ids never
// collide across replans and the prefix keeps its ids.
function nextStepId(plan) {
  const max = plan.steps.reduce((m, s) => {
    const n = parseInt(String(s.id).replace(/^s/, ''), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `s${max + 1}`;
}

function makeStep(plan, intent, extra = {}) {
  const seed = typeof intent === 'string' ? { intent } : intent;
  const step = {
    id: nextStepId(plan),
    intent: seed.intent,
    deps: extra.deps || seed.deps || [],
    touches: extra.touches || seed.touches || [],
    status: 'pending',
    locked: false,
    attempts: 0,
    ...(seed.checks ? { checks: seed.checks } : {}),
    ...(seed.done ? { done: seed.done } : {}),
    ...(extra.origin ? { origin: extra.origin } : {}),
  };
  // Freeze the done-condition at plan time (g3): a step carries its contract so
  // completion is checked against it, not re-read from free text at run time.
  step.contract = compileContract(step, { riskPaths: extra.riskPaths });
  return step;
}

// FIRST call. Empty plan + goal → an ordered step list + the done predicate. Live,
// the planner decomposes the goal; if the goal has no checkable predicate it PROPOSES
// acceptance criteria and confirms once. P0: opts.steps seeds the list (tests/sim),
// or the goal becomes a single step. Mutates and returns `plan`.
export async function plan(planObj, opts = {}) {
  if (opts.ask) return liveplan(planObj, opts);
  const seeds = opts.steps || [planObj.goal];
  planObj.steps = [];
  for (const seed of seeds) planObj.steps.push(makeStep(planObj, seed));
  if (!planObj.done) planObj.done = opts.done || `all steps for: ${planObj.goal}`;
  planObj.cursor = 0;
  return planObj;
}

// LATER calls. Fold elaborated inputs into the UNLOCKED TAIL. Locked prefix untouched.
// Each elaborated input may carry several `steps` — all are appended, tagged with the
// input's origin id so provenance is traceable. P0 appends in order (a real reorder is
// a P1 planning decision); the invariant proven here is prefix-immutability + weave-in.
export async function replan(planObj, elaboratedInputs = [], opts = {}) {
  if (opts.ask) return liveReplan(planObj, elaboratedInputs, opts);
  const added = [];
  for (const input of elaboratedInputs) {
    for (const s of input.steps || []) {
      added.push(makeStep({ ...planObj, steps: [...planObj.steps, ...added] }, s, { origin: input.id }));
    }
  }
  // Append new steps to the end; every existing step keeps its slot in the ORIGINAL
  // order. (Revise, don't regenerate — no existing id moves. The old prefix/tail
  // re-partition reordered a locked step ahead of an earlier unlocked one when steps
  // completed out of order, which broke that invariant and would mislead a P1 planner
  // that trusts tail order.)
  planObj.steps = [...planObj.steps, ...added];
  return planObj;
}

// Live shapes (P1) — contract placeholders, not exercised in P0.
async function liveplan(planObj, opts) {
  const out = await opts.ask(
    `Decompose this goal into an ordered list of concrete steps, and state a single ` +
      `checkable done-condition. If the goal has no checkable predicate, propose ` +
      `acceptance criteria.\n\nGoal: ${planObj.goal}`,
  );
  planObj.raw = out; // P1 parses this into steps + done
  return planObj;
}
async function liveReplan(planObj, elaboratedInputs, opts) {
  await opts.ask(
    `Revise the unlocked tail of this plan to absorb new intent. Do NOT touch locked ` +
      `steps or move the in-flight step. Revise, don't regenerate.\n\nPlan: ` +
      `${JSON.stringify({ steps: unlockedTail(planObj) })}\n\nNew intent: ` +
      `${JSON.stringify(elaboratedInputs)}`,
  );
  return planObj;
}
