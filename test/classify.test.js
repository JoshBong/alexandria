// Tests for the Pharos classifier. Written via the test-keeper tool
// (.claude/skills/test-keeper). Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, tokenize, scorePrompt, makeLLMClassifier, localConfident, CONFIDENT_MARGIN } from '../src/pharos/classify.js';

test('LLM classifier routes by the model reply (no keyword needed)', async () => {
  // "make a website" has no obvious keyword for the scorer, but Pharos reads it.
  const c = makeLLMClassifier({ run: async () => 'ptah' });
  const d = await c('lets make a website', { currentKeeper: 'anubis' });
  assert.equal(d.routed, 'ptah');
  assert.equal(d.reason, 'llm');
});

test('LLM classifier tolerates a chatty reply and extracts the id', async () => {
  const c = makeLLMClassifier({ run: async () => 'This belongs to Ra.' });
  assert.equal((await c('book my flight')).routed, 'ra');
});

test('LLM classifier falls back to the keyword scorer when the model fails', async () => {
  const c = makeLLMClassifier({ run: async () => { throw new Error('offline'); } });
  const d = await c('refactor the parser function', { currentKeeper: null });
  assert.equal(d.routed, 'ptah'); // keyword safety net still routes a clear code prompt
});

test('routes a strong code prompt to Ptah (argmax)', () => {
  const r = classify('fix the bug in the hook');
  assert.equal(r.routed, 'ptah');
  assert.equal(r.reason, 'argmax');
  assert.ok(r.topScore >= 3);
});

test('cold vocab-less prompt falls to intake (Anubis)', () => {
  const r = classify('tell me a joke');
  assert.equal(r.routed, 'anubis');
  assert.equal(r.reason, 'below-floor->intake');
});

test('stickiness outranks the floor when already in a Keeper', () => {
  const r = classify('ship it', { currentKeeper: 'ptah' });
  assert.equal(r.routed, 'ptah');
  assert.equal(r.reason, 'sticky-below-floor');
});

test('a strong new-domain prompt switches Keepers', () => {
  const r = classify('what is on my calendar this weekend', { currentKeeper: 'ptah' });
  assert.equal(r.routed, 'ra');
  assert.equal(r.reason, 'argmax');
});

test('a near-tie does not switch (sticky hysteresis)', () => {
  const r = classify('remind me to refactor', { currentKeeper: 'ra' });
  assert.equal(r.routed, 'ra');
  assert.equal(r.reason, 'sticky-hysteresis');
});

test('multi-word terms phrase-match with a bonus', () => {
  const s = scorePrompt('linear algebra pset');
  assert.ok(s.thoth >= 7, `expected thoth >= 7, got ${s.thoth}`);
});

test('tokenize drops stopwords and single chars', () => {
  assert.deepEqual(tokenize("what's up code"), ['code']);
});

// localConfident — the gate that decides whether a live turn skips the LLM router.
test('localConfident: terse follow-up that stuck to the current Keeper is confident', () => {
  const d = classify('ship it', { currentKeeper: 'ptah' });
  assert.equal(d.reason, 'sticky-below-floor');
  assert.equal(localConfident(d), true); // no domain signal → model would keep it here too
});

test('localConfident: a clear keyword winner with a wide margin is confident', () => {
  const d = classify('fix the bug in the hook'); // strong code vocab, no rival domain
  assert.equal(d.reason, 'argmax');
  assert.ok(d.margin >= CONFIDENT_MARGIN);
  assert.equal(localConfident(d), true);
});

test('localConfident: a hysteresis near-tie is NOT confident (escalate to the model)', () => {
  const d = classify('remind me to refactor', { currentKeeper: 'ra' });
  assert.equal(d.reason, 'sticky-hysteresis');
  assert.equal(localConfident(d), false);
});

test('localConfident: cold-start intake with no vocab is NOT confident (escalate)', () => {
  const d = classify('tell me a joke');
  assert.equal(d.reason, 'below-floor->intake');
  assert.equal(localConfident(d), false);
});

test('localConfident: a thin-margin argmax is NOT confident (escalate)', () => {
  // Hand-built decision: argmax but the runner-up is one point behind.
  assert.equal(localConfident({ reason: 'argmax', margin: CONFIDENT_MARGIN - 1 }), false);
  assert.equal(localConfident(null), false);
});
