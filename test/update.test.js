// Self-update — control flow proved offline: fetch + installer both injected, so no
// network and no npm. Covers the compare, the skip, the install, force, and failures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { update, checkForUpdate, cmpVersions, localVersion } from '../src/update.js';

const okFetch = (version) => async () => ({ ok: true, json: async () => ({ version }) });

test('cmpVersions: numeric dotted compare', () => {
  assert.equal(cmpVersions('0.1.2', '0.1.1'), 1);
  assert.equal(cmpVersions('0.1.1', '0.1.2'), -1);
  assert.equal(cmpVersions('0.1.1', '0.1.1'), 0);
  assert.equal(cmpVersions('0.10.0', '0.9.9'), 1); // numeric, not lexicographic
  assert.equal(cmpVersions('1.0', '1.0.0'), 0);
});

test('remote <= local → current, installer never runs', async () => {
  let installed = false;
  const r = await update({ fetchImpl: okFetch(localVersion()), install: async () => { installed = true; return 0; } });
  assert.equal(r.status, 'current');
  assert.equal(r.version, localVersion());
  assert.equal(installed, false);
});

test('remote newer → installs and reports from → to', async () => {
  const r = await update({ fetchImpl: okFetch('99.0.0'), install: async () => 0 });
  assert.deepEqual(r, { status: 'updated', from: localVersion(), to: '99.0.0' });
});

test('version check fails without force → failed, no install', async () => {
  let installed = false;
  const r = await update({ fetchImpl: async () => { throw new Error('offline'); }, install: async () => { installed = true; return 0; } });
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /offline/);
  assert.equal(installed, false);
});

test('force installs even when the check fails', async () => {
  const r = await update({ force: true, fetchImpl: async () => { throw new Error('offline'); }, install: async () => 0 });
  assert.equal(r.status, 'updated');
  assert.equal(r.to, '(latest)');
});

test('npm failure → failed with the exit code', async () => {
  const r = await update({ fetchImpl: okFetch('99.0.0'), install: async () => 1 });
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /exited 1/);
});

// ---- checkForUpdate: the startup notice's check — never installs, silent on failure ----
test('checkForUpdate: behind when main is newer, not behind when equal', async () => {
  assert.deepEqual(await checkForUpdate({ fetchImpl: okFetch('99.0.0') }), { from: localVersion(), to: '99.0.0', behind: true });
  assert.equal((await checkForUpdate({ fetchImpl: okFetch(localVersion()) })).behind, false);
});

test('checkForUpdate: offline or HTTP error → null (no notice, no throw)', async () => {
  assert.equal(await checkForUpdate({ fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await checkForUpdate({ fetchImpl: async () => ({ ok: false, status: 503 }) }), null);
});
