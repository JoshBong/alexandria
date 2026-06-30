// Tests for the optional LLM seams: settings resolution, the reframe (forward) and
// revoice (return) passes (mock runner — no subprocess), and their Pharos integration
// + fail-soft behavior. (reframe/revoice run on the routed Keeper's model now.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, DEFAULTS } from '../src/pharos/settings.js';
import { makeReframeComposer, revoiceAnswer } from '../src/pharos/reframe.js';
import { handle } from '../src/pharos.js';
import { KEEPERS } from '../src/pharos/keepers.js';

const freshReg = () => ({ current: null, sessions: {} });
const emptyStore = { source: 'test', async search() { return []; }, async write() { return { id: 'x' }; }, async get() { return null; } };

// ---- settings ----
test('settings: defaults when no file/env (reframe off, revoice off, skipPerms on)', () => {
  const s = getSettings({ settingsPath: '/nonexistent/path/settings.json' });
  assert.equal(s.reframe, false);
  assert.equal(s.revoice, false);
  assert.equal(s.skipPerms, true);
});

test('settings: env override beats file/default', () => {
  process.env.ALEXANDRIA_REFRAME = '1';
  process.env.ALEXANDRIA_SKIP_PERMS = '0';
  try {
    const s = getSettings({ settingsPath: '/nonexistent/path/settings.json' });
    assert.equal(s.reframe, true);
    assert.equal(s.skipPerms, false);
  } finally {
    delete process.env.ALEXANDRIA_REFRAME;
    delete process.env.ALEXANDRIA_SKIP_PERMS;
  }
});

test('settings: file is read when present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alx-set-'));
  const p = path.join(dir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify({ revoice: true }));
  const s = getSettings({ settingsPath: p });
  assert.equal(s.revoice, true);
  assert.equal(s.reframe, DEFAULTS.reframe); // untouched key keeps default
});

// ---- per-Keeper tools ----
test('every Keeper declares a tools allowlist; only Ptah carries real tools', () => {
  for (const k of KEEPERS) assert.equal(typeof k.tools, 'string', `${k.id} missing tools`);
  assert.match(KEEPERS.find((k) => k.id === 'ptah').tools, /Edit/);
  assert.equal(KEEPERS.find((k) => k.id === 'ra').tools, '');
  assert.equal(KEEPERS.find((k) => k.id === 'thoth').tools, '');
});

// ---- reframe composer ----
test('reframe: augments a task with the runner, weaving recall (original preserved)', async () => {
  let seenUser = '';
  const run = async (_sys, user) => { seenUser = user; return 'CLEAN QUESTION'; };
  const compose = makeReframeComposer({ run });
  const out = await compose({ prompt: 'wrap up the linear algebra pset', recalled: [{ text: 'the linear algebra pset' }], alias: 'classwork' });
  assert.match(out, /wrap up the linear algebra pset/); // the user's words always go through
  assert.match(out, /Clarified task: CLEAN QUESTION/);  // reframe attached, NOT substituted
  assert.match(seenUser, /linear algebra pset/); // recall reached the runner
  assert.match(seenUser, /wrap up the linear algebra pset/);
});

test('reframe: short/casual message skips the runner entirely (no call spawned)', async () => {
  let called = false;
  const compose = makeReframeComposer({ run: async () => { called = true; return 'X'; } });
  const out = await compose({ prompt: 'hey there', recalled: [], alias: 'code' });
  assert.equal(out, 'hey there'); // untouched
  assert.equal(called, false);    // below the task floor → no wasted reframe call
});

test('reframe: runner replies SKIP (not a task) → original untouched', async () => {
  const compose = makeReframeComposer({ run: async () => 'SKIP' });
  const out = await compose({ prompt: 'lol what is even going on', recalled: [], alias: 'code' });
  assert.equal(out, 'lol what is even going on');
});

test('reframe: fail-soft — runner returns null → original task untouched', async () => {
  const compose = makeReframeComposer({ run: async () => null });
  const out = await compose({ prompt: 'refactor the scoring function please', recalled: [], alias: 'code' });
  assert.equal(out, 'refactor the scoring function please');
});

// ---- revoice ----
test('revoice: rewrites the answer via the runner', async () => {
  const out = await revoiceAnswer({ answer: 'raw spec answer', prompt: 'q' }, { run: async () => 'SMOOTH ANSWER' });
  assert.equal(out, 'SMOOTH ANSWER');
});

test('revoice: fail-soft — runner null → original answer; empty stays empty', async () => {
  assert.equal(await revoiceAnswer({ answer: 'raw', prompt: 'q' }, { run: async () => null }), 'raw');
  assert.equal(await revoiceAnswer({ answer: '', prompt: 'q' }, { run: async () => 'X' }), '');
});

// ---- Pharos integration ----
test('pharos: reframe ON augments the prompt sent to the Keeper (original preserved)', async () => {
  let sentToKeeper = '';
  const runTurn = (_id, p) => { sentToKeeper = p; return { text: 'ok', sessionId: 's', fresh: true }; };
  await handle('wrap up the linear algebra pset', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore,
    settings: { reframe: true, revoice: false, skipPerms: true },
    ask: async () => 'REFRAMED QUESTION',
    runTurn,
  });
  assert.match(sentToKeeper, /wrap up the linear algebra pset/); // user's words reach the Keeper
  assert.match(sentToKeeper, /Clarified task: REFRAMED QUESTION/);
});

// Regression for the "no question attached" bug: handle() must hand the runner the USER
// message as its prompt and the persona as system — not the reverse. The old keeperAsk
// called opts.ask(systemPrompt, …), silently dropping the user's words.
test('pharos: reframe runner receives the USER message as prompt, persona as system', async () => {
  let askedPrompt = null; let askedSystem = null;
  const runTurn = () => ({ text: 'ok', sessionId: 's', fresh: true });
  await handle('please refactor the scoring function', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore,
    settings: { reframe: true, revoice: false, skipPerms: true },
    ask: async (prompt, opts = {}) => { askedPrompt = prompt; askedSystem = opts.system; return 'REFRAMED'; },
    runTurn,
  });
  assert.match(askedPrompt, /refactor the scoring function/); // the real message, not the system text
  assert.match(askedSystem || '', /Keeper/);                  // persona delivered via opts.system
});

test('pharos: revoice ON rewrites the returned answer; OFF passes it straight through', async () => {
  const runTurn = () => ({ text: 'RAW KEEPER ANSWER', sessionId: 's', fresh: true });
  const on = await handle('q', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore,
    settings: { reframe: false, revoice: true, skipPerms: true },
    ask: async () => 'REVOICED', runTurn,
  });
  assert.equal(on.text, 'REVOICED');

  const off = await handle('q', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore,
    settings: { reframe: false, revoice: false, skipPerms: true },
    runTurn,
  });
  assert.equal(off.text, 'RAW KEEPER ANSWER');
});

test('pharos: mock turn with a flag on but NO injected runner never calls out (stays mock-safe)', async () => {
  // reframe true but mock:true and no opts.ask → wantLLM is false → composeTurn used.
  const r = await handle('refactor the scoring fn', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore,
    settings: { reframe: true, revoice: true, skipPerms: true },
  });
  assert.equal(r.routed, 'ptah'); // completed locally, no throw, no subprocess
});
