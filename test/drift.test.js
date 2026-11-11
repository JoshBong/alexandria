// g2 — typed drift alerts. Five pure goal-drift predicates + the aggregate. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scopeCreep, timeOverrun, repeatedFailure, costWarning, highRiskPath, detectDrift, DRIFT_THRESHOLDS,
} from '../src/loop/drift.js';

const planWith = (...touchesPerStep) => ({ steps: touchesPerStep.map((t, i) => ({ id: `s${i}`, touches: t })) });

// ---- scope-creep ----

test('scopeCreep: a target outside every planned step fires a warn', () => {
  const plan = planWith(['src/a.js'], ['src/b.js']);
  const a = scopeCreep(plan, ['src/a.js', 'src/ROGUE.js']);
  assert.equal(a.type, 'scope-creep');
  assert.equal(a.severity, 'warn');
  assert.match(a.detail, /ROGUE/);
});

test('scopeCreep: only planned targets → null', () => {
  assert.equal(scopeCreep(planWith(['src/a.js']), ['src/a.js']), null);
});

test('scopeCreep: a plan with no declared surface never fires', () => {
  assert.equal(scopeCreep({ steps: [{ id: 's0' }] }, ['anything']), null);
  assert.equal(scopeCreep({}, ['anything']), null);
});

// ---- time-overrun ----

test('timeOverrun: 1.5x warn, 2x critical, under → null', () => {
  assert.equal(timeOverrun(15, 10).severity, 'warn');
  assert.equal(timeOverrun(20, 10).severity, 'critical');
  assert.equal(timeOverrun(12, 10), null);
});

test('timeOverrun: missing estimate or elapsed → null (no false alarm)', () => {
  assert.equal(timeOverrun(100, 0), null);
  assert.equal(timeOverrun(0, 100), null);
});

// ---- repeated-failure ----

test('repeatedFailure: ≥3 → critical, fewer → null', () => {
  assert.equal(repeatedFailure(3).severity, 'critical');
  assert.equal(repeatedFailure(2), null);
  assert.equal(repeatedFailure(0), null);
});

// ---- cost-warning ----

test('costWarning: ≥80% warn, ≥100% critical, under → null', () => {
  assert.equal(costWarning(80, 100).severity, 'warn');
  assert.equal(costWarning(100, 100).severity, 'critical');
  assert.equal(costWarning(50, 100), null);
});

// ---- high-risk-path ----

test('highRiskPath: a touched target matching the risk list → critical', () => {
  const a = highRiskPath(['src/a.js', 'infra/secrets.tf'], ['secrets', 'migrations']);
  assert.equal(a.severity, 'critical');
  assert.match(a.detail, /secrets/);
});

test('highRiskPath: no risk list or no hit → null', () => {
  assert.equal(highRiskPath(['src/a.js'], []), null);
  assert.equal(highRiskPath(['src/a.js'], ['secrets']), null);
});

// ---- aggregate ----

test('detectDrift: returns only the predicates that fired, in stable order', () => {
  const plan = planWith(['src/a.js']);
  const alerts = detectDrift({
    plan,
    touched: ['src/a.js', 'db/migrations/001.sql'],
    failCount: 4,
    riskPaths: ['migrations'],
  });
  const types = alerts.map((a) => a.type);
  assert.deepEqual(types, ['scope-creep', 'repeated-failure', 'high-risk-path']);
});

test('detectDrift: a quiet boundary (planned touches, no fails) → no alerts', () => {
  assert.deepEqual(detectDrift({ plan: planWith(['src/a.js']), touched: ['src/a.js'], failCount: 0 }), []);
});

test('detectDrift: thresholds overridable via opts', () => {
  const alerts = detectDrift({ failCount: 2 }, { thresholds: { ...DRIFT_THRESHOLDS, failCritical: 2 } });
  assert.deepEqual(alerts.map((a) => a.type), ['repeated-failure']);
});
