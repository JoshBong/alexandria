// askOnce flag + watchdog behavior — hermetic via a PATH-shimmed fake `claude` that
// echoes its argv (so we can assert what the real spawn would receive) or hangs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { askOnce } from '../src/pharos/ask.js';

function shimClaude(t, script) {
  const dir = mkdtempSync(join(tmpdir(), 'alexandria-ask-'));
  const f = join(dir, 'claude');
  writeFileSync(f, `#!/bin/sh\n${script}\n`);
  chmodSync(f, 0o755);
  const old = process.env.PATH;
  process.env.PATH = `${dir}:${old}`;
  t.after(() => { process.env.PATH = old; });
}

test('tools guard is on undefined: tools:"" emits --tools "", omitted emits nothing', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"'); // one arg per line; empty arg = blank line
  const withEmpty = await askOnce('hi', { tools: '' });
  assert.match(withEmpty, /--tools\n\n/); // flag present, value is the empty string
  const without = await askOnce('hi', {});
  assert.doesNotMatch(without, /--tools/);
});

test('timeoutMs kills a hung boat and resolves empty', async (t) => {
  shimClaude(t, 'sleep 30');
  const t0 = Date.now();
  const out = await askOnce('hi', { timeoutMs: 200 });
  assert.equal(out, '');
  assert.ok(Date.now() - t0 < 5000, 'resolved via the watchdog, not the sleep');
});
