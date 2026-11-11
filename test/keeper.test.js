// Tests for the Keeper runner (mock path — no claude subprocess, no API).
// Written via the test-keeper tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runTurn, parseStreamJson, isDeadSession } from '../src/keeper.js';

test('mock turn opens a new session on first use', async () => {
  const reg = { current: null, sessions: {} };
  const t = await runTurn('ptah', 'hello', { mock: true, reg });
  assert.equal(t.fresh, true);
  assert.equal(t.sessionId, 'mock-ptah');
  assert.equal(reg.sessions.ptah.sessionId, 'mock-ptah');
});

test('mock turn resumes the same session on second use', async () => {
  const reg = { current: null, sessions: {} };
  await runTurn('ptah', 'one', { mock: true, reg });
  const t2 = await runTurn('ptah', 'two', { mock: true, reg });
  assert.equal(t2.fresh, false);
  assert.equal(t2.sessionId, 'mock-ptah');
});

// ---- parseStreamJson: harvest text + usage + touched from the stream-json event log ----
test('parseStreamJson: extracts text, usage, and edited files (touched) from the NDJSON stream', () => {
  const stream = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'text', text: 'working on it' },
      { type: 'tool_use', name: 'Read', input: { file_path: 'src/only-read.js' } },     // read → NOT touched
      { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.js' } },
      { type: 'tool_use', name: 'Write', input: { file_path: 'src/b.js' } },
    ] } }),
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.js' } },              // dup → set-deduped
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },               // no file_path → ignored
    ] } }),
    JSON.stringify({ type: 'result', subtype: 'success', result: 'final answer', usage: { input_tokens: 10, output_tokens: 4 } }),
  ].join('\n');
  const r = parseStreamJson(stream);
  assert.equal(r.text, 'final answer');
  assert.deepEqual(r.usage, { input_tokens: 10, output_tokens: 4 });
  assert.deepEqual(r.touched.sort(), ['src/a.js', 'src/b.js']); // only edited files, deduped, reads excluded
});

test('parseStreamJson: fail-soft — non-JSON / no result event falls back to raw text, empty touched', () => {
  const r = parseStreamJson('not json at all\n{broken');
  assert.equal(r.text, 'not json at all\n{broken');
  assert.deepEqual(r.touched, []);
  assert.equal(r.usage, undefined);
});

// ---- dead-session recovery + stdin (live path, via the spawnFn seam — no real claude) ----
const DEAD = 'No conversation found with session ID: 11111111-2222-3333-4444-555555555555';
const OK = JSON.stringify({ type: 'result', result: 'hi back', usage: { input_tokens: 5 } });

// A fake spawn: records each call and answers by args — `--resume` → `onResume`, fresh → ok.
function fakeSpawn({ onResume = { status: 1, stderr: DEAD } } = {}) {
  const calls = [];
  const fn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    const out = args.includes('--resume') ? onResume : { status: 0, stdout: OK };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (out.stdout) child.stdout.emit('data', out.stdout);
      if (out.stderr) child.stderr.emit('data', out.stderr);
      child.emit('close', out.status);
    });
    return child;
  };
  return { fn, calls };
}

test('isDeadSession: matches the purged-session error, not other failures', () => {
  assert.equal(isDeadSession(DEAD), true);
  assert.equal(isDeadSession('Error: rate limited'), false);
  assert.equal(isDeadSession(undefined), false);
});

test('a purged session is dropped and the turn reruns on a fresh session', async () => {
  const reg = { current: null, sessions: { ptah: { sessionId: 'dead-id', started: true } } };
  const { fn, calls } = fakeSpawn();
  const t = await runTurn('ptah', 'hello', { reg, settings: {}, spawnFn: fn });
  assert.equal(calls.length, 2, 'one failed resume + one fresh retry');
  assert.ok(calls[0].args.includes('--resume') && calls[0].args.includes('dead-id'));
  assert.ok(calls[1].args.includes('--session-id'), 'retry opens a fresh session');
  assert.equal(t.error, undefined);
  assert.equal(t.text, 'hi back');
  assert.equal(t.fresh, true);
  assert.equal(t.recovered, true);
  assert.notEqual(reg.sessions.ptah.sessionId, 'dead-id', 'registry points at the new session');
  assert.equal(reg.sessions.ptah.sessionId, t.sessionId);
});

test('a non-dead resume failure is reported, not retried, and keeps the session', async () => {
  const reg = { current: null, sessions: { ptah: { sessionId: 'live-id', started: true } } };
  const { fn, calls } = fakeSpawn({ onResume: { status: 1, stderr: 'Error: rate limited' } });
  const t = await runTurn('ptah', 'hello', { reg, settings: {}, spawnFn: fn });
  assert.equal(calls.length, 1);
  assert.equal(t.error, true);
  assert.match(t.text, /rate limited/);
  assert.equal(reg.sessions.ptah.sessionId, 'live-id');
});

test('claude is spawned with stdin ignored (no 3s "no stdin data" stall)', async () => {
  const reg = { current: null, sessions: {} };
  const { fn, calls } = fakeSpawn();
  await runTurn('ptah', 'hello', { reg, settings: {}, spawnFn: fn });
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('a recovered session is reseeded with continuity via opts.recoverReseed', async () => {
  const reg = { current: null, sessions: { ptah: { sessionId: 'dead-id', started: true } } };
  const { fn, calls } = fakeSpawn();
  await runTurn('ptah', 'hello', { reg, settings: {}, spawnFn: fn, recoverReseed: () => 'CONTEXT: earlier turns' });
  assert.equal(calls[1].args.at(-1), 'CONTEXT: earlier turns\n\nhello', 'fresh session gets reseed + the prompt');
  assert.equal(calls[0].args.at(-1), 'hello', 'the failed resume got the bare prompt');
});
