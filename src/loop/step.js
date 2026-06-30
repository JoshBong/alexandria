// The step runner — the inner cycle `do → verify-against-ground-truth → adjust`,
// bounded by an attempt budget (docs/auto-loop.md §1, §9).
//
// `do`     — run the step's intent as one Pharos turn (reuses handle()). Mid-step is
//            sacred: this never checks the inbox or replans.
// `verify` — check the result against the Keeper's ground truth (Ptah: tests; Thoth:
//            rubric/source; Ra: inbox/calendar reality). Domain-pluggable; injected.
// `adjust` — on a verify miss, feed the failure back and re-do, until pass or the
//            budget (N attempts) is spent → park the step and move on.
//
// Domain-agnostic by construction: it calls `handle` and `verify`, both injected, so
// P0 proves the cycle with mocks and no claude spawn. Returns the step's outcome; it
// does NOT mutate the plan (the driver marks/locks at the boundary).

import { isPlateau, attemptTargets } from './plateau.js';

export const DEFAULT_ATTEMPT_BUDGET = 3;

// Run one step to a terminal outcome. opts:
//   handle(prompt, ctx) → { text, contextTokens, compacting, degraded, touched, ... }
//   verify(step, result, ctx) → { pass, feedback }  (ground-truth check; default: always pass)
//   budget — max attempts before parking (default 3)
//   plateau — { window, threshold } override for the thrash kill-switch (default plateau.js)
// Returns: { status: 'done'|'parked', attempts, result, verify, signals, reason? }
//   reason on a park: 'plateau' (thrashing the same targets) | 'budget' (attempts spent).
export async function runStep(step, opts = {}) {
  const handle = opts.handle || (async (p) => ({ text: `(mock) ${p}` }));
  const verify = opts.verify || (async () => ({ pass: true }));
  const budget = opts.budget ?? DEFAULT_ATTEMPT_BUDGET;

  let attempts = 0;
  let result = null;
  let check = null;
  let feedback = null;
  const touchHistory = []; // the SET of targets each attempt touched, in order

  while (attempts < budget) {
    attempts += 1;
    // `do` — the step prompt is its intent; on a retry, append the verify feedback so
    // the Keeper adjusts rather than repeating. The warm thread holds prior attempts.
    const prompt = feedback ? `${step.intent}\n\nPrevious attempt failed: ${feedback}` : step.intent;
    result = await handle(prompt, { keeper: step.keeper, step });

    // `verify` against ground truth.
    check = await verify(step, result, { attempt: attempts });
    if (check && check.pass) {
      return { status: 'done', attempts, result, verify: check, signals: pickSignals(result) };
    }
    feedback = check ? check.feedback : 'verification failed';

    // Plateau kill-switch — if the retries keep thrashing the same targets, parking now
    // beats burning the rest of the budget on the same corner (budget bounds count, this
    // bounds churn). No touch-data → never trips, so mock cycles are unaffected.
    touchHistory.push(attemptTargets(result));
    if (isPlateau(touchHistory, opts.plateau)) {
      return { status: 'parked', attempts, result, verify: check, signals: pickSignals(result), reason: 'plateau' };
    }
  }

  // Budget spent without a pass → park (parking counts as progress; the watchdog,
  // not this, catches a plan that goes nowhere).
  return { status: 'parked', attempts, result, verify: check, signals: pickSignals(result), reason: 'budget' };
}

// The freshness-relevant signals handle() already returns — the driver reads these at
// the boundary to decide whether to reseed (it does NOT re-derive them).
function pickSignals(result = {}) {
  return {
    contextTokens: result.contextTokens || 0,
    compacting: !!result.compacting,
    degraded: !!result.degraded,
    redone: !!result.redone,
  };
}
