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
import { extractJson } from './parse.js';

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

// Live planner (P1). Ask the model for a JSON plan, parse it into steps, and fail soft
// to a single goal-step if the model returns nothing usable (a live turn must never
// leave the loop with an empty plan).
const PLAN_SHAPE =
  `Return ONLY JSON: {"done":"<single checkable done-condition>","steps":[{"intent":"<concrete step>",` +
  `"touches":["<file or surface>"],"checks":["<verifiable check>"],"deps":["<prior step intent or index>"]}]}. ` +
  `touches/checks/deps are optional. Order the steps; keep them concrete and minimal.`;

async function liveplan(planObj, opts) {
  const out = await opts.ask(`Decompose this goal into an ordered plan.\n\nGoal: ${planObj.goal}\n\n${PLAN_SHAPE}`);
  const parsed = extractJson(out);
  const seeds = parsed && Array.isArray(parsed.steps) && parsed.steps.length ? parsed.steps : [planObj.goal];
  planObj.steps = [];
  for (const seed of seeds) planObj.steps.push(makeStep(planObj, normalizeSeed(seed), { riskPaths: opts.riskPaths }));
  planObj.done = (parsed && parsed.done) || planObj.done || opts.done || `all steps for: ${planObj.goal}`;
  planObj.cursor = 0;
  return planObj;
}

// Live replan (P1). Same revise discipline as the deterministic path — the model only
// ever sees the UNLOCKED tail + the new intent, and whatever steps it returns are
// appended (prefix-immutability is enforced structurally by the driver/plan-store, not
// trusted to the model). Fail-soft: unparseable → fold the raw intents as steps.
async function liveReplan(planObj, elaboratedInputs, opts) {
  const out = await opts.ask(
    `Revise the unlocked tail to absorb new intent. Do NOT restate locked/in-flight steps — ` +
      `return ONLY the NEW steps to append.\n\nUnlocked tail: ${JSON.stringify(unlockedTail(planObj).map((s) => s.intent))}` +
      `\n\nNew intent: ${JSON.stringify(elaboratedInputs.map((e) => e.said || e))}\n\n` +
      `Return ONLY JSON: {"steps":[{"intent":"...","touches":[],"checks":[],"deps":[]}]}.`,
  );
  const parsed = extractJson(out);
  const newSteps = parsed && Array.isArray(parsed.steps) ? parsed.steps : null;
  if (newSteps && newSteps.length) {
    for (const s of newSteps) planObj.steps.push(makeStep(planObj, normalizeSeed(s), { riskPaths: opts.riskPaths }));
  } else {
    // Model gave nothing usable — don't drop the human's intent on the floor; fold each
    // elaborated input's decomposed steps in deterministically.
    for (const input of elaboratedInputs) {
      for (const seed of input.steps || [{ intent: input.said || String(input) }]) {
        planObj.steps.push(makeStep(planObj, normalizeSeed(seed), { origin: input.id, riskPaths: opts.riskPaths }));
      }
    }
  }
  return planObj;
}

// A model-emitted step may be a string or an object; makeStep wants {intent,...}. We
// keep touches/checks but DROP any model-supplied deps: P0 deps are step IDs, and a
// model returns deps as intent-strings/indices that wouldn't resolve — an unresolvable
// dep deadlocks the guards. Emit ORDER is the ordering in P1; id-based dep resolution at
// the planner boundary is a later refinement.
function normalizeSeed(seed) {
  if (typeof seed === 'string') return { intent: seed };
  return { intent: seed.intent || seed.step || '', touches: seed.touches, checks: seed.checks };
}
