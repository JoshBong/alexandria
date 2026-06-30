// g5 — self-writing review (the headline). A forked reflection authors/patches skills
// through a skills store ONLY, never the live plan, with the three anti-poisoning rules
// enforced on output. Offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  isPoisoned, poisonReason, normalizeSkillName, screenSkill, chooseAction, selfWrite,
} from '../src/loop/selfwrite.js';
import { runLoop } from '../src/loop/run.js';

const tmp = (n) => mkdtempSync(join(tmpdir(), `alex-sw-${n}-`));

// A mock memory+skill store: the ONLY capability the fork is whitelisted to.
function mockSkills(seed = []) {
  const store = new Map(seed.map((s) => [s.name, s]));
  return {
    store,
    async list() { return [...store.values()]; },
    async create(s) { store.set(s.name, { ...s, created: true }); },
    async patch(name, s) { store.set(name, { ...(store.get(name) || {}), ...s, patched: true }); },
  };
}

// ---- rule 1: anti-poison screen ----

test('isPoisoned: transient-failure and env-specific claims are caught', () => {
  assert.ok(isPoisoned('the test is broken'));
  assert.ok(isPoisoned('permission denied on the socket'));
  assert.ok(isPoisoned('see /Users/jhuang/secret.txt'));
  assert.ok(isPoisoned('connect to 192.168.1.4'));
  assert.ok(isPoisoned('this failed twice'));
  assert.equal(isPoisoned('how to batch parallel agent calls'), false);
  assert.equal(poisonReason('a clean reusable skill'), null);
});

test('screenSkill: poison in name or body is rejected with a reason', () => {
  assert.equal(screenSkill({ name: 'good-skill', body: 'reusable steps' }).ok, true);
  assert.equal(screenSkill({ name: 'thing-is-broken', body: '' }).ok, false);
  assert.equal(screenSkill({ name: 'ok', body: 'error: ENOENT at /home/x' }).ok, false);
  assert.equal(screenSkill({ name: '', body: 'x' }).ok, false); // ungeneralizable name
});

// ---- rule 2: class-level naming ----

test('normalizeSkillName: kebab-cases to a generic slug', () => {
  assert.equal(normalizeSkillName('Batch Parallel Calls'), 'batch-parallel-calls');
  assert.equal(normalizeSkillName('  weird__Name!! '), 'weird-name');
});

// ---- rule 3: patch-before-create ----

test('chooseAction: exact name → patch, near-duplicate → patch, novel → create', () => {
  const existing = [{ name: 'parallel-agent-calls' }];
  assert.deepEqual(chooseAction({ name: 'Parallel Agent Calls' }, existing), { action: 'patch', name: 'parallel-agent-calls' });
  // {parallel,agent,calls} vs {parallel,agent,batching}: 2/4 = 0.5 < 0.6 → create
  assert.equal(chooseAction({ name: 'parallel agent batching' }, existing).action, 'create');
  // {parallel,agent,calls} vs {parallel,agent,call}: needs ≥0.6 — identical-but-one token
  assert.equal(chooseAction({ name: 'parallel agent calls now' }, existing).action, 'patch'); // 3/4=0.75
  assert.equal(chooseAction({ name: 'totally-new-thing' }, existing).action, 'create');
});

// ---- selfWrite orchestration ----

test('selfWrite: no fork wired → no-op', async () => {
  const r = await selfWrite({ goal: 'g' }, {});
  assert.equal(r.ran, false);
  assert.deepEqual(r.applied, []);
});

test('selfWrite: authors clean skills, drops poisoned ones, patches existing', async () => {
  const skills = mockSkills([{ name: 'existing-skill', body: 'old' }]);
  const ask = async () => ([
    { name: 'New Capability', body: 'reusable steps' },        // → create
    { name: 'existing skill', body: 'better' },                // → patch (exact)
    { name: 'flaky-thing', body: 'the server is broken' },     // → dropped (poison body)
  ]);
  const r = await selfWrite({ goal: 'g', lastStep: { id: 's1', intent: 'i' } }, { ask, skills });
  assert.equal(r.ran, true);
  assert.deepEqual(r.applied, [
    { name: 'new-capability', action: 'create' },
    { name: 'existing-skill', action: 'patch' },
  ]);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /anti-poison/);
  assert.equal(skills.store.get('new-capability').created, true);
  assert.equal(skills.store.get('existing-skill').patched, true);
});

test('selfWrite: the fork sees existing skill names + the anti-poison rules, not the plan', async () => {
  const skills = mockSkills([{ name: 'a' }, { name: 'b' }]);
  let payload = null;
  await selfWrite({ goal: 'ship it' }, { ask: async (p) => { payload = p; return []; }, skills });
  assert.deepEqual(payload.existingSkills, ['a', 'b']);
  assert.equal(payload.goal, 'ship it');
  assert.ok(payload.rules.some((r) => /broken|transient|environment/i.test(r)));
  assert.equal(payload.plan, undefined); // never handed the live plan
});

// ---- run.js boundary integration ----

test('runLoop: self-write runs at the boundary and NEVER mutates the live plan', async () => {
  const dir = tmp('run');
  const skills = mockSkills();
  let sawSnapshot = null;
  const res = await runLoop('g', {
    dir, loopId: 'sw-run', persist: false,
    plan: async (p) => { p.steps = [{ id: 's1', intent: 'build x', deps: [], status: 'pending', locked: false }]; p.done = 'd'; },
    handle: async () => ({ text: 'did it' }),
    verify: async () => ({ pass: true }),
    selfwrite: async (snap) => { sawSnapshot = snap; return [{ name: 'learned-pattern', body: 'reusable' }]; },
    skills,
  });
  assert.equal(res.status, 'success');
  assert.equal(res.plan.steps[0].status, 'done'); // the step locked normally
  assert.equal(res.plan.steps[0].body, undefined); // self-write did NOT touch the step
  assert.equal(sawSnapshot.lastStep.id, 's1'); // it got a read-only snapshot, not the plan
  assert.equal(skills.store.has('learned-pattern'), true); // the skill landed in the store only
  rmSync(dir, { recursive: true, force: true });
});
