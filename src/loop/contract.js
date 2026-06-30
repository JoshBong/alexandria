// g3 — Sprint contract: freeze each step's done-condition BEFORE it runs, so "did this
// step finish" is a deterministic check against a frozen contract, not a re-reading of
// free text. The canary still judges QUALITY (do the answers degrade); the contract
// judges COMPLETION (are the declared checks met). Pure → provable offline.
//
// (← claude-code-harness go/internal/hookhandler/sprint_contract.go — a frozen
//  definition-of-done + checks the hook verifies output against, not a free-text goal.)

export const DEFAULT_MAX_ITERATIONS = 3; // mirrors step.js DEFAULT_ATTEMPT_BUDGET

// Compile a step into a frozen contract. Pure: derives the done-condition, the check
// list, the iteration ceiling, and the risk flags from the step, then deep-freezes so
// nothing downstream can soften the bar mid-run. A check is either a string (→ auto id)
// or { id, description }. risk_flags = the step's touches that match the risk list.
export function compileContract(step = {}, opts = {}) {
  const checks = (step.checks || []).map((c, i) =>
    Object.freeze(
      typeof c === 'string'
        ? { id: `c${i + 1}`, description: c }
        : { id: c.id || `c${i + 1}`, description: c.description || '' },
    ),
  );
  const riskPaths = opts.riskPaths || [];
  const risk_flags = [...new Set(step.touches || [])].filter((t) => riskPaths.some((r) => t.includes(r)));
  return Object.freeze({
    stepId: step.id,
    definition_of_done: step.done || step.intent || '',
    checks: Object.freeze(checks),
    max_iterations: step.budget ?? opts.budget ?? DEFAULT_MAX_ITERATIONS,
    risk_flags: Object.freeze(risk_flags),
  });
}

// Verify a result against a frozen contract — the deterministic completion check. Every
// contract check id must appear in result.satisfied (what the producer claims it met). A
// contract with no checks falls back to the structural default (pass), matching the
// loop's offline-provable default so an uncontracted step behaves exactly as before.
export function verifyAgainstContract(contract = {}, result = {}) {
  const checks = contract.checks || [];
  if (checks.length === 0) return { pass: true };
  const satisfied = new Set(result.satisfied || []);
  const missing = checks.filter((c) => !satisfied.has(c.id));
  if (missing.length === 0) return { pass: true };
  return { pass: false, feedback: `unmet contract checks: ${missing.map((c) => c.id).join(', ')}` };
}

// Adapt a contract into the step.js verify seam: (step, result) → { pass, feedback }.
export function contractVerify(contract) {
  return async (_step, result) => verifyAgainstContract(contract, result);
}
