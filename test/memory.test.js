// Tests for the Phase 2 memory seam: the open-ended folder adapter, the ark
// adapter (mocked subprocess), the createStore factory, the shouldRecall
// miss-policy, the secretary's composeTurn prompt-writer, and the recall wiring in
// Pharos. Written via the test-keeper tool. No network, no API, no real ark — the
// ark adapter's subprocess runner is injected; folder tests use a temp dir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createStore, shouldRecall } from '../src/memory/store.js';
import { createFolderStore } from '../src/memory/adapters/folder.js';
import { createArkStore } from '../src/memory/adapters/ark.js';
import { composeTurn } from '../src/pharos/compose.js';
import { handle } from '../src/pharos.js';

const tmpDir = (name) => mkdtempSync(join(tmpdir(), `alex-mem-${name}-`));
const tmpFile = (name) => join(tmpdir(), `alex-mem-${name}-${process.pid}.jsonl`);

// ---- folder adapter (open-ended: any directory, any structure) ----

test('folder: write then get round-trips a fact as a file', async () => {
  const root = tmpDir('rt');
  const store = createFolderStore({ root });
  const { id } = await store.write({ text: 'the ark query entrypoint is read-only', keeper: 'ptah', tags: ['ark'] });
  const got = await store.get(id);
  assert.match(got.text, /the ark query entrypoint is read-only/);
  assert.match(got.text, /keeper: ptah/, 'frontmatter round-trips');
  rmSync(root, { recursive: true, force: true });
});

test('folder: search ranks by token overlap and drops zero-overlap files', async () => {
  const root = tmpDir('rank');
  const store = createFolderStore({ root });
  await store.write({ text: 'pharos routes prompts to warm keepers' });
  await store.write({ text: 'the flight to sri lanka leaves in july' });
  await store.write({ text: 'pharos classifier scoring uses keeper profiles' });
  // Exact-token overlap (no stemming): classifier file shares 3 terms, router file 1.
  const hits = await store.search('the pharos classifier scoring profiles');
  assert.ok(hits.length >= 2, 'should match the two pharos files');
  assert.match(hits[0].text, /classifier/, `top hit should be the classifier file, got: ${hits[0].text}`);
  assert.ok(!hits.some((h) => /sri lanka/.test(h.text)), 'unrelated file must be dropped');
  rmSync(root, { recursive: true, force: true });
});

test('folder: works over an arbitrary pre-existing structure (nested, mixed types)', async () => {
  const root = tmpDir('struct');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(root, 'notes', 'deep'), { recursive: true });
  writeFileSync(join(root, 'notes', 'a.md'), '# Travel\nsri lanka visa and eta details');
  writeFileSync(join(root, 'notes', 'deep', 'b.txt'), 'the pharos classifier is local and api-free');
  writeFileSync(join(root, 'log.jsonl'), JSON.stringify({ note: 'pharos routes to keepers' }) + '\n');
  const store = createFolderStore({ root });
  const res = await store.search('pharos classifier');
  assert.ok(res.length >= 1);
  assert.match(res[0].id, /b\.txt$/, 'nested .txt with both terms ranks first');
  const got = await store.get('notes/a.md');
  assert.match(got.text, /sri lanka/);
  rmSync(root, { recursive: true, force: true });
});

test('folder: empty query returns no hits; write rejects empty text', async () => {
  const root = tmpDir('edge');
  const store = createFolderStore({ root });
  assert.deepEqual(await store.search('   '), []);
  await assert.rejects(() => store.write({ text: '  ' }), /non-empty/);
  rmSync(root, { recursive: true, force: true });
});

test('folder: get refuses to escape the root', async () => {
  const root = tmpDir('escape');
  const store = createFolderStore({ root });
  assert.equal(await store.get('../../../etc/passwd'), null);
  rmSync(root, { recursive: true, force: true });
});

// ---- ark adapter (mocked subprocess) ----

test('ark: search forwards to the runner and maps results to records', async () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return [{ id: 'project_orchestrator_layer.md', title: 'orchestrator', summary: 'ark is the memory backend', vault: 'memory', path: '/x', score: 9 }];
  };
  const hits = await createArkStore({ run }).search('orchestrator memory backend', { limit: 3 });
  assert.deepEqual(calls[0], ['orchestrator memory backend', '3']);
  assert.equal(hits[0].id, 'project_orchestrator_layer.md');
  assert.equal(hits[0].text, 'ark is the memory backend');
  assert.equal(hits[0].source, 'ark');
});

test('ark: search degrades to [] when the runner returns null (ark absent)', async () => {
  assert.deepEqual(await createArkStore({ run: () => null }).search('anything'), []);
});

test('ark: get forwards --get and maps a single record', async () => {
  const run = (args) => {
    assert.deepEqual(args, ['--get', 'foo.md']);
    return { id: 'foo.md', title: 'Foo', summary: 'a foo', vault: 'ark', path: '/foo.md' };
  };
  const got = await createArkStore({ run }).get('foo.md');
  assert.equal(got.id, 'foo.md');
  assert.equal(got.source, 'ark');
});

test('ark: write appends to the inbox without touching the index', async () => {
  const inbox = tmpFile('inbox');
  rmSync(inbox, { force: true });
  await createArkStore({ run: () => null, inbox }).write({ text: 'a durable fact from a turn', keeper: 'ra' });
  const line = JSON.parse(readFileSync(inbox, 'utf8').trim());
  assert.equal(line.text, 'a durable fact from a turn');
  assert.equal(line.via, 'alexandria');
  rmSync(inbox, { force: true });
});

// ---- factory ----

test('createStore: returns an injected adapter as-is', () => {
  const fake = { source: 'fake' };
  assert.equal(createStore({ adapter: fake }), fake);
});

test('createStore: kind selects the adapter; folder is the default', () => {
  assert.equal(createStore({ kind: 'ark' }).source, 'ark');
  assert.equal(createStore({ kind: 'folder' }).source, 'folder');
  assert.equal(createStore({}).source, 'folder');
});

// ---- miss-policy ----

test('shouldRecall: cold session is a miss', () => {
  assert.equal(shouldRecall({ routed: 'ptah', reason: 'argmax' }, { sessions: {} }), true);
});

test('shouldRecall: warm + confident is a hit (skip memory)', () => {
  assert.equal(shouldRecall({ routed: 'ptah', reason: 'argmax' }, { sessions: { ptah: { sessionId: 'x' } } }), false);
});

test('shouldRecall: low-confidence routing is a miss even when warm', () => {
  const warm = { sessions: { ptah: { sessionId: 'x' } } };
  assert.equal(shouldRecall({ routed: 'ptah', reason: 'sticky-below-floor' }, warm), true);
});

test('shouldRecall: intake is always a miss', () => {
  const warm = { sessions: { anubis: { sessionId: 'x' } } };
  assert.equal(shouldRecall({ routed: 'anubis', reason: 'argmax' }, warm), true);
});

// ---- composeTurn (the secretary's prompt-writer) ----

test('composeTurn: no recall → prompt passes through verbatim', () => {
  assert.equal(composeTurn({ prompt: 'ship it', recalled: [] }), 'ship it');
});

test('composeTurn: recall → context block + labelled request, user words intact', () => {
  const out = composeTurn({ prompt: 'fix the hook', recalled: [{ id: 'a.md', text: 'fact one\nsecond line' }] });
  assert.match(out, /pulled from memory/);
  assert.match(out, /- fact one \(a\.md\)/);
  assert.ok(!out.includes('second line'), 'only the first line of each record is used');
  assert.match(out, /Request: fix the hook/, "the user's prompt is wrapped, not rewritten");
});

// ---- recall wiring in Pharos ----

test('handle: on a miss, recalled context is searched and composed into the turn', async () => {
  const reg = { current: null, sessions: {} }; // cold → miss
  const store = { source: 'test', async search() { return [{ id: 'm.md', text: 'remembered detail', source: 'test' }]; }, async write() {}, async get() {} };
  const r = await handle('refactor the classifier', { mock: true, reg, persist: false, store });
  assert.equal(r.routed, 'ptah');
  assert.equal(r.recalled.length, 1);
  assert.match(r.text, /remembered detail/, 'composed turn (mock echo) should include recalled context');
  assert.match(r.text, /Request: refactor the classifier/);
});

test('handle: on a hit (warm + confident), memory is not consulted', async () => {
  const reg = { current: 'ptah', sessions: { ptah: { sessionId: 'mock-ptah', started: true } } };
  let searched = false;
  const store = { source: 'test', async search() { searched = true; return [{ text: 'nope' }]; }, async write() {}, async get() {} };
  const r = await handle('refactor the classifier scoring function', { mock: true, reg, persist: false, store });
  assert.equal(r.routed, 'ptah');
  assert.equal(searched, false, 'a warm confident turn must not hit memory');
  assert.deepEqual(r.recalled, []);
});
