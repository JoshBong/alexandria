// g1 — plateau detector (the second per-step kill-switch). Pure Jaccard + the step.js
// wiring that parks a thrashing step early. Fully offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jaccard, isPlateau, attemptTargets, DEFAULT_PLATEAU } from '../src/loop/plateau.js';
import { runStep } from '../src/loop/step.js';

// ---- jaccard ----

test('jaccard: identical sets = 1, disjoint = 0', () => {
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1);
  assert.equal(jaccard(['a'], ['b']), 0);
});

test('jaccard: partial overlap = intersection/union', () => {
  // {a,b,c} ∩ {b,c,d} = {b,c}=2 ; ∪ = {a,b,c,d}=4 → 0.5
  assert.equal(jaccard(['a', 'b', 'c'], ['b', 'c', 'd']), 0.5);
});

test('jaccard: two empty sets are 0, not 1 (no signal ≠ identical)', () => {
  assert.equal(jaccard([], []), 0);
  assert.equal(jaccard(new Set(), new Set()), 0);
});

test('jaccard: accepts Sets or arrays interchangeably', () => {
  assert.equal(jaccard(new Set(['a', 'b']), ['a', 'b']), 1);
});

// ---- isPlateau ----

test('isPlateau: sustained high overlap across the window → true', () => {
  const h = [['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']];
  assert.equal(isPlateau(h, { window: 3, threshold: 0.7 }), true);
});

test('isPlateau: one low-overlap pair in the window breaks it', () => {
  // last two attempts are disjoint → not a plateau even if earlier ones matched
  const h = [['a', 'b'], ['a', 'b'], ['x', 'y']];
  assert.equal(isPlateau(h, { window: 3, threshold: 0.7 }), false);
});

test('isPlateau: fewer attempts than the window → false', () => {
  assert.equal(isPlateau([['a']], { window: 2 }), false);
  assert.equal(isPlateau([], { window: 2 }), false);
});

test('isPlateau: an empty target set in the window breaks the plateau', () => {
  assert.equal(isPlateau([['a', 'b'], []], { window: 2, threshold: 0.7 }), false);
});

test('isPlateau: default window=2, threshold=0.7 trips on a high-overlap pair', () => {
  assert.equal(DEFAULT_PLATEAU.window, 2);
  // {a,b,c,d} vs {a,b,c,e}: ∩=3 ∪=5 → 0.6 < 0.7 → no plateau
  assert.equal(isPlateau([['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'e']]), false);
  // {a,b,c,d} vs {a,b,c} : ∩=3 ∪=4 → 0.75 ≥ 0.7 → plateau
  assert.equal(isPlateau([['a', 'b', 'c', 'd'], ['a', 'b', 'c']]), true);
});

// ---- attemptTargets ----

test('attemptTargets: reads .touched, falls back to .targets, else empty', () => {
  assert.deepEqual([...attemptTargets({ touched: ['a', 'b'] })], ['a', 'b']);
  assert.deepEqual([...attemptTargets({ targets: ['c'] })], ['c']);
  assert.equal(attemptTargets({}).size, 0);
  assert.equal(attemptTargets({ touched: 'not-an-array' }).size, 0);
});

// ---- step.js wiring ----

const failVerify = async () => ({ pass: false, feedback: 'nope' });

test('runStep: thrashing the same targets parks early with reason=plateau', async () => {
  let calls = 0;
  const handle = async () => { calls++; return { text: 'x', touched: ['src/a.js'] }; };
  const out = await runStep({ id: 's', intent: 'a' }, { handle, verify: failVerify, budget: 5 });
  assert.equal(out.status, 'parked');
  assert.equal(out.reason, 'plateau');
  assert.equal(out.attempts, 2); // window=2 → trips after the 2nd identical touch, saving 3
  assert.equal(calls, 2);
});

test('runStep: attempts touching DIFFERENT targets never plateau → parks on budget', async () => {
  let calls = 0;
  const handle = async () => { calls++; return { text: 'x', touched: [`src/file${calls}.js`] }; };
  const out = await runStep({ id: 's', intent: 'a' }, { handle, verify: failVerify, budget: 3 });
  assert.equal(out.status, 'parked');
  assert.equal(out.reason, 'budget'); // moved ground each attempt → ran the full budget
  assert.equal(out.attempts, 3);
});

test('runStep: no touch-data (mock cycles) never trips the plateau switch', async () => {
  let calls = 0;
  const handle = async (p) => { calls++; return { text: p }; }; // no touched/targets
  const out = await runStep({ id: 's', intent: 'a' }, { handle, verify: failVerify, budget: 3 });
  assert.equal(out.status, 'parked');
  assert.equal(out.reason, 'budget');
  assert.equal(calls, 3);
});

test('runStep: a passing step still returns done (plateau never masks success)', async () => {
  const handle = async () => ({ text: 'x', touched: ['src/a.js'] });
  const out = await runStep({ id: 's', intent: 'a' }, { handle, verify: async () => ({ pass: true }) });
  assert.equal(out.status, 'done');
  assert.equal(out.reason, undefined);
});
