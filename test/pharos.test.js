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
  const r = await handle('prep questions for the juniper meeting', { mock: true, reg, persist: false, store: emptyStore });
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

test('a switch is flagged when the Keeper changes', async () => {
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 'mock-ptah', started: true } } };
  const r = await handle('book the flight to sri lanka', { mock: true, reg, persist: false, store: emptyStore });
  assert.equal(r.routed, 'ra');
  assert.equal(r.switched, true);
});
