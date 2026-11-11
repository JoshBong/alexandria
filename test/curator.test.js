// g6 — curator. Pure, deterministic skill lifecycle: telemetry → active/stale/archived,
// archive-never-delete, restorable. `now` injected. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchSkill, classifySkill, curate, restore, STATUS, DEFAULT_CURATION } from '../src/memory/curator.js';

// ---- touchSkill ----

test('touchSkill: bumps the right counter and stamps last_activity', () => {
  let s = { name: 'x' };
  s = touchSkill(s, 'use', 10);
  assert.equal(s.uses, 1);
  assert.equal(s.last_activity, 10);
  s = touchSkill(s, 'patch', 12);
  assert.equal(s.patches, 1);
  assert.equal(s.uses, 1); // untouched
  assert.equal(s.last_activity, 12);
});

// ---- classifySkill ----

test('classifySkill: idle span drives active → stale → archived', () => {
  const opts = { now: 100, ...DEFAULT_CURATION };
  assert.equal(classifySkill({ last_activity: 95 }, opts), STATUS.ACTIVE); // idle 5
  assert.equal(classifySkill({ last_activity: 80 }, opts), STATUS.STALE); // idle 20 ≥ 14
  assert.equal(classifySkill({ last_activity: 40 }, opts), STATUS.ARCHIVED); // idle 60 ≥ 45
});

test('classifySkill: a well-used skill stays active despite idle (earned its keep)', () => {
  assert.equal(classifySkill({ last_activity: 0, uses: 5 }, { now: 1000 }), STATUS.ACTIVE);
});

test('classifySkill: missing last_activity is treated as now (no instant archive)', () => {
  assert.equal(classifySkill({ name: 'fresh' }, { now: 500 }), STATUS.ACTIVE);
});

// ---- curate ----

test('curate: reclassifies the set, counts by status, logs transitions', () => {
  const skills = [
    { name: 'hot', last_activity: 98, status: 'active' },
    { name: 'cooling', last_activity: 80, status: 'active' }, // → stale
    { name: 'cold', last_activity: 10, status: 'stale' }, // → archived
  ];
  const r = curate(skills, { now: 100 });
  assert.deepEqual(r.summary, { active: 1, stale: 1, archived: 1 });
  assert.deepEqual(r.transitions, [
    { name: 'cooling', from: 'active', to: 'stale' },
    { name: 'cold', from: 'stale', to: 'archived' },
  ]);
});

test('curate: never deletes — archived skills remain in the returned set', () => {
  const r = curate([{ name: 'ancient', last_activity: 0 }], { now: 1000 });
  assert.equal(r.skills.length, 1);
  assert.equal(r.skills[0].status, STATUS.ARCHIVED);
});

test('curate: returns new objects, does not mutate the input', () => {
  const input = [{ name: 'x', last_activity: 0 }];
  curate(input, { now: 1000 });
  assert.equal(input[0].status, undefined); // original untouched
});

// ---- restore ----

test('restore: an archived skill comes back active (archive is reversible)', () => {
  const archived = { name: 'x', status: STATUS.ARCHIVED, last_activity: 0 };
  const back = restore(archived, 200);
  assert.equal(back.status, STATUS.ACTIVE);
  assert.equal(back.last_activity, 200);
  // and re-curating keeps it active now that it's fresh
  assert.equal(classifySkill(back, { now: 205 }), STATUS.ACTIVE);
});
