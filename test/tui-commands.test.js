// End-to-end command handling through the real bin (mock mode, piped stdin, temp cwd —
// no claude, no prewarm, no touching the operator's .pharos). Guards the two ways a
// quit used to fail: bare "quit" routed to a Keeper as a question, and a typo'd
// slash-command ("/qut") did the same instead of naming the miss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/pharos.js', import.meta.url));

// Pipe lines into `alexandria --mock --no-prewarm` in a fresh temp cwd; return stdout.
function runTui(lines) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'alx-tui-'));
  const res = spawnSync(process.execPath, [BIN, '--mock', '--no-prewarm'], {
    cwd, input: lines.join('\n') + '\n', encoding: 'utf8', timeout: 30_000,
  });
  return { out: res.stdout || '', status: res.status };
}

test('bare quit words close Alexandria instead of routing to a Keeper', () => {
  for (const word of ['quit', 'exit', 'q', '/quit', '/exit', '/q']) {
    const { out, status } = runTui([word]);
    assert.equal(status, 0, `${word} should exit cleanly`);
    assert.match(out, /Alexandria out/, `${word} should close`);
    assert.ok(!out.includes('mock NEW session'), `${word} must not spawn a Keeper turn`);
  }
});

test('a typo\'d /command names the miss and shows help — never routes to a Keeper', () => {
  const { out } = runTui(['/qut', 'quit']);
  assert.match(out, /unrecognized command/);
  assert.match(out, /'\/qut'/);
  assert.match(out, /Commands/); // printHelp follows, so the way out is on screen
  assert.match(out, /\/quit/);
  assert.ok(!out.includes('mock NEW session'), '/qut must not spawn a Keeper turn');
});

test('a real question still routes — including one that starts with a path', () => {
  const { out } = runTui(['/Users/x/file.js what is this', 'quit']);
  assert.match(out, /mock NEW session/); // routed to a Keeper, not eaten by the guard
  assert.ok(!out.includes('unrecognized command'));
});

test('/help lists the commands', () => {
  const { out } = runTui(['/help', 'quit']);
  assert.match(out, /Commands/);
  assert.match(out, /\/research/);
  assert.match(out, /\/settings/);
  assert.match(out, /\/quit/);
});
