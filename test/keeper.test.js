// Tests for the Keeper runner (mock path — no claude subprocess, no API).
// Written via the test-keeper tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/keeper.js';

test('mock turn opens a new session on first use', () => {
  const reg = { current: null, sessions: {} };
  const t = runTurn('ptah', 'hello', { mock: true, reg });
  assert.equal(t.fresh, true);
  assert.equal(t.sessionId, 'mock-ptah');
  assert.equal(reg.sessions.ptah.sessionId, 'mock-ptah');
});

test('mock turn resumes the same session on second use', () => {
  const reg = { current: null, sessions: {} };
  runTurn('ptah', 'one', { mock: true, reg });
  const t2 = runTurn('ptah', 'two', { mock: true, reg });
  assert.equal(t2.fresh, false);
  assert.equal(t2.sessionId, 'mock-ptah');
});
