// Tests for the EARLY (token-low) compaction trigger: the usage helpers and the
// proactive flush+reseed gate in Pharos. The gate is the capacity counterpart to
// the canary gate — it flushes a heavy Keeper AFTER a good turn so the NEXT turn
// opens fresh + reseeded, instead of redoing the current one. Exercised offline by
// injecting a fake runTurn that reports contextTokens; no real claude, no API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { CANARY } from '../src/pharos/canary.js';
import { contextTokensOf, tokenLimit, isTokenLow } from '../src/pharos/tokens.js';
import { handle } from '../src/pharos.js';

const tmpDir = (n) => mkdtempSync(join(tmpdir(), `alex-tokens-${n}-`));
const emptyStore = { source: 'test', async search() { return []; }, async write() {}, async get() {} };
// Pin the LLM seams off — these gates run non-mock, so without this reframe/revoice would
// read the operator's live settings file and spawn a real `claude`. See canary.test.js.
const NO_LLM = { reframe: false, revoice: false };

// ---- usage helpers ----

test('contextTokensOf: sums every input-side bucket', () => {
  assert.equal(
    contextTokensOf({ input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 999 }),
    1050,
    'output_tokens is excluded; the three input buckets sum',
  );
});

test('contextTokensOf: missing fields and non-objects default to 0 (safe direction)', () => {
  assert.equal(contextTokensOf({ input_tokens: 42 }), 42);
  assert.equal(contextTokensOf(undefined), 0);
  assert.equal(contextTokensOf(null), 0);
  assert.equal(contextTokensOf({ input_tokens: 'nope' }), 0);
});

test('tokenLimit: env override wins, junk falls back to the default', () => {
  assert.equal(tokenLimit({ ALEXANDRIA_TOKEN_LIMIT: '120000' }), 120000);
  assert.equal(tokenLimit({ ALEXANDRIA_TOKEN_LIMIT: 'banana' }), 150000, 'junk → default');
  assert.equal(tokenLimit({}), 150000, 'unset → default');
});

test('isTokenLow: fires at/over the limit, not under; a non-positive limit disables it', () => {
  assert.equal(isTokenLow(150000, 150000), true, 'at the limit fires');
  assert.equal(isTokenLow(150001, 150000), true);
  assert.equal(isTokenLow(149999, 150000), false);
  assert.equal(isTokenLow(999999, 0), false, 'disabled');
  assert.equal(isTokenLow(999999, -1), false, 'disabled');
});

// ---- the early gate in Pharos (injected runTurn, mock:false) ----

// A fake runner whose turns can report contextTokens. Accepts strings or
// { text, contextTokens } and mimics session bookkeeping so flush/reseed show.
function fakeRunner(turns) {
  const calls = [];
  let i = 0;
  const fn = (keeperId, prompt, { reg }) => {
    const fresh = !reg.sessions[keeperId];
    reg.sessions[keeperId] = { sessionId: `s-${keeperId}`, started: true };
    const spec = turns[Math.min(i, turns.length - 1)];
    const { text, contextTokens = 0 } = typeof spec === 'string' ? { text: spec } : spec;
    calls.push({ keeperId, prompt, fresh, text, contextTokens });
    i++;
    return { text, sessionId: reg.sessions[keeperId].sessionId, fresh, contextTokens };
  };
  return { fn, calls };
}

test('early gate: a heavy but clean turn relays as-is, then flushes + arms a reseed', async () => {
  const prev = process.env.ALEXANDRIA_TOKEN_LIMIT;
  process.env.ALEXANDRIA_TOKEN_LIMIT = '1000';
  const dir = tmpDir('early');
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 's-old', started: true } }, recent: {} };
  const { fn, calls } = fakeRunner([{ text: `all green ${CANARY}`, contextTokens: 1200 }]);
  const r = await handle('does it pass now', { reg, persist: false, store: emptyStore, runTurn: fn, handoff: { dir }, settings: NO_LLM });

  assert.equal(calls.length, 1, 'no redo — the turn was good');
  assert.equal(r.redone, false);
  assert.equal(r.compacting, true, 'flagged for the front door');
  assert.equal(r.text, 'all green', 'the heavy turn still relays, marker stripped');
  assert.equal(reg.sessions.ptah, undefined, 'heavy session flushed');
  assert.equal(reg.reseedPending.ptah, true, 'next turn armed to reseed');
  assert.ok(existsSync(join(dir, 'ptah.md')), 'handoff artifact written');

  process.env.ALEXANDRIA_TOKEN_LIMIT = prev;
  rmSync(dir, { recursive: true, force: true });
});

test('early gate: the next turn to a flushed Keeper opens fresh and reseeded', async () => {
  const prev = process.env.ALEXANDRIA_TOKEN_LIMIT;
  process.env.ALEXANDRIA_TOKEN_LIMIT = '1000';
  // Keeper already flushed for capacity last turn: no session, reseed armed, recent history.
  const reg = {
    current: 'ptah',
    sessions: {},
    recent: { ptah: ['refactor the classifier', 'add the token gate'] },
    reseedPending: { ptah: true },
  };
  const { fn, calls } = fakeRunner([{ text: `picking up ${CANARY}`, contextTokens: 10 }]);
  const r = await handle('does it pass now', { reg, persist: false, store: emptyStore, runTurn: fn, settings: NO_LLM });

  assert.equal(calls[0].fresh, true, 'opened a fresh session');
  assert.match(calls[0].prompt, /Resuming your code thread/, 'reseed preamble prepended');
  assert.match(calls[0].prompt, /- refactor the classifier/, 'reseed carries the recent requests');
  assert.equal(reg.reseedPending.ptah, undefined, 'pending flag cleared after use');
  assert.equal(r.compacting, false, 'light turn does not re-trigger the gate');

  process.env.ALEXANDRIA_TOKEN_LIMIT = prev;
});

test('early gate: a turn under the limit keeps the warm session', async () => {
  const prev = process.env.ALEXANDRIA_TOKEN_LIMIT;
  process.env.ALEXANDRIA_TOKEN_LIMIT = '1000';
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 's', started: true } }, recent: {} };
  const { fn } = fakeRunner([{ text: `fine ${CANARY}`, contextTokens: 200 }]);
  const r = await handle('does it pass now', { reg, persist: false, store: emptyStore, runTurn: fn, settings: NO_LLM });

  assert.equal(r.compacting, false);
  assert.ok(reg.sessions.ptah, 'warm session retained');
  process.env.ALEXANDRIA_TOKEN_LIMIT = prev;
});

test('early gate: the mock path never flushes for tokens (no usage)', async () => {
  const prev = process.env.ALEXANDRIA_TOKEN_LIMIT;
  process.env.ALEXANDRIA_TOKEN_LIMIT = '1'; // absurdly low — only contextTokens 0 saves us
  const reg = { current: null, sessions: {} };
  const r = await handle('refactor the classifier', { mock: true, reg, persist: false, store: emptyStore });

  assert.equal(r.compacting, false, 'mock has no usage → contextTokens 0 → never fires');
  process.env.ALEXANDRIA_TOKEN_LIMIT = prev;
});
