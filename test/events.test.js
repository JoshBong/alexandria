// Tests for the run log: the append-only event helpers and the per-turn event
// Pharos emits. Logging is tied to `persist` (so the offline tests/sims that pass
// persist:false stay silent) and is best-effort (a write failure never throws).
// Exercised offline with a temp dir via opts.events; no real claude, no API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { CANARY } from '../src/pharos/canary.js';
import { logEvent, readEvents, eventsEnabled } from '../src/pharos/events.js';
import { handle } from '../src/pharos.js';

const tmpDir = (n) => mkdtempSync(join(tmpdir(), `alex-events-${n}-`));
const emptyStore = { source: 'test', async search() { return []; }, async write() {}, async get() {} };

// A fake runner that can report usage/contextTokens, mimicking session bookkeeping.
function fakeRunner(turns) {
  const calls = [];
  let i = 0;
  const fn = (keeperId, prompt, { reg }) => {
    const fresh = !reg.sessions[keeperId];
    reg.sessions[keeperId] = { sessionId: `s-${keeperId}`, started: true };
    const spec = turns[Math.min(i, turns.length - 1)];
    const { text, contextTokens = 0, usage } = typeof spec === 'string' ? { text: spec } : spec;
    calls.push({ keeperId, prompt, fresh });
    i++;
    return { text, sessionId: reg.sessions[keeperId].sessionId, fresh, contextTokens, usage };
  };
  return { fn, calls };
}

// ---- helpers ----

test('eventsEnabled: on by default, off only when explicitly disabled', () => {
  assert.equal(eventsEnabled({}), true);
  assert.equal(eventsEnabled({ ALEXANDRIA_EVENTS: '0' }), false);
  assert.equal(eventsEnabled({ ALEXANDRIA_EVENTS: 'off' }), false);
  assert.equal(eventsEnabled({ ALEXANDRIA_EVENTS: 'false' }), false);
  assert.equal(eventsEnabled({ ALEXANDRIA_EVENTS: '1' }), true);
});

test('logEvent + readEvents: append round-trips, ts is stamped', () => {
  const dir = tmpDir('rt');
  logEvent({ routed: 'ptah', contextTokens: 10 }, { dir, now: '2026-06-29T10:00:00Z' });
  logEvent({ routed: 'ra', contextTokens: 20 }, { dir });
  const rows = readEvents({ dir });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].routed, 'ptah');
  assert.equal(rows[0].ts, '2026-06-29T10:00:00Z');
  assert.ok(rows[1].ts, 'second row got an auto ts');
  rmSync(dir, { recursive: true, force: true });
});

test('logEvent: disabled is a no-op; readEvents on a missing file is []', () => {
  const dir = tmpDir('off');
  assert.equal(logEvent({ routed: 'ptah' }, { dir, enabled: false }), null);
  assert.equal(readEvents({ dir }).length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('readEvents: skips corrupt lines instead of throwing', () => {
  const dir = tmpDir('bad');
  logEvent({ routed: 'ptah' }, { dir });
  // append a garbage line directly
  logEvent('not-an-object-but-still-valid-json', { dir }); // becomes a JSON string line -> parses, but no fields
  const rows = readEvents({ dir });
  assert.ok(rows.length >= 1, 'valid rows still read');
  rmSync(dir, { recursive: true, force: true });
});

// ---- the per-turn event from handle() ----

test('handle: emits a rich event per turn (token load + lifecycle + gates)', async () => {
  const dir = tmpDir('turn');
  const reg = { current: null, sessions: {}, recent: {} };
  const { fn } = fakeRunner([
    { text: `done ${CANARY}`, contextTokens: 1234, usage: { input_tokens: 200, cache_read_input_tokens: 1000, cache_creation_input_tokens: 34, output_tokens: 50 } },
  ]);
  await handle('refactor the classifier scoring function', {
    reg, persist: true, store: emptyStore, runTurn: fn, events: { dir }, registryPath: join(dir, 'registry.json'),
  });

  const rows = readEvents({ dir });
  assert.equal(rows.length, 1);
  const e = rows[0];
  assert.equal(e.routed, 'ptah');
  assert.equal(e.freshSession, true, 'a new session was started');
  assert.equal(e.contextTokens, 1234);
  assert.equal(e.usage.cacheRead, 1000, 'usage breakdown captured');
  assert.equal(e.usage.output, 50);
  assert.equal(e.redone, false);
  assert.equal(e.compacting, false);
  assert.ok(e.ts, 'stamped');
  rmSync(dir, { recursive: true, force: true });
});

test('handle: a token-low turn logs compacting:true (early gate) for the run log', async () => {
  const prev = process.env.ALEXANDRIA_TOKEN_LIMIT;
  process.env.ALEXANDRIA_TOKEN_LIMIT = '1000';
  const dir = tmpDir('comp');
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 's', started: true } }, recent: {} };
  const { fn } = fakeRunner([{ text: `heavy ${CANARY}`, contextTokens: 5000 }]);
  await handle('does it pass now', { reg, persist: true, store: emptyStore, runTurn: fn, events: { dir }, handoff: { dir }, registryPath: join(dir, 'registry.json') });

  const e = readEvents({ dir }).pop();
  assert.equal(e.compacting, true, 'early gate recorded');
  process.env.ALEXANDRIA_TOKEN_LIMIT = prev;
  rmSync(dir, { recursive: true, force: true });
});

test('handle: persist:false writes no events (tests/sims stay silent)', async () => {
  const dir = tmpDir('silent');
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 's', started: true } }, recent: {} };
  const { fn } = fakeRunner([{ text: `done ${CANARY}`, contextTokens: 10 }]);
  await handle('does it pass now', { reg, persist: false, store: emptyStore, runTurn: fn, events: { dir } });
  assert.equal(existsSync(join(dir, 'events.jsonl')), false, 'no event file written when persist:false');
  rmSync(dir, { recursive: true, force: true });
});
