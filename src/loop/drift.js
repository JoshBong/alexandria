// g2 — Typed drift alerts. The canary catches QUALITY drift (the Keeper's answers
// degrade → reseed); these catch GOAL drift (the loop wanders off its plan or budget).
// Five pure predicates over the boundary state; run.js emits whatever fires and surfaces
// criticals. Pure → provable offline, no clock/cost dependency baked in.
//
// (← claude-code-harness scripts/progress-detect-drift.sh, schema progress-alert.v1.)

export const DRIFT_THRESHOLDS = {
  timeWarn: 1.5, // elapsed / estimate
  timeCritical: 2.0,
  failCritical: 3, // parked/failed steps at the plan level (the per-step budget bounds one step)
  costWarn: 0.8, // spent / budget
};

const alert = (type, severity, detail) => ({ type, severity, detail });
const uniq = (xs) => [...new Set(xs || [])];

// scope-creep: the loop touched a target no planned step declared. Work is happening
// outside the plan's surface — the classic "while I'm here…" wander.
export function scopeCreep(plan, touched = []) {
  const planned = new Set((plan?.steps || []).flatMap((s) => s.touches || []));
  if (planned.size === 0) return null; // no declared surface → nothing to creep past
  const stray = uniq(touched).filter((t) => !planned.has(t));
  if (!stray.length) return null;
  return alert('scope-creep', 'warn', `touched ${stray.length} target(s) absent from the plan: ${stray.join(', ')}`);
}

// time-overrun: elapsed past 1.5x estimate (warn) / 2x (critical). No estimate → silent.
export function timeOverrun(elapsed, estimate, t = DRIFT_THRESHOLDS) {
  if (!estimate || !elapsed) return null;
  const ratio = elapsed / estimate;
  if (ratio >= t.timeCritical) return alert('time-overrun', 'critical', `elapsed ${ratio.toFixed(1)}x estimate`);
  if (ratio >= t.timeWarn) return alert('time-overrun', 'warn', `elapsed ${ratio.toFixed(1)}x estimate`);
  return null;
}

// repeated-failure: failures have reached the plan-level threshold. The attempt budget
// bounds ONE step; this surfaces the pattern (≥3 parks) before the parked-ceiling guard
// halts the plan (>5) — a warning shot, not a kill.
export function repeatedFailure(failCount, t = DRIFT_THRESHOLDS) {
  if ((failCount || 0) < t.failCritical) return null;
  return alert('repeated-failure', 'critical', `${failCount} failed/parked steps`);
}

// cost-warning: spent ≥ 80% of budget (warn), ≥ 100% (critical). Surface before the wall.
export function costWarning(cost, budget, t = DRIFT_THRESHOLDS) {
  if (!budget || !cost) return null;
  const frac = cost / budget;
  if (frac >= 1) return alert('cost-warning', 'critical', `spent ${(frac * 100).toFixed(0)}% of budget`);
  if (frac >= t.costWarn) return alert('cost-warning', 'warn', `spent ${(frac * 100).toFixed(0)}% of budget`);
  return null;
}

// high-risk-path: the loop touched a target on the caller-supplied risk list (secrets,
// migrations, auth, infra). Always critical — a human should lay eyes on it.
export function highRiskPath(touched = [], riskPaths = []) {
  if (!riskPaths.length) return null;
  const hits = uniq(touched).filter((t) => riskPaths.some((r) => t.includes(r)));
  if (!hits.length) return null;
  return alert('high-risk-path', 'critical', `touched high-risk path(s): ${hits.join(', ')}`);
}

// Run every predicate; return the alerts that fired, in a stable order (deterministic
// logs). run.js logs these at the boundary and surfaces any critical.
export function detectDrift(signals = {}, opts = {}) {
  const t = { ...DRIFT_THRESHOLDS, ...(opts.thresholds || {}) };
  const { plan, touched = [], elapsed, estimate, failCount, cost, budget, riskPaths = [] } = signals;
  return [
    scopeCreep(plan, touched),
    timeOverrun(elapsed, estimate, t),
    repeatedFailure(failCount, t),
    costWarning(cost, budget, t),
    highRiskPath(touched, riskPaths),
  ].filter(Boolean);
}
