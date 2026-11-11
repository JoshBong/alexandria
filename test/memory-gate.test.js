// The memory write gate (docs/memory-curation.md §3–4): transient facts and near-dups
// are skipped WITH a reason at the adapter boundary; provenance (written_by) rides
// every persisted record. Hermetic — temp dirs, no backend, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, readFileSync, mkdtempSync } from 'node:fs';
import { memoryPoisonReason, isDuplicate, gateWrite } from '../src/memory/gate.js';
import { createFolderStore } from '../src/memory/adapters/folder.js';
import { createExternalStore } from '../src/memory/adapters/external.js';

const tmpDir = (name) => mkdtempSync(join(tmpdir(), `alex-gate-${name}-`));

// ---- gate primitives ----

test('memoryPoisonReason: transient claims trip, specific-but-durable facts do NOT', () => {
  assert.ok(memoryPoisonReason('the deploy failed with error: ECONNRESET'));
  assert.ok(memoryPoisonReason('ollama is down right now'));
  assert.ok(memoryPoisonReason('the fetch timed out'));
  // NARROWER than the skill screen: paths/IPs/instance facts are legitimate memories.
  assert.equal(memoryPoisonReason('the user keeps notes at /Users/alex/notes'), null);
  assert.equal(memoryPoisonReason('the LAN ollama box is 192.168.1.9'), null);
  assert.equal(memoryPoisonReason('the user prefers direct answers, no preamble'), null);
});

test('isDuplicate: reworded-same collides, same-topic-new-fact passes', () => {
  const existing = ['the user prefers short direct answers with no preamble at all'];
  assert.equal(isDuplicate('the user prefers short direct answers with no preamble', existing), true);
  assert.equal(isDuplicate('the user registered for course enrollment on July 22', existing), false);
  assert.equal(isDuplicate('', existing), false); // empty text can never be a dup
});

test('gateWrite: poison wins over dup, reason names which rule fired', () => {
  const v = gateWrite('the build failed again', []);
  assert.equal(v.ok, false);
  assert.match(v.reason, /^transient:/);
  const d = gateWrite('same fact twice', ['same fact twice']);
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'near-duplicate');
  assert.deepEqual(gateWrite('a genuinely new durable fact', []), { ok: true });
});

// ---- folder adapter: gated + stamped ----

test('folder.write: transient fact skipped with reason; nothing lands on disk', async () => {
  const root = tmpDir('poison');
  const store = createFolderStore({ root });
  const out = await store.write({ text: 'the loop failed with error: parked' });
  assert.equal(out.skipped, true);
  assert.match(out.reason, /transient/);
  assert.equal((await store.search('loop parked')).length, 0);
  rmSync(root, { recursive: true, force: true });
});

test('folder.write: near-dup of a recent own-write skipped; fresh fact persists with written_by', async () => {
  const root = tmpDir('dup');
  const store = createFolderStore({ root });
  const first = await store.write({ text: 'the user studies linear algebra every weekday morning', writtenBy: 'anthropic/opus' });
  assert.ok(first.id);
  const again = await store.write({ text: 'the user studies linear algebra every weekday' });
  assert.equal(again.skipped, true);
  assert.equal(again.reason, 'near-duplicate');
  const raw = readFileSync(join(root, first.id), 'utf8');
  assert.match(raw, /written_by: anthropic\/opus/);
  rmSync(root, { recursive: true, force: true });
});

// ---- external adapter: same gate, inbox-tail dedup window ----

test('external.write: gated against the inbox tail + written_by stamped on the record', async () => {
  const dir = tmpDir('external');
  const inbox = join(dir, 'inbox.jsonl');
  const store = createExternalStore({ inbox, run: () => null });
  const ok = await store.write({ text: 'course enrollment opens july 22 at 9am', writtenBy: 'ollama/gpt-oss:20b' });
  assert.ok(ok.id);
  const dup = await store.write({ text: 'course enrollment opens july 22 9am' });
  assert.equal(dup.skipped, true);
  const poison = await store.write({ text: 'the sync timed out this morning' });
  assert.equal(poison.skipped, true);
  const rows = readFileSync(inbox, 'utf8').trim().split('\n');
  assert.equal(rows.length, 1, 'only the clean fact landed');
  assert.equal(JSON.parse(rows[0]).written_by, 'ollama/gpt-oss:20b');
  rmSync(dir, { recursive: true, force: true });
});
