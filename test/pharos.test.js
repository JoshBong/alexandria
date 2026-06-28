// Tests for the Pharos head (route → relay) on the mock path. Written via the
// test-keeper tool. In-memory registry, persist:false — no disk, no API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/pharos.js';

const freshReg = () => ({ current: null, sessions: {} });

test('routes a code prompt to Ptah and opens a session', () => {
  const reg = freshReg();
  const r = handle('refactor the classifier scoring function', { mock: true, reg, persist: false });
  assert.equal(r.routed, 'ptah');
  assert.equal(r.fresh, true);
  assert.equal(reg.current, 'ptah');
  assert.ok(reg.sessions.ptah);
});

test('vocab-less follow-up sticks to the current Keeper', () => {
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 'mock-ptah', started: true } } };
  const r = handle('does it pass now', { mock: true, reg, persist: false });
  assert.equal(r.routed, 'ptah');
  assert.equal(r.reason, 'sticky-below-floor');
  assert.equal(r.fresh, false);
});

test('an inactive Keeper (Horus) falls back to intake', () => {
  const reg = freshReg();
  const r = handle('prep questions for the juniper meeting', { mock: true, reg, persist: false });
  assert.equal(r.routed, 'anubis');
  assert.match(r.note, /no 'horus' Keeper/);
});

test('a switch is flagged when the Keeper changes', () => {
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 'mock-ptah', started: true } } };
  const r = handle('book the flight to sri lanka', { mock: true, reg, persist: false });
  assert.equal(r.routed, 'ra');
  assert.equal(r.switched, true);
});
