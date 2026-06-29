// Tests for the startup prewarm: establishes active Keepers in parallel, skips
// ones already warm, is best-effort on failure. Uses an injected spawnFn — no
// subprocess, no API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prewarmAll } from '../src/pharos/prewarm.js';
import { KEEPERS } from '../src/pharos/keepers.js';

const settings = { reframe: false, revoice: false, skipPerms: true, prewarm: true };
const activeCount = KEEPERS.filter((k) => k.active).length;

test('prewarm: establishes a session for every active Keeper, in parallel', async () => {
  const reg = { current: null, sessions: {} };
  const seen = [];
  const spawnFn = async (k) => { seen.push(k.id); return `sid-${k.id}`; };
  const { results } = await prewarmAll({ settings, reg, save: false, spawnFn });

  assert.equal(results.length, activeCount);
  assert.ok(results.every((r) => r.ok));
  for (const k of KEEPERS.filter((k) => k.active)) {
    assert.equal(reg.sessions[k.id].sessionId, `sid-${k.id}`);
    assert.equal(reg.sessions[k.id].started, true);
  }
  // never warms an inactive Keeper
  assert.equal(seen.length, activeCount);
});

test('prewarm: skips Keepers that already hold a session (idempotent)', async () => {
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 'existing', started: true } } };
  let spawns = 0;
  const spawnFn = async (k) => { spawns += 1; return `sid-${k.id}`; };
  await prewarmAll({ settings, reg, save: false, spawnFn });

  assert.equal(reg.sessions.ptah.sessionId, 'existing'); // untouched
  assert.equal(spawns, activeCount - 1); // every active Keeper EXCEPT the warm ptah
});

test('prewarm: best-effort — a failed warmup leaves that Keeper cold, others succeed', async () => {
  const reg = { current: null, sessions: {} };
  const spawnFn = async (k) => (k.id === 'thoth' ? null : `sid-${k.id}`);
  const { results } = await prewarmAll({ settings, reg, save: false, spawnFn });

  assert.equal(reg.sessions.thoth, undefined); // cold — will spawn fresh on first use
  assert.ok(reg.sessions.ptah); // others warmed
  assert.equal(results.find((r) => r.id === 'thoth').ok, false);
});

test('prewarm: nothing to do (all warm) does not save and returns empty', async () => {
  const reg = { current: null, sessions: Object.fromEntries(KEEPERS.filter((k) => k.active).map((k) => [k.id, { sessionId: 'x', started: true }])) };
  let saved = false;
  // save:true but registryPath unused because targets is empty → saveRegistry not called.
  const { results } = await prewarmAll({ settings, reg, save: true, spawnFn: async () => { saved = true; return 'nope'; } });
  assert.equal(results.length, 0);
  assert.equal(saved, false); // no spawn attempted
});
