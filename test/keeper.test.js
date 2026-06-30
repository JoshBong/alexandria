// Tests for the Keeper runner (mock path — no claude subprocess, no API).
// Written via the test-keeper tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, parseStreamJson } from '../src/keeper.js';

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
