// g4 — Independent reviewer seam. A finished step does NOT lock into the prefix on the
// producer's own say-so; it's first routed to a DIFFERENT warm Keeper for an independent,
// read-only, structured verdict. The producer never self-ratifies — that's the failure
// mode where a model grades its own homework and always passes itself.
//
// Mock-first + loop-decoupled: opts.review(payload) is the injected verdict call (a mock
// in tests; a warm-Keeper turn when P2 wires it live), and opts.roster is the injected
// Keeper list — the loop stays domain-agnostic, never hard-importing the registry. No
// reviewer wired → the gate approves (P0 no-op, so control flow is provable offline).
//
// (← claude-code-harness agents/reviewer.md — a read-only reviewer returning a verdict.)

// Pick an independent reviewer: a different Keeper than the producer. Falls back to any
// Keeper, then null (a degenerate/empty roster — the gate still runs, just can't be made
// independent; live wiring always passes a real multi-Keeper roster).
export function pickReviewer(producerKeeper, roster = []) {
  const ids = roster.map((k) => (typeof k === 'string' ? k : k && k.id)).filter(Boolean);
  const others = ids.filter((id) => id !== producerKeeper);
  return others[0] || ids[0] || null;
}

// Normalize whatever the injected reviewer returns into { approved, notes }. A missing
// reviewer fail-softs to approved (never block a lock because the seam wasn't wired).
function normalizeVerdict(raw) {
  if (raw == null) return { approved: true, notes: '' };
  if (typeof raw === 'boolean') return { approved: raw, notes: '' };
  return { approved: raw.approved !== false, notes: raw.notes || raw.feedback || '' };
}

// Review one finished step before it locks. Returns { approved, reviewer, notes }. The
// payload is READ-ONLY: the reviewer sees the step + result, never mutates them.
export async function reviewStep(step = {}, result = {}, opts = {}) {
  const reviewer = pickReviewer(step.keeper, opts.roster);
  if (!opts.review) return { approved: true, reviewer, notes: 'no reviewer wired (P0 no-op)' };
  const payload = {
    reviewer,
    producer: step.keeper || null,
    intent: step.intent,
    definition_of_done: step.contract && step.contract.definition_of_done,
    checks: (step.contract && step.contract.checks) || [],
    result: { text: result.text, touched: result.touched, satisfied: result.satisfied },
  };
  const verdict = normalizeVerdict(await opts.review(payload));
  return { ...verdict, reviewer };
}
