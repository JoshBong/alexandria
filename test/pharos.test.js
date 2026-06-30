// Tests for the Pharos head (route → relay) on the mock path. Written via the
// test-keeper tool. In-memory registry, persist:false — no disk, no API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/pharos.js';

const freshReg = () => ({ current: null, sessions: {} });

// An empty store so recall never touches the live .pharos/memory file in tests.
const emptyStore = { source: 'test', async search() { return []; }, async write() { return { id: 'x' }; }, async get() { return null; } };

test('routes a code prompt to Ptah and opens a session', async () => {
  const reg = freshReg();
  const r = await handle('refactor the classifier scoring function', { mock: true, reg, persist: false, store: emptyStore });
  assert.equal(r.routed, 'ptah');
  assert.equal(r.fresh, true);
  assert.equal(reg.current, 'ptah');
  assert.ok(reg.sessions.ptah);
});

test('vocab-less follow-up sticks to the current Keeper', async () => {
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 'mock-ptah', started: true } } };
  const r = await handle('does it pass now', { mock: true, reg, persist: false, store: emptyStore });
  assert.equal(r.routed, 'ptah');
  assert.equal(r.reason, 'sticky-below-floor');
  assert.equal(r.fresh, false);
});

test('Horus is now active — career prompts route to horus, not intake', async () => {
  const reg = freshReg();
  const r = await handle('help me negotiate my offer', { mock: true, reg, persist: false, store: emptyStore });
  assert.equal(r.routed, 'horus');
});

test('an inactive/unknown route still falls back to intake', async () => {
  const reg = freshReg();
  // Inject a classify that routes to a Keeper not in the active set.
  const classify = () => ({ routed: 'seshat', reason: 'argmax', scores: { seshat: 9 } });
  const r = await handle('some future domain', { mock: true, reg, persist: false, store: emptyStore, classify });
  assert.equal(r.routed, 'anubis');
  assert.match(r.note, /no 'seshat' Keeper/);
});

// Local-first routing: the LLM router (opts.ask) is a cold haiku spawn live, so a
// confident local route must NOT call it; an ambiguous one must.
test('confident local route skips the LLM router (no ask spawn)', async () => {
  let askCalls = 0;
  const ask = async () => { askCalls++; return 'ra'; }; // would mis-route if it ran
  // (a) strong keyword winner, (b) terse follow-up that sticks — both confident.
  const r1 = await handle('refactor the classifier scoring function', { mock: true, reg: freshReg(), persist: false, store: emptyStore, ask });
  assert.equal(r1.routed, 'ptah');
  const stickyReg = { current: 'ptah', sessions: { ptah: { sessionId: 'mock-ptah', started: true } } };
  const r2 = await handle('does it pass now', { mock: true, reg: stickyReg, persist: false, store: emptyStore, ask });
  assert.equal(r2.routed, 'ptah');
  assert.equal(askCalls, 0); // neither turn paid the router spawn
});

test('ambiguous local route escalates to the LLM router (ask decides)', async () => {
  let askCalls = 0;
  const ask = async () => { askCalls++; return 'ptah'; };
  // "remind me to refactor" in Ra = sticky-hysteresis near-tie → not confident → escalate.
  const reg = { current: 'ra', sessions: { ra: { sessionId: 'mock-ra', started: true } } };
  const r = await handle('remind me to refactor', { mock: true, reg, persist: false, store: emptyStore, ask });
  assert.equal(askCalls, 1);        // the router ran
  assert.equal(r.routed, 'ptah');   // and its verdict won over the local sticky default
});

test('a switch is flagged when the Keeper changes', async () => {
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 'mock-ptah', started: true } } };
  const r = await handle('book the flight to sri lanka', { mock: true, reg, persist: false, store: emptyStore });
  assert.equal(r.routed, 'ra');
  assert.equal(r.switched, true);
});
