// g4 — independent reviewer seam. The producer never self-ratifies: a done step is
// reviewed before it locks. Pure pickReviewer + reviewStep + the run.js gate. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { pickReviewer, reviewStep } from '../src/loop/review.js';
import { runLoop } from '../src/loop/run.js';
import { lockedPrefix } from '../src/loop/plan-store.js';

const tmp = (n) => mkdtempSync(join(tmpdir(), `alex-rev-${n}-`));
const roster = ['ptah', 'thoth', 'ra'];

// ---- pickReviewer ----

test('pickReviewer: returns a Keeper different from the producer', () => {
  assert.equal(pickReviewer('ptah', roster), 'thoth');
  assert.equal(pickReviewer('thoth', roster), 'ptah');
});

test('pickReviewer: accepts {id} objects, falls back to null on empty roster', () => {
  assert.equal(pickReviewer('ptah', [{ id: 'ra' }, { id: 'ptah' }]), 'ra');
  assert.equal(pickReviewer('ptah', []), null);
  assert.equal(pickReviewer('ptah', ['ptah']), 'ptah'); // degenerate single-Keeper roster
});

// ---- reviewStep ----

test('reviewStep: no reviewer wired → approves (P0 no-op)', async () => {
  const v = await reviewStep({ keeper: 'ptah', intent: 'i' }, { text: 'x' }, { roster });
  assert.equal(v.approved, true);
  assert.equal(v.reviewer, 'thoth');
});

test('reviewStep: routes a read-only payload to a DIFFERENT Keeper', async () => {
  let seen = null;
  const v = await reviewStep(
    { keeper: 'ptah', intent: 'build the thing', contract: { definition_of_done: 'done', checks: [{ id: 'a' }] } },
    { text: 'result', touched: ['src/a.js'], satisfied: ['a'] },
    { roster, review: async (p) => { seen = p; return { approved: true }; } },
  );
  assert.equal(v.approved, true);
  assert.equal(seen.reviewer, 'thoth');
  assert.equal(seen.producer, 'ptah');
  assert.equal(seen.definition_of_done, 'done');
  assert.deepEqual(seen.result.touched, ['src/a.js']);
});

test('reviewStep: a boolean or {approved:false} verdict is honored', async () => {
  assert.equal((await reviewStep({}, {}, { review: async () => false })).approved, false);
  const r = await reviewStep({}, {}, { review: async () => ({ approved: false, notes: 'shaky' }) });
  assert.equal(r.approved, false);
  assert.equal(r.notes, 'shaky');
});

// ---- run.js gate ----

const steps = ['only step'];

test('runLoop: an approving reviewer lets the step lock → success', async () => {
  const dir = tmp('ok');
  const res = await runLoop('g', {
    dir, loopId: 'rev-ok', persist: false,
    plan: async (p) => { p.steps = [{ id: 's1', intent: 'a', deps: [], status: 'pending', locked: false }]; p.done = 'd'; },
    handle: async () => ({ text: 'did it' }),
    verify: async () => ({ pass: true }),
    roster, review: async () => ({ approved: true }),
  });
  assert.equal(res.status, 'success');
  assert.deepEqual(lockedPrefix(res.plan).map((s) => s.id), ['s1']);
  rmSync(dir, { recursive: true, force: true });
});

test('runLoop: a rejecting reviewer blocks the lock → step parks, not locked', async () => {
  const dir = tmp('reject');
  const res = await runLoop('g', {
    dir, loopId: 'rev-no', persist: false,
    plan: async (p) => { p.steps = [{ id: 's1', intent: 'a', deps: [], status: 'pending', locked: false }]; p.done = 'd'; },
    handle: async () => ({ text: 'did it' }),
    verify: async () => ({ pass: true }),
    roster, review: async () => ({ approved: false, notes: 'not convinced' }),
  });
  assert.equal(res.status, 'stuck'); // parked, surfaced — never locked on the producer's word
  assert.match(res.reason, /parked/);
  assert.equal(lockedPrefix(res.plan).length, 0);
  assert.equal(res.plan.steps[0].status, 'parked');
  assert.equal(res.plan.steps[0].reviewReason, 'not convinced');
  rmSync(dir, { recursive: true, force: true });
});
