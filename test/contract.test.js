// g3 — sprint contract. Freeze the done-condition at plan time; verify completion
// against it deterministically. Pure compile/verify + the step.js + plan.js wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileContract, verifyAgainstContract, contractVerify, DEFAULT_MAX_ITERATIONS } from '../src/loop/contract.js';
import { runStep } from '../src/loop/step.js';
import { plan as planFn } from '../src/loop/plan.js';
import { freshPlan } from '../src/loop/plan-store.js';

// ---- compileContract ----

test('compileContract: derives done/checks/ceiling/risk and is deep-frozen', () => {
  const c = compileContract(
    { id: 's1', intent: 'do the thing', touches: ['db/migrations/1.sql', 'src/a.js'], checks: ['tests pass', { id: 'lint', description: 'no lint errors' }] },
    { riskPaths: ['migrations'] },
  );
  assert.equal(c.definition_of_done, 'do the thing');
  assert.equal(c.max_iterations, DEFAULT_MAX_ITERATIONS);
  assert.deepEqual(c.risk_flags, ['db/migrations/1.sql']);
  assert.deepEqual(c.checks.map((x) => x.id), ['c1', 'lint']); // string→auto id, object keeps its id
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.checks));
  assert.throws(() => { c.max_iterations = 99; }, TypeError); // frozen: cannot soften the bar
});

test('compileContract: explicit done + budget override intent + default ceiling', () => {
  const c = compileContract({ id: 's', intent: 'i', done: 'EXPLICIT', budget: 7 });
  assert.equal(c.definition_of_done, 'EXPLICIT');
  assert.equal(c.max_iterations, 7);
  assert.deepEqual(c.checks, []);
  assert.deepEqual(c.risk_flags, []);
});

// ---- verifyAgainstContract ----

test('verifyAgainstContract: no checks → structural pass', () => {
  assert.deepEqual(verifyAgainstContract({ checks: [] }, {}), { pass: true });
});

test('verifyAgainstContract: all check ids satisfied → pass; missing → fail with ids', () => {
  const c = compileContract({ id: 's', intent: 'i', checks: [{ id: 'a' }, { id: 'b' }] });
  assert.deepEqual(verifyAgainstContract(c, { satisfied: ['a', 'b'] }), { pass: true });
  const miss = verifyAgainstContract(c, { satisfied: ['a'] });
  assert.equal(miss.pass, false);
  assert.match(miss.feedback, /unmet contract checks: b/);
});

// ---- step.js wiring ----

test('runStep: a contract gates completion — fails until every check is satisfied', async () => {
  const step = { id: 's', intent: 'i', contract: compileContract({ id: 's', intent: 'i', checks: [{ id: 'a' }] }) };
  let n = 0;
  // attempt 1 satisfies nothing, attempt 2 satisfies 'a'
  const handle = async () => { n++; return { text: 'x', satisfied: n >= 2 ? ['a'] : [] }; };
  const out = await runStep(step, { handle, budget: 5 });
  assert.equal(out.status, 'done');
  assert.equal(out.attempts, 2);
});

test('runStep: contract max_iterations is the budget when none injected', async () => {
  const step = { id: 's', intent: 'i', contract: compileContract({ id: 's', intent: 'i', budget: 2, checks: [{ id: 'a' }] }) };
  let n = 0;
  const handle = async () => { n++; return { text: 'x', satisfied: [] }; }; // never satisfies
  const out = await runStep(step, { handle });
  assert.equal(out.status, 'parked');
  assert.equal(out.attempts, 2); // honored the contract ceiling, not the default 3
  assert.equal(out.reason, 'budget');
});

test('runStep: an injected verify still wins over the contract (tests/domains)', async () => {
  const step = { id: 's', intent: 'i', contract: compileContract({ id: 's', intent: 'i', checks: [{ id: 'a' }] }) };
  const handle = async () => ({ text: 'x', satisfied: [] }); // contract would fail
  const out = await runStep(step, { handle, verify: async () => ({ pass: true }) });
  assert.equal(out.status, 'done'); // injected verify overrode the contract
});

// ---- plan.js integration ----

test('plan: every compiled step carries a frozen contract', async () => {
  const p = freshPlan('t', 'ship the feature');
  await planFn(p, { steps: ['step one', 'step two'] });
  for (const s of p.steps) {
    assert.ok(s.contract, `${s.id} has a contract`);
    assert.ok(Object.isFrozen(s.contract));
    assert.equal(s.contract.definition_of_done, s.intent);
  }
});
