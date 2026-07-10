// Escalate-up advisor tests — the ADVISE brief parser, the advise() relay, the
// pool-of-one session mechanics, and the handle() gate (in-band trigger, one-per-turn
// cap, per-Keeper enablement, global kill switch, fail-soft). All offline: the turn
// runner and advisor are injected, no subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVISOR, ADVISE_INSTRUCTION, extractAdviceRequest, advisedPrompt, advise,
} from '../src/pharos/advisor.js';
import { boatSystemPrompt, runTurn } from '../src/keeper.js';
import { CANARY, CANARY_INSTRUCTION } from '../src/pharos/canary.js';
import { KEEPERS, buildKeepers } from '../src/pharos/keepers.js';
import { getSettings } from '../src/pharos/settings.js';
import { handle } from '../src/pharos.js';

const freshReg = () => ({ current: null, sessions: {} });
const emptyStore = { source: 'test', async search() { return []; }, async write() { return { id: 'x' }; }, async get() { return null; } };
const settings = (patch = {}) => ({ ...getSettings({ settingsPath: '/nonexistent/path/settings.json' }), ...patch });

// ---- the brief parser ----
test('extractAdviceRequest: normal answers are not escalations', () => {
  assert.equal(extractAdviceRequest('here is the fix: change line 3'), null);
  assert.equal(extractAdviceRequest('I would ADVISE caution'), null); // mid-line ≠ marker
  assert.equal(extractAdviceRequest(''), null);
  assert.equal(extractAdviceRequest(null), null);
});

test('extractAdviceRequest: parses the brief, strips the canary, tolerates a preamble line', () => {
  assert.equal(extractAdviceRequest('ADVISE: which schema — A or B?'), 'which schema — A or B?');
  assert.equal(extractAdviceRequest(`ADVISE: hard fork\ndetails here\n${CANARY}`), 'hard fork\ndetails here');
  assert.equal(extractAdviceRequest('Hmm.\nADVISE: the real brief'), 'the real brief');
  assert.equal(extractAdviceRequest(`ADVISE:\n${CANARY}`), null); // empty brief = no escalation
});

// ---- the advisor spec + system-prompt composition ----
test('advisor spec: opus, toolless, clean, not in the routable registry', () => {
  assert.equal(ADVISOR.model, 'opus');
  assert.equal(ADVISOR.tools, '');
  assert.equal(ADVISOR.clean, true);
  assert.equal(KEEPERS.find((k) => k.id === ADVISOR.id), undefined);
});

test('boatSystemPrompt: ADVISE rule only for advisor-enabled Keepers; canary for all', () => {
  const ptah = KEEPERS.find((k) => k.id === 'ptah');
  const ra = KEEPERS.find((k) => k.id === 'ra');
  assert.ok(boatSystemPrompt(ptah).includes(ADVISE_INSTRUCTION));
  assert.ok(boatSystemPrompt(ptah).includes(CANARY_INSTRUCTION));
  assert.ok(!boatSystemPrompt(ra).includes(ADVISE_INSTRUCTION));
  assert.ok(boatSystemPrompt(ra).includes(CANARY_INSTRUCTION));
});

test('ptah ships as the cheap driver with escalation armed; overrides can flip it', () => {
  const ptah = KEEPERS.find((k) => k.id === 'ptah');
  assert.equal(ptah.advisor, true);
  assert.equal(ptah.model, 'sonnet');
  assert.equal(KEEPERS.find((k) => k.id === 'ra').advisor, undefined);
  const flipped = buildKeepers({ profile: { name: 'T' }, overrides: { ptah: { advisor: false }, ra: { advisor: true } } });
  assert.equal(flipped.find((k) => k.id === 'ptah').advisor, false);
  assert.equal(flipped.find((k) => k.id === 'ra').advisor, true);
});

// ---- advise(): the relay + pool-of-one ----
test('advise: relays the brief to the ADVISOR spec and returns the stripped verdict', async () => {
  const calls = [];
  const run = async (id, prompt, opts) => { calls.push({ id, prompt, opts }); return { text: `take option B\n${CANARY}` }; };
  const out = await advise('A or B?', { alias: 'code', reg: freshReg(), settings: {}, run });
  assert.equal(out, 'take option B');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, ADVISOR.id);
  assert.equal(calls[0].opts.keeper, ADVISOR);
  assert.match(calls[0].prompt, /code domain/);
  assert.match(calls[0].prompt, /A or B\?/);
});

test('advise: fail-soft — error turn, thrown run, or no run all return ""', async () => {
  assert.equal(await advise('b', { reg: freshReg(), run: async () => ({ text: 'x', error: true }) }), '');
  assert.equal(await advise('b', { reg: freshReg(), run: async () => { throw new Error('boom'); } }), '');
  assert.equal(await advise('b', { reg: freshReg() }), '');
});

test('pool of one: the advisor session lives in reg.sessions and resumes warm', async () => {
  const reg = freshReg();
  const t1 = await runTurn(ADVISOR.id, 'first fork', { mock: true, reg, keeper: ADVISOR });
  assert.equal(t1.fresh, true);
  assert.ok(reg.sessions[ADVISOR.id]);
  const t2 = await runTurn(ADVISOR.id, 'second fork', { mock: true, reg, keeper: ADVISOR });
  assert.equal(t2.fresh, false); // lazily spawned once, resumed thereafter
});

// ---- the handle() gate ----
// An injected runTurn that escalates on the first Keeper call and answers on the next.
function escalatingRun(texts) {
  const calls = [];
  const run = async (id, prompt, opts) => {
    calls.push({ id, prompt, opts });
    return { text: texts[Math.min(calls.length - 1, texts.length - 1)], fresh: false };
  };
  return { run, calls };
}

test('handle: ADVISE brief → advisor verdict → same Keeper finishes the turn', async () => {
  const { run, calls } = escalatingRun([`ADVISE: schema A or B?\n${CANARY}`, `done, went with B ${CANARY}`]);
  const advised = [];
  const r = await handle('refactor the classifier scoring function', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore, settings: settings(),
    runTurn: run, advise: async (brief) => { advised.push(brief); return 'take B'; },
  });
  assert.equal(r.routed, 'ptah');
  assert.equal(r.advised, true);
  assert.deepEqual(advised, ['schema A or B?']);
  assert.equal(calls.length, 2); // the turn + the follow-up — no third call
  assert.equal(calls[1].id, 'ptah'); // verdict goes back to the SAME Keeper
  assert.match(calls[1].prompt, /take B/);
  assert.match(calls[1].prompt, /\[Advisor verdict\]/);
  assert.equal(r.text, 'done, went with B');
});

test('handle: one escalation per turn — a second ADVISE relays as text, never loops', async () => {
  const { run, calls } = escalatingRun(['ADVISE: fork one', 'ADVISE: fork two']);
  const r = await handle('refactor the classifier scoring function', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore, settings: settings(),
    runTurn: run, advise: async () => 'verdict',
  });
  assert.equal(calls.length, 2);
  assert.equal(r.advised, true);
  assert.match(r.text, /ADVISE: fork two/); // relayed, not looped
});

test('handle: non-advisor Keepers never escalate', async () => {
  const { run, calls } = escalatingRun(['ADVISE: should I?']);
  let asked = false;
  const r = await handle('book the flight to sri lanka', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore, settings: settings(),
    runTurn: run, advise: async () => { asked = true; return 'verdict'; },
  });
  assert.equal(r.routed, 'ra');
  assert.equal(asked, false);
  assert.equal(calls.length, 1);
  assert.equal(r.advised, false);
});

test('handle: the global advisor setting is a kill switch', async () => {
  const { run, calls } = escalatingRun(['ADVISE: should I?']);
  let asked = false;
  const r = await handle('refactor the classifier scoring function', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore, settings: settings({ advisor: false }),
    runTurn: run, advise: async () => { asked = true; return 'verdict'; },
  });
  assert.equal(asked, false);
  assert.equal(calls.length, 1);
  assert.equal(r.advised, false);
});

test('handle: an empty verdict fails soft — raw reply relayed, no follow-up turn', async () => {
  const { run, calls } = escalatingRun(['ADVISE: brief']);
  const r = await handle('refactor the classifier scoring function', {
    mock: true, reg: freshReg(), persist: false, store: emptyStore, settings: settings(),
    runTurn: run, advise: async () => '',
  });
  assert.equal(calls.length, 1);
  assert.equal(r.advised, false);
  assert.match(r.text, /ADVISE: brief/);
});

test('settings: advisor defaults on; env kill switch works', () => {
  assert.equal(settings().advisor, true);
  process.env.ALEXANDRIA_ADVISOR = '0';
  try {
    assert.equal(getSettings({ settingsPath: '/nonexistent/path/settings.json' }).advisor, false);
  } finally {
    delete process.env.ALEXANDRIA_ADVISOR;
  }
});

test('advisedPrompt: carries the verdict and forbids a second ADVISE', () => {
  const p = advisedPrompt('take B');
  assert.match(p, /take B/);
  assert.match(p, /Do not emit another ADVISE/);
});
