// Tests for the Pharos registry (pointer file). Uses a temp path so it never
// touches the real .pharos/registry.json. Written via the test-keeper tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { loadRegistry, saveRegistry } from '../src/pharos/registry.js';

test('loadRegistry returns a fresh registry when the file is absent', () => {
  const f = join(tmpdir(), `pharos-absent-${process.pid}.json`);
  rmSync(f, { force: true });
  assert.deepEqual(loadRegistry(f), { current: null, sessions: {} });
});

test('save then load round-trips', () => {
  const f = join(tmpdir(), `pharos-rt-${process.pid}.json`);
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 'abc', started: true } } };
  saveRegistry(reg, f);
  assert.deepEqual(loadRegistry(f), reg);
  rmSync(f, { force: true });
});
