// Tests for the Pharos classifier. Written via the test-keeper tool
// (.claude/skills/test-keeper). Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, tokenize, scorePrompt } from '../src/pharos/classify.js';

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
