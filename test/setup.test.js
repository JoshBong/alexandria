// Tests for the public-repo setup layer: the operator profile (name/onboarding),
// gitignored per-Keeper overrides, generic identity-free Keepers, the shared
// on-demand tool layer, and the boat-arg builder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getProfile, hasProfile, saveProfile, DEFAULT_PROFILE } from '../src/pharos/profile.js';
import { loadOverrides } from '../src/pharos/overrides.js';
import { buildKeepers, KEEPERS } from '../src/pharos/keepers.js';
import { boatExtraArgs } from '../src/keeper.js';
import { getSettings, STRING_DEFAULTS } from '../src/pharos/settings.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alx-setup-'));

// ---- profile ----
test('profile: neutral default when no file, env, or saved name', () => {
  const p = getProfile({ path: '/nonexistent/profile.json' });
  assert.equal(p.name, DEFAULT_PROFILE.name);
  assert.equal(hasProfile({ path: '/nonexistent/profile.json' }), false);
});

test('profile: save then read round-trips the name; onboarding gate flips', () => {
  const f = path.join(tmp(), 'profile.json');
  assert.equal(hasProfile({ path: f }), false);
  saveProfile({ name: 'Ada' }, { path: f });
  assert.equal(hasProfile({ path: f }), true);
  assert.equal(getProfile({ path: f }).name, 'Ada');
});

test('profile: ALEXANDRIA_NAME env overrides the file', () => {
  const f = path.join(tmp(), 'profile.json');
  saveProfile({ name: 'Ada' }, { path: f });
  process.env.ALEXANDRIA_NAME = 'Grace';
  try {
    assert.equal(getProfile({ path: f }).name, 'Grace');
  } finally {
    delete process.env.ALEXANDRIA_NAME;
  }
});

// ---- shipped registry is identity-free ----
// Assert the GENERIC ship (neutral profile, no overrides) — not the live KEEPERS,
// which legitimately interpolate the local operator's own gitignored name.
test('keepers: shipped registry carries no personal proper nouns', () => {
  const ship = buildKeepers({ profile: { name: 'the operator' }, overrides: {} });
  const blob = JSON.stringify(ship).toLowerCase();
  for (const word of ['josh', 'juniper', 'planisphere', 'mercor', 'nyu', 'cornell', 'sri lanka', 'taekwondo', 'faye']) {
    assert.equal(blob.includes(word), false, `shipped Keepers leak "${word}"`);
  }
});

test('keepers: persona interpolates the operator name; default is neutral', () => {
  const named = buildKeepers({ profile: { name: 'Ada' }, overrides: {} });
  assert.match(named.find((k) => k.id === 'ra').persona, /Ada's personal domain/);
  const def = buildKeepers({ profile: { name: 'the operator' }, overrides: {} });
  assert.match(def.find((k) => k.id === 'ra').persona, /the operator's personal domain/);
});

// ---- overrides ----
test('overrides: absent file → empty; present file merges terms + persona context', () => {
  assert.deepEqual(loadOverrides({ path: '/nonexistent/keepers.local.json' }), {});
  const f = path.join(tmp(), 'keepers.local.json');
  fs.writeFileSync(f, JSON.stringify({ horus: { terms: { juniper: 3 }, personaContext: 'Track: two offers.' } }));
  const ov = loadOverrides({ path: f });
  const k = buildKeepers({ profile: { name: 'Ada' }, overrides: ov }).find((x) => x.id === 'horus');
  assert.equal(k.terms.juniper, 3); // operator's private term merged in
  assert.equal(k.terms.offer, 3); // base term still present
  assert.match(k.persona, /Track: two offers\./); // private context appended
});

// ---- boat arg builder ----
test('boatExtraArgs: reasoner Keeper is lean + clean; shared tools append', () => {
  const ra = KEEPERS.find((k) => k.id === 'ra');
  const args = boatExtraArgs(ra, { skipPerms: true, sharedTools: 'WebSearch,WebFetch', mcpConfig: '' });
  // --tools is the keeper's own ('') + shared → just the shared list
  const ti = args.indexOf('--tools');
  assert.equal(args[ti + 1], 'WebSearch,WebFetch');
  assert.ok(args.includes('--setting-sources') && args[args.indexOf('--setting-sources') + 1] === 'local');
  assert.ok(args.includes('--dangerously-skip-permissions'));
  assert.ok(!args.includes('--mcp-config'));
});

test('boatExtraArgs: Ptah carries real tools, keeps repo context, gets mcp config', () => {
  const ptah = KEEPERS.find((k) => k.id === 'ptah');
  const args = boatExtraArgs(ptah, { skipPerms: false, sharedTools: '', mcpConfig: '/x/mcp.json' });
  assert.match(args[args.indexOf('--tools') + 1], /Edit/);
  assert.ok(!args.includes('--setting-sources')); // Ptah is NOT clean — keeps repo CLAUDE.md
  assert.ok(!args.includes('--dangerously-skip-permissions')); // skipPerms off here
  assert.equal(args[args.indexOf('--mcp-config') + 1], '/x/mcp.json');
});

// ---- string settings ----
test('settings: sharedTools / mcpConfig default empty and read from file', () => {
  const s0 = getSettings({ settingsPath: '/nonexistent/settings.json' });
  assert.equal(s0.sharedTools, STRING_DEFAULTS.sharedTools);
  assert.equal(s0.mcpConfig, STRING_DEFAULTS.mcpConfig);
  assert.equal(s0.metrics, false);

  const f = path.join(tmp(), 'settings.json');
  fs.writeFileSync(f, JSON.stringify({ sharedTools: 'WebSearch', mcpConfig: '/x.json', metrics: true }));
  const s1 = getSettings({ settingsPath: f });
  assert.equal(s1.sharedTools, 'WebSearch');
  assert.equal(s1.mcpConfig, '/x.json');
  assert.equal(s1.metrics, true);
});
