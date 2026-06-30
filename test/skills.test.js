// The skill store — flat-file .md skills with curator telemetry in frontmatter. Real
// filesystem in a tmp dir; `now` injected for deterministic curation. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createSkillStore } from '../src/memory/skills.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'alex-skills-'));
let t = 100;
const clock = () => t;

test('create → list → get round-trips, name is slugged', async () => {
  const dir = tmp();
  const s = createSkillStore({ dir, now: clock });
  await s.create({ name: 'Batch Parallel Calls', body: 'do the thing' });
  const list = await s.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'batch-parallel-calls');
  const got = await s.get('batch parallel calls');
  assert.equal(got.body, 'do the thing');
  assert.equal(got.status, 'active');
  rmSync(dir, { recursive: true, force: true });
});

test('patch bumps the patch counter + last_activity, keeps the record', async () => {
  const dir = tmp();
  const s = createSkillStore({ dir, now: clock });
  await s.create({ name: 'x', body: 'v1' });
  t = 200;
  await s.patch('x', { body: 'v2' });
  const got = await s.get('x');
  assert.equal(got.body, 'v2');
  assert.equal(got.patches, 2); // create stamps 1, patch → 2
  assert.equal(got.last_activity, 200);
  rmSync(dir, { recursive: true, force: true });
});

test('patch on a missing skill creates it (fork is robust to a stale list)', async () => {
  const dir = tmp();
  const s = createSkillStore({ dir, now: clock });
  await s.patch('brand-new', { body: 'fresh' });
  assert.equal((await s.get('brand-new')).body, 'fresh');
  rmSync(dir, { recursive: true, force: true });
});

test('touch records usage telemetry', async () => {
  const dir = tmp();
  const s = createSkillStore({ dir, now: clock });
  await s.create({ name: 'x', body: 'b' });
  t = 300;
  await s.touch('x', 'use');
  const got = await s.get('x');
  assert.equal(got.uses, 1);
  assert.equal(got.last_activity, 300);
  rmSync(dir, { recursive: true, force: true });
});

test('curate reclassifies in place and NEVER deletes the file', async () => {
  const dir = tmp();
  t = 0;
  const s = createSkillStore({ dir, now: clock });
  await s.create({ name: 'ancient', body: 'old' }); // last_activity 0
  t = 1000; // far past archiveAfter
  const { summary } = await s.curate();
  assert.equal(summary.archived, 1);
  const got = await s.get('ancient');
  assert.equal(got.status, 'archived'); // marked, not gone
  assert.match(readFileSync(join(s.root, 'ancient.md'), 'utf8'), /status: archived/);
  rmSync(dir, { recursive: true, force: true });
});

test('frontmatter round-trips through a fresh store instance (durable)', async () => {
  const dir = tmp();
  t = 500;
  await createSkillStore({ dir, now: clock }).create({ name: 'persisted', body: 'survives' });
  const reopened = createSkillStore({ dir, now: clock });
  const got = await reopened.get('persisted');
  assert.equal(got.body, 'survives');
  assert.equal(got.last_activity, 500);
  rmSync(dir, { recursive: true, force: true });
});
