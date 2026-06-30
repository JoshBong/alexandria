// Live adapter layer (P2/P3 + live g4/g5). Every primitive (handle/askOnce/runCheck) is
// injected — no claude spawn. Proves the wiring + the full live loop end-to-end on fakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  makeLiveAsk, makeLiveHandle, makeDomainVerify, makeLiveReview, makeLiveSelfwrite, makeLiveLoopOpts,
} from '../src/loop/live.js';
import { runLoop } from '../src/loop/run.js';
import { createSkillStore } from '../src/memory/skills.js';

const tmp = (n) => mkdtempSync(join(tmpdir(), `alex-live-${n}-`));

// ---- makeLiveHandle: maps handle()'s return + threads a shared warm reg ----

test('makeLiveHandle: maps the rich return down to loop signals + stamps producer', async () => {
  const fakeHandle = async () => ({ routed: 'ptah', text: 'done', contextTokens: 42, compacting: true });
  const h = makeLiveHandle({ handle: fakeHandle, ask: async () => '', persist: false, reg: { sessions: {} } });
  const r = await h('do it', {});
  assert.equal(r.text, 'done');
  assert.equal(r.keeper, 'ptah'); // producer stamped for the reviewer
  assert.equal(r.contextTokens, 42);
  assert.equal(r.compacting, true);
});

test('makeLiveHandle: the SAME reg is threaded across calls (warm Keepers persist)', async () => {
  const reg = { sessions: {} };
  const fakeHandle = async (_p, o) => { o.reg.sessions.ptah = { sessionId: 's1' }; return { routed: 'ptah', text: 'x' }; };
  const h = makeLiveHandle({ handle: fakeHandle, ask: async () => '', persist: false, reg });
  await h('one', {});
  assert.ok(reg.sessions.ptah); // first call warmed it
  let sawWarm = false;
  const h2 = makeLiveHandle({ handle: async (_p, o) => { sawWarm = !!o.reg.sessions.ptah; return { routed: 'ptah', text: 'y' }; }, ask: async () => '', persist: false, reg });
  await h2('two', {});
  assert.equal(sawWarm, true); // second call saw the warm session
});

// ---- makeDomainVerify: the per-Keeper ground-truth table ----

test('makeDomainVerify: a step check COMMAND is run (pass on exit 0)', async () => {
  let ran = null;
  const verify = makeDomainVerify({ runCheck: async (cmd) => { ran = cmd; return true; } });
  const r = await verify({ check: 'npm test' }, {});
  assert.equal(ran, 'npm test');
  assert.equal(r.pass, true);
  // a second verify with a failing runner → fail with feedback
  const verify2 = makeDomainVerify({ runCheck: async () => false });
  assert.equal((await verify2({ test: 'pytest' }, {})).pass, false);
});

test('makeDomainVerify: per-Keeper verifier, then contract, then structural fallback', async () => {
  const verifiers = { thoth: async () => ({ pass: false, feedback: 'rubric miss' }) };
  const verify = makeDomainVerify({ verifiers });
  assert.equal((await verify({}, { keeper: 'thoth' })).pass, false); // keeper verifier
  assert.equal((await verify({}, { error: true })).pass, false); // structural: errored
  assert.equal((await verify({}, { keeper: 'ra', text: 'ok' })).pass, true); // structural: clean
});

test('makeDomainVerify: contract enforced only when the result reports satisfied (else structural)', async () => {
  const contract = { checks: [{ id: 'a' }] };
  const verify = makeDomainVerify({});
  // no satisfied signal (handle() never surfaces it) → structural pass, NOT an auto-park
  assert.equal((await verify({ contract }, { text: 'answered' })).pass, true);
  // a producer that DOES report satisfaction → the contract gates as designed
  assert.equal((await verify({ contract }, { satisfied: ['a'] })).pass, true);
  assert.equal((await verify({ contract }, { satisfied: [] })).pass, false);
});

test('makeDomainVerify: an injected assess grades the contract live (g3 armed)', async () => {
  const contract = { checks: [{ id: 'a' }, { id: 'b' }] };
  // assess stands in for the live grader: it returns the met check ids from the output.
  const verify = makeDomainVerify({ assess: async (checks, result) => (result.text.includes('done') ? ['a', 'b'] : ['a']) });
  assert.equal((await verify({ contract }, { text: 'all done' })).pass, true);  // both met → lock
  const miss = await verify({ contract }, { text: 'partial' });
  assert.equal(miss.pass, false);                          // b unmet → parked
  assert.match(miss.feedback, /b/);
  // a producer-reported satisfied still wins without calling assess
  let assessed = false;
  const verify2 = makeDomainVerify({ assess: async () => { assessed = true; return []; } });
  assert.equal((await verify2({ contract }, { satisfied: ['a', 'b'] })).pass, true);
  assert.equal(assessed, false);
  // assess throwing → fail-soft to structural, never an auto-park
  const verify3 = makeDomainVerify({ assess: async () => { throw new Error('boom'); } });
  assert.equal((await verify3({ contract }, { text: 'x' })).pass, true);
});

// ---- makeLiveReview / makeLiveSelfwrite ----

test('makeLiveReview: parses a verdict, fail-soft to approved on junk', async () => {
  const ok = makeLiveReview({ askOnce: async () => '{"approved":false,"notes":"thin"}' });
  assert.deepEqual(await ok({ reviewer: 'thoth', result: {} }), { approved: false, notes: 'thin' });
  const junk = makeLiveReview({ askOnce: async () => 'I think it is fine' });
  assert.equal((await junk({ reviewer: 'thoth', result: {} })).approved, true);
});

test('makeLiveSelfwrite: extracts skills array, [] on junk', async () => {
  const sw = makeLiveSelfwrite({ askOnce: async () => '{"skills":[{"name":"X","body":"y"}]}' });
  assert.deepEqual(await sw({ rules: [], existingSkills: [] }), [{ name: 'X', body: 'y' }]);
  const none = makeLiveSelfwrite({ askOnce: async () => 'nothing reusable' });
  assert.deepEqual(await none({ rules: [], existingSkills: [] }), []);
});

// ---- the assembled live loop, end-to-end on injected primitives ----

test('makeLiveLoopOpts: full live loop runs a planned goal to success, writes a skill', async () => {
  const dir = tmp('e2e');
  const skills = createSkillStore({ dir: join(dir, 'skills'), now: () => 1 });
  // One injected askOnce drives planner + reviewer + self-writer by sniffing the prompt.
  const askOnce = async (prompt) => {
    if (/Decompose this goal/.test(prompt)) return '{"done":"d","steps":[{"intent":"build the thing"}]}';
    if (/INDEPENDENT reviewer/.test(prompt)) return '{"approved":true,"notes":"ok"}';
    if (/FORKED reviewer/.test(prompt)) return '{"skills":[{"name":"build-thing","body":"how to build"}]}';
    return '';
  };
  const fakeHandle = async () => ({ routed: 'ptah', text: 'built it', contextTokens: 0 });
  const opts = makeLiveLoopOpts({
    loopId: 'live-e2e', dir, persist: false, reg: { sessions: {} },
    askOnce, handle: fakeHandle, skills, roster: ['ptah', 'thoth'],
    verifiers: { ptah: async () => ({ pass: true }) },
  });
  const res = await runLoop('build the thing', { ...opts, persist: false });
  assert.equal(res.status, 'success');
  assert.equal(res.plan.steps[0].intent, 'build the thing'); // live planner parsed it
  assert.equal((await skills.get('build-thing')).body, 'how to build'); // self-write landed
  rmSync(dir, { recursive: true, force: true });
});
