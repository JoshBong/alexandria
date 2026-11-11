// P0 proof of the auto-loop — control flow only, fully offline (no claude spawn).
//
// Proves the behaviors docs/auto-loop.md §10 lists for P0: ordered run,
// remove-on-done (locked prefix grows), buffer→replan at the boundary, locked-prefix
// immutability, every guard (attempt budget / watchdog / parked ceiling / hard
// ceiling / human STOP), and both exits (done / stuck). Every LLM seam is mocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';

import { runLoop } from '../src/loop/run.js';
import { runStep } from '../src/loop/step.js';
import { freshPlan, lockStep, unlockStep, lockedPrefix, unlockedTail } from '../src/loop/plan-store.js';
import { plan as planFn, replan as replanFn } from '../src/loop/plan.js';
import { appendInput, drainInbox, readInbox } from '../src/loop/inbox.js';
import { nextReady, doneConditionHolds, allRemainingBlocked, guardsTrip, isStop } from '../src/loop/guards.js';
import { localElaborate } from '../src/loop/elaborate.js';

const tmp = (n) => mkdtempSync(join(tmpdir(), `alex-loop-${n}-`));

// A mock step seam: every step's intent → a result, verify passes unless the intent
// is in `failing` (then it always misses → parks after the budget).
const passingHandle = async (prompt) => ({ text: `did: ${prompt}`, contextTokens: 0 });
const verifyExcept = (failing = []) => async (step) => ({
  pass: !failing.includes(step.intent),
  feedback: 'nope',
});

// ---- pure pieces ----

test('nextReady respects order and dependencies', () => {
  const p = freshPlan('t', 'g');
  p.steps = [
    { id: 's1', intent: 'a', deps: [], status: 'done' },
    { id: 's2', intent: 'b', deps: ['s3'], status: 'pending' }, // dep not done → blocked
    { id: 's3', intent: 'c', deps: ['s1'], status: 'pending' }, // dep done → ready
  ];
  assert.equal(nextReady(p).id, 's3');
});

test('done-condition + blocked detection', () => {
  const done = freshPlan('t', 'g');
  done.steps = [{ id: 's1', intent: 'a', status: 'done' }];
  assert.equal(doneConditionHolds(done), true);

  const blocked = freshPlan('t', 'g');
  blocked.steps = [{ id: 's1', intent: 'a', deps: ['sX'], status: 'pending' }];
  assert.equal(allRemainingBlocked(blocked), true);
});

test('locked prefix: lock/unlock partitions the plan', () => {
  const p = freshPlan('t', 'g');
  p.steps = [
    { id: 's1', intent: 'a', status: 'pending', locked: false },
    { id: 's2', intent: 'b', status: 'pending', locked: false },
  ];
  lockStep(p, 's1');
  assert.deepEqual(lockedPrefix(p).map((s) => s.id), ['s1']);
  assert.deepEqual(unlockedTail(p).map((s) => s.id), ['s2']);
  assert.equal(unlockStep(p, 's1'), true);
  assert.equal(lockedPrefix(p).length, 0);
});

test('inbox: append round-trips, drain advances the cursor', () => {
  const dir = tmp('inbox');
  appendInput('one', { dir, ts: 'x' });
  appendInput('two', { dir, ts: 'x' });
  assert.equal(readInbox({ dir }).length, 2);
  const first = drainInbox(0, { dir });
  assert.equal(first.drained.length, 2);
  assert.equal(first.cursor, 2);
  appendInput('three', { dir, ts: 'x' });
  const second = drainInbox(first.cursor, { dir });
  assert.deepEqual(second.drained.map((d) => d.raw), ['three']);
  rmSync(dir, { recursive: true, force: true });
});

test('STOP is recognized from a raw input', () => {
  assert.equal(isStop({ raw: 'stop' }), true);
  assert.equal(isStop({ raw: 'STOP' }), true);
  assert.equal(isStop({ raw: 'keep going' }), false);
});

test('guards: watchdog / parked ceiling / hard ceiling', () => {
  const p = freshPlan('t', 'g');
  assert.equal(guardsTrip(p, { boundariesSinceProgress: 3 }).tripped, true); // watchdog
  p.steps = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, status: 'parked' }));
  assert.equal(guardsTrip(p, {}).tripped, true); // parked ceiling (>5)
  assert.equal(guardsTrip(freshPlan('t', 'g'), { iterations: 200 }).tripped, true); // hard ceiling
});

// ---- step runner ----

test('runStep: passes first try → done in one attempt', async () => {
  const out = await runStep({ id: 's1', intent: 'a' }, { handle: passingHandle, verify: verifyExcept() });
  assert.equal(out.status, 'done');
  assert.equal(out.attempts, 1);
});

test('runStep: never-passing step parks after the attempt budget', async () => {
  let calls = 0;
  const handle = async (p) => { calls++; return { text: p, contextTokens: 0 }; };
  const out = await runStep({ id: 's1', intent: 'a' }, { handle, verify: verifyExcept(['a']), budget: 3 });
  assert.equal(out.status, 'parked');
  assert.equal(out.attempts, 3);
  assert.equal(calls, 3); // do→adjust→adjust
});

// ---- the driver, end to end ----

test('ordered run → success, locked prefix grows, plan persisted', async () => {
  const dir = tmp('run-ok');
  const res = await runLoop('build the thing', {
    dir,
    steps: ['step a', 'step b', 'step c'],
    handle: passingHandle,
    verify: verifyExcept(),
  });
  assert.equal(res.status, 'success');
  assert.equal(res.plan.steps.length, 3);
  assert.ok(res.plan.steps.every((s) => s.status === 'done' && s.locked));
  assert.ok(existsSync(join(dir, 'plan.json')));
  assert.ok(existsSync(join(dir, 'log.jsonl')));
  rmSync(dir, { recursive: true, force: true });
});

test('buffer → replan at the boundary weaves in a new step (prefix immutable)', async () => {
  const dir = tmp('run-replan');
  // Inject an input AFTER the first step would lock — appended up front, drained at
  // the first boundary. The locked prefix (s1) must not move; the new step appends.
  appendInput('add a safari lodge', { dir, ts: 'x' });
  const res = await runLoop('plan a trip', {
    dir,
    steps: ['book flights'],
    handle: passingHandle,
    verify: verifyExcept(),
    elaborate: localElaborate,
  });
  assert.equal(res.status, 'success');
  // s1 ran+locked first; the injected input became s2 and also ran to done.
  assert.equal(res.plan.steps[0].id, 's1');
  assert.equal(res.plan.steps[0].locked, true);
  assert.ok(res.plan.steps.length >= 2, 'injected input produced a new step');
  assert.ok(res.plan.steps.some((s) => s.origin && s.origin.startsWith('i')), 'new step carries input provenance');
  rmSync(dir, { recursive: true, force: true });
});

test('human STOP at the boundary → stuck exit', async () => {
  const dir = tmp('run-stop');
  appendInput('STOP', { dir, ts: 'x' });
  const res = await runLoop('long job', {
    dir,
    steps: ['s a', 's b', 's c'],
    handle: passingHandle,
    verify: verifyExcept(),
  });
  assert.equal(res.status, 'stuck');
  assert.match(res.reason, /STOP/);
  rmSync(dir, { recursive: true, force: true });
});

test('a parked step does not block success when nothing depends on it', async () => {
  const dir = tmp('run-park');
  // 'flaky' never verifies → parks; the others pass. Done-condition is "all done",
  // so a parked step means NOT done and nothing else ready → stuck (surfaced).
  const res = await runLoop('mixed', {
    dir,
    steps: ['ok1', 'flaky', 'ok2'],
    handle: passingHandle,
    verify: verifyExcept(['flaky']),
    budget: 2,
  });
  assert.equal(res.status, 'stuck');
  const flaky = res.plan.steps.find((s) => s.intent === 'flaky');
  assert.equal(flaky.status, 'parked');
  rmSync(dir, { recursive: true, force: true });
});

test('parked exit is immediate + reasoned, not a watchdog spin', async () => {
  const dir = tmp('run-park-fast');
  // 'flaky' parks; ok1/ok2 pass. The loop must exit the instant nothing is pending —
  // with a "N parked" reason — instead of spinning empty boundaries to the watchdog.
  const res = await runLoop('mixed', {
    dir,
    steps: ['ok1', 'flaky', 'ok2'],
    handle: passingHandle,
    verify: verifyExcept(['flaky']),
    budget: 2,
  });
  assert.equal(res.status, 'stuck');
  assert.match(res.reason, /1 step parked/); // clear cause, not "watchdog: no progress"
  assert.ok(res.iterations <= 4, `exited promptly (was ${res.iterations})`); // not watchdog-many
  rmSync(dir, { recursive: true, force: true });
});

test('unlockStep reopens a PARKED step (retry after the blocker clears)', () => {
  const p = freshPlan('t', 'g');
  p.steps = [{ id: 's1', intent: 'a', status: 'parked', locked: false }];
  assert.equal(unlockStep(p, 's1'), true);
  assert.equal(p.steps[0].status, 'pending');
  assert.equal(p.steps[0].locked, false);
});

test('replan preserves original step order when completion is out-of-order', async () => {
  // s1 unlocked (parked), s2 locked (done out of order). Replan must NOT hoist the
  // locked s2 ahead of the earlier s1 — every existing id keeps its slot.
  const p = freshPlan('t', 'g');
  p.steps = [
    { id: 's1', intent: 'a', status: 'parked', locked: false },
    { id: 's2', intent: 'b', status: 'done', locked: true },
  ];
  await replanFn(p, [{ id: 'i1', steps: ['c'] }]);
  assert.deepEqual(p.steps.map((s) => s.id), ['s1', 's2', 's3']); // order intact, new step appended
  assert.equal(p.steps[2].origin, 'i1');
});

test('resume: a saved plan is reloaded, not regenerated', async () => {
  const dir = tmp('run-resume');
  // First run completes; second run with the same dir reloads the done plan and exits
  // success immediately without re-planning (step count stays the same).
  await runLoop('resumable', { dir, steps: ['x', 'y'], handle: passingHandle, verify: verifyExcept() });
  const res = await runLoop('resumable', { dir, steps: ['DIFFERENT'], handle: passingHandle, verify: verifyExcept() });
  assert.equal(res.status, 'success');
  assert.equal(res.plan.steps.length, 2); // reloaded the 2-step plan, ignored the new seed
  rmSync(dir, { recursive: true, force: true });
});
