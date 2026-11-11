// Learn-over-time: the forked extractor that drives the P2 write path. Extraction
// parsing + fail-soft, and gated persistence with provenance. Hermetic — the one-shot
// runner and the store are both injected; no claude, no network, no real files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { extractFacts, learnFromTurn } from '../src/memory/learn.js';
import { createFolderStore } from '../src/memory/adapters/folder.js';

// ---- extractFacts ----

test('extractFacts: parses durable facts and captures provenance via onWrittenBy', async () => {
  const ask = async (_prompt, { onWrittenBy } = {}) => {
    onWrittenBy('anthropic/haiku');
    return '{"facts":["the user is in a data science grad program","the user prefers direct answers"]}';
  };
  const { facts, writtenBy } = await extractFacts({ prompt: 'what classes', answer: 'depends on your program', keeper: 'thoth' }, { ask });
  assert.deepEqual(facts, ['the user is in a data science grad program', 'the user prefers direct answers']);
  assert.equal(writtenBy, 'anthropic/haiku');
});

test('extractFacts: fail-soft — no runner, empty exchange, junk reply, or a throw all yield no facts', async () => {
  assert.deepEqual((await extractFacts({ prompt: 'x', answer: 'y' }, {})).facts, []); // no ask
  assert.deepEqual((await extractFacts({ prompt: '', answer: 'y' }, { ask: async () => '{"facts":["z"]}' })).facts, []); // empty prompt
  assert.deepEqual((await extractFacts({ prompt: 'x', answer: 'y' }, { ask: async () => 'I have no idea' })).facts, []); // unparseable
  assert.deepEqual((await extractFacts({ prompt: 'x', answer: 'y' }, { ask: async () => { throw new Error('down'); } })).facts, []); // throw
});

test('extractFacts: drops non-string / blank entries, trims the rest', async () => {
  const ask = async () => '{"facts":["  real fact  ", "", 42, null, "another"]}';
  const { facts } = await extractFacts({ prompt: 'x', answer: 'y' }, { ask });
  assert.deepEqual(facts, ['real fact', 'another']);
});

// ---- learnFromTurn: extract → gated write with provenance ----

test('learnFromTurn: durable facts persist through the gate with written_by; junk is skipped', async () => {
  const root = mkdtempSync(join(tmpdir(), 'alex-learn-'));
  const store = createFolderStore({ root });
  const ask = async (_p, { onWrittenBy } = {}) => {
    onWrittenBy('ollama/gpt-oss:20b');
    // one durable fact, one transient (gate rejects), one dup of the first
    return '{"facts":["the user founded a startup then wound it down","the build failed with error: x","the user founded a startup then wound it down too"]}';
  };
  const { written, skipped } = await learnFromTurn({ prompt: 'tell me about the startup', answer: '...', keeper: 'horus' }, { ask, store });
  assert.equal(written.length, 1, 'only the one clean, non-dup fact lands');
  assert.equal(skipped.length, 2);
  assert.ok(skipped.some((s) => /transient/.test(s.reason)));
  assert.ok(skipped.some((s) => s.reason === 'near-duplicate'));
  const raw = readFileSync(join(root, written[0]), 'utf8'); // written[0] is the mem-*.md id
  assert.match(raw, /written_by: ollama\/gpt-oss:20b/);
  assert.match(raw, /keeper: horus/);
  rmSync(root, { recursive: true, force: true });
});

test('learnFromTurn: no store → no-op, never throws', async () => {
  const out = await learnFromTurn({ prompt: 'x', answer: 'y' }, { ask: async () => '{"facts":["z"]}' });
  assert.deepEqual(out, { written: [], skipped: [] });
});
