// Guards & termination — pure predicates over a plan + loop state.
//
// Two exit categories only: DONE (success) and STUCK (surfaced failure). The
// per-step attempt budget lives in step.js (it bounds one step); the guards here
// bound the PLAN. The progress watchdog is the real infinite-loop kill: per-step
// budgets stop one step spinning, only the watchdog stops the plan spinning
// (replan churn, park/unpark oscillation). Parking counts as progress, so a
// genuinely hard step doesn't trip it — a loop going nowhere does (docs §8).

// Default guard limits. Overridable per-loop via opts.
export const DEFAULT_GUARDS = {
  watchdog: 3, // boundaries with no step → done/parked before halting the plan
  parkedCeiling: 5, // > this many parked steps → escalate
  hardCeiling: 200, // total-step backstop, never expected to hit
};

// A step is ready when it's pending and every dep is done. (deps reference step ids.)
const depsSatisfied = (step, plan) =>
  (step.deps || []).every((d) => {
    const dep = plan.steps.find((s) => s.id === d);
    return dep && dep.status === 'done';
  });

// The next step to run: first pending step (in order) whose deps are satisfied.
export function nextReady(plan) {
  return plan.steps.find((s) => s.status === 'pending' && depsSatisfied(s, plan)) || null;
}

// Done by default = every step done. A real done-condition is a domain/LLM check
// (opts.doneCheck) over the goal predicate; P0 uses the structural default so the
// control flow is provable offline.
export function doneConditionHolds(plan, opts = {}) {
  if (opts.doneCheck) return !!opts.doneCheck(plan);
  return plan.steps.length > 0 && plan.steps.every((s) => s.status === 'done');
}

// Stuck-by-blocking: there ARE pending steps, but none is ready — every pending
// step has an unsatisfied dep (a dep that's parked or itself blocked). A structural
// dead-end, distinct from the watchdog's spin.
export function allRemainingBlocked(plan) {
  const pending = plan.steps.filter((s) => s.status === 'pending');
  return pending.length > 0 && nextReady(plan) === null;
}

// No step is pending — every step has reached a terminal outcome (done or parked).
// When this holds but the done-condition doesn't, the only non-done steps are PARKED:
// the driver should surface that immediately instead of spinning empty boundaries until
// the watchdog trips (which mislabels a finished-with-parks run as a generic stall).
export const noPendingSteps = (plan) => plan.steps.length > 0 && !plan.steps.some((s) => s.status === 'pending');

const parkedCount = (plan) => plan.steps.filter((s) => s.status === 'parked').length;

// Do the plan-level guards trip? `state.boundariesSinceProgress` is the watchdog
// counter (reset whenever a step reaches done/parked); `state.iterations` backs the
// hard ceiling. Returns { tripped, reason } — reason is surfaced to the human.
export function guardsTrip(plan, state = {}, opts = {}) {
  const g = { ...DEFAULT_GUARDS, ...(opts.guards || {}) };
  if ((state.boundariesSinceProgress || 0) >= g.watchdog) {
    return { tripped: true, reason: `watchdog: ${g.watchdog} boundaries with no progress` };
  }
  if (parkedCount(plan) > g.parkedCeiling) {
    return { tripped: true, reason: `parked ceiling: ${parkedCount(plan)} > ${g.parkedCeiling}` };
  }
  if ((state.iterations || 0) >= g.hardCeiling) {
    return { tripped: true, reason: `hard ceiling: ${g.hardCeiling} iterations` };
  }
  return { tripped: false, reason: null };
}

// Human STOP — the one interrupt that preempts the loop. In P0 it's detected at the
// boundary when drained; mid-step preemption arrives with async stdin in P4.
export const STOP = 'STOP';
export const isStop = (input) => String(input?.raw ?? input ?? '').trim().toUpperCase() === STOP;
