// Tests for the Phase 3 compaction tier: the canary marker, handoff/reseed, and the
// degraded-answer gate in Pharos (flush → handoff → reseed → redo once). Written via
// the test-keeper tool. The gate is exercised by injecting a fake runTurn so it's
// deterministic and offline — no real claude, no API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { CANARY, hasCanary, stripCanary } from '../src/pharos/canary.js';
import { trackRecent, writeHandoff, buildReseed, readHandoff } from '../src/pharos/handoff.js';
import { handle } from '../src/pharos.js';

const tmpDir = (n) => mkdtempSync(join(tmpdir(), `alex-canary-${n}-`));
const emptyStore = { source: 'test', async search() { return []; }, async write() {}, async get() {} };

// ---- canary ----

test('hasCanary: detects the marker', () => {
  assert.equal(hasCanary(`answer\n${CANARY}`), true);
  assert.equal(hasCanary('answer without marker'), false);
  assert.equal(hasCanary(undefined), false);
});

test('stripCanary: removes the marker and trailing whitespace', () => {
  assert.equal(stripCanary(`the answer\n${CANARY}`), 'the answer');
  assert.equal(stripCanary('plain answer'), 'plain answer');
});

// ---- handoff + reseed ----

test('trackRecent: keeps a rolling, capped recent-list per Keeper', () => {
  const reg = { sessions: {} };
  for (let i = 0; i < 7; i++) trackRecent(reg, 'ptah', `p${i}`);
  assert.equal(reg.recent.ptah.length, 5, 'capped at 5');
  assert.deepEqual(reg.recent.ptah, ['p2', 'p3', 'p4', 'p5', 'p6'], 'keeps the most recent');
});

test('writeHandoff: writes a durable artifact with the recent requests', () => {
  const dir = tmpDir('ho');
  const reg = { recent: { ptah: ['fix the hook', 'does it pass'] } };
  const file = writeHandoff('ptah', reg, { dir, now: '2026-06-29T00:00:00Z' });
  assert.ok(existsSync(file));
  const body = readFileSync(file, 'utf8');
  assert.match(body, /Handoff — ptah/);
  assert.match(body, /- fix the hook/);
  assert.equal(readHandoff('ptah', { dir }), body);
  rmSync(dir, { recursive: true, force: true });
});

test('buildReseed: builds a continuity preamble from recent requests', () => {
  const reg = { recent: { ra: ['book the flight', 'what about the visa'] } };
  const out = buildReseed('ra', 'personal', reg);
  assert.match(out, /Resuming your personal thread/);
  assert.match(out, /- book the flight/);
});

test('buildReseed: empty when there is nothing to restore', () => {
  assert.equal(buildReseed('ra', 'personal', { recent: {} }), '');
});

// ---- the gate in Pharos (injected runTurn, mock:false) ----

// A fake runTurn that returns canned texts in sequence and mimics real session
// bookkeeping (sets reg.sessions[id], reports fresh) so flush/reseed are observable.
function fakeRunner(texts) {
  const calls = [];
  let i = 0;
  const fn = (keeperId, prompt, { reg }) => {
    const fresh = !reg.sessions[keeperId];
    reg.sessions[keeperId] = { sessionId: `s-${keeperId}`, started: true };
    const text = texts[Math.min(i, texts.length - 1)];
    calls.push({ keeperId, prompt, fresh, text });
    i++;
    return { text, sessionId: reg.sessions[keeperId].sessionId, fresh };
  };
  return { fn, calls };
}

test('gate: a clean (canary-bearing) answer is relayed, no redo', async () => {
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 's', started: true } } };
  const { fn, calls } = fakeRunner([`all green ${CANARY}`]);
  const r = await handle('does it pass now', { reg, persist: false, store: emptyStore, runTurn: fn });
  assert.equal(calls.length, 1, 'no redo');
  assert.equal(r.redone, false);
  assert.equal(r.degraded, false);
  assert.equal(r.text, 'all green', 'marker stripped on relay');
});

test('gate: a missing canary triggers handoff + flush + reseed + one redo', async () => {
  const dir = tmpDir('gate');
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 's-old', started: true } }, recent: {} };
  // first answer degraded (no marker), redo answer clean (marker)
  const { fn, calls } = fakeRunner(['degraded answer no marker', `recovered ${CANARY}`]);
  const r = await handle('refactor the classifier scoring function', { reg, persist: false, store: emptyStore, runTurn: fn, handoff: { dir } });
  assert.equal(calls.length, 2, 'exactly one redo');
  assert.equal(r.redone, true);
  assert.equal(r.degraded, false, 'redo recovered the canary');
  assert.equal(r.text, 'recovered');
  assert.equal(calls[1].fresh, true, 'redo ran on a flushed (fresh) session');
  assert.match(calls[1].prompt, /Resuming your code thread/, 'redo prompt was reseeded');
  assert.ok(existsSync(join(dir, 'ptah.md')), 'handoff artifact written');
  rmSync(dir, { recursive: true, force: true });
});

test('gate: still-missing canary after redo relays with a degraded flag (max 1 redo)', async () => {
  const dir = tmpDir('deg');
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 's', started: true } }, recent: {} };
  const { fn, calls } = fakeRunner(['no marker', 'still no marker']);
  const r = await handle('refactor the classifier', { reg, persist: false, store: emptyStore, runTurn: fn, handoff: { dir } });
  assert.equal(calls.length, 2, 'only one redo, no infinite loop');
  assert.equal(r.redone, true);
  assert.equal(r.degraded, true, 'honestly flagged degraded');
  rmSync(dir, { recursive: true, force: true });
});

test('gate: the mock path never triggers the canary gate', async () => {
  const reg = { current: null, sessions: {} };
  const r = await handle('refactor the classifier scoring function', { mock: true, reg, persist: false, store: emptyStore });
  assert.equal(r.redone, false, 'mock answers carry no canary but must not trigger a redo');
  assert.equal(r.degraded, false);
});
