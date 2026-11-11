// askOnce flag + watchdog behavior — hermetic via a PATH-shimmed fake `claude` that
// echoes its argv (so we can assert what the real spawn would receive) or hangs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { askOnce, askOnceLogged } from '../src/pharos/ask.js';
import { readEvents } from '../src/pharos/events.js';

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

// ---- role routing (registry) — never breaks a turn ----

test('role: an unknown provider falls back to the default claude path unchanged', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"'); // echoes argv
  const argv = await askOnce('hi', { role: 'base', settings: { roles: { base: 'mystery/foo' } } });
  assert.match(argv, /--setting-sources\nlocal/); // reached the default CLI path
});

test('role: a missing role spec (no settings) falls back to the default claude path', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"');
  const argv = await askOnce('hi', { role: 'base' });
  assert.match(argv, /--setting-sources\nlocal/);
});

test('role: anthropic/* rides the same default path, forwarding the resolved model', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"');
  const argv = await askOnce('hi', { role: 'escalate', settings: { roles: { escalate: 'anthropic/opus' } } });
  assert.match(argv, /--model\nopus/);
});

test('role: a throwing provider call falls back to the default claude path', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"');
  const throwingFetch = async () => { throw new Error('network down'); };
  const argv = await askOnce('hi', {
    role: 'base',
    settings: { roles: { base: 'ollama/x' } },
    // fetchImpl isn't a real askOnce opt, but resolveRole's call(prompt, {system, fetchImpl})
    // reads it straight off — flows through 'rest' via the role path.
    fetchImpl: throwingFetch,
  });
  assert.match(argv, /--setting-sources\nlocal/);
});

test('role: a timed-out provider call falls back to the default claude path', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"');
  const hangingFetch = () => new Promise(() => {}); // never resolves
  // timeoutMs is spent once on the (hanging) role attempt, then again as the fallback
  // spawn's own watchdog — generous enough to absorb process-spawn overhead on a loaded
  // machine so this asserts the fallback happened, not a race against it.
  const argv = await askOnce('hi', {
    role: 'base',
    settings: { roles: { base: 'ollama/x' } },
    fetchImpl: hangingFetch,
    timeoutMs: 400,
  });
  assert.match(argv, /--setting-sources\nlocal/);
});

test('role: a successful provider call returns its text WITHOUT touching claude', async (t) => {
  shimClaude(t, 'echo SHOULD_NOT_RUN >&2; exit 1'); // fails loudly if reached
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'from ollama' } }] }) });
  const text = await askOnce('hi', { role: 'base', settings: { roles: { base: 'ollama/x' } }, fetchImpl });
  assert.equal(text, 'from ollama');
});

// ---- discount/offline mode — local base role, NO claude fallback ----

test('discountOffline: a role-less call routes to the local base role, never claude', async (t) => {
  shimClaude(t, 'echo SHOULD_NOT_RUN >&2; exit 1'); // fails loudly if reached
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'local' } }] }) });
  const text = await askOnce('hi', {
    settings: { discountOffline: true, roles: { base: 'ollama/gpt-oss:20b' } },
    fetchImpl,
  });
  assert.equal(text, 'local');
});

test('discountOffline: overrides an explicit role — everything runs on base', async () => {
  let writtenBy;
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
  await askOnce('hi', {
    role: 'escalate', // would be anthropic/opus — discount/offline pins it to base instead
    settings: { discountOffline: true, roles: { base: 'ollama/x', escalate: 'anthropic/opus' } },
    fetchImpl,
    onWrittenBy: (w) => { writtenBy = w; },
  });
  assert.equal(writtenBy, 'ollama/x');
});

test('discountOffline: a failing provider resolves "" — no claude fallback spawn', async (t) => {
  shimClaude(t, 'echo SHOULD_NOT_RUN >&2; exit 1');
  const fetchImpl = async () => { throw new Error('ollama down'); };
  const out = await askOnce('hi', {
    settings: { discountOffline: true, roles: { base: 'ollama/x' } },
    fetchImpl,
  });
  assert.equal(out, '');
});

test('discountOffline: a base role pointing at anthropic/* counts as not-local → "" (never leaves the machine)', async (t) => {
  shimClaude(t, 'echo SHOULD_NOT_RUN >&2; exit 1');
  const out = await askOnce('hi', { settings: { discountOffline: true, roles: { base: 'anthropic/haiku' } } });
  assert.equal(out, '');
});

// ---- written_by provenance stamp (only fires when the registry itself answered) ----

test('role: onWrittenBy fires with "provider/model" on a successful non-anthropic call', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
  let writtenBy;
  const text = await askOnce('hi', {
    role: 'base',
    settings: { roles: { base: 'ollama/gpt-oss:20b' } },
    fetchImpl,
    onWrittenBy: (w) => { writtenBy = w; },
  });
  assert.equal(text, 'ok');
  assert.equal(writtenBy, 'ollama/gpt-oss:20b');
});

test('role: onWrittenBy fires for a successful anthropic/* call too (the registry still produced it)', async (t) => {
  shimClaude(t, 'printf \'{"result":"ok"}\'');
  let writtenBy;
  const text = await askOnce('hi', {
    role: 'escalate',
    settings: { roles: { escalate: 'anthropic/opus' } },
    onWrittenBy: (w) => { writtenBy = w; },
  });
  assert.equal(text, 'ok');
  assert.equal(writtenBy, 'anthropic/opus');
});

test('role: onWrittenBy does NOT fire when the call falls back (unknown provider)', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"');
  let called = false;
  await askOnce('hi', {
    role: 'base',
    settings: { roles: { base: 'mystery/foo' } },
    onWrittenBy: () => { called = true; },
  });
  assert.equal(called, false);
});

test('role: onWrittenBy does NOT fire when the provider call throws (fallback wins)', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"');
  let called = false;
  const fetchImpl = async () => { throw new Error('network down'); };
  await askOnce('hi', {
    role: 'base',
    settings: { roles: { base: 'ollama/x' } },
    fetchImpl,
    onWrittenBy: () => { called = true; },
  });
  assert.equal(called, false);
});

test('a plain (no-role) call ignores an onWrittenBy passed by mistake — never fires, never throws', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"');
  let called = false;
  await askOnce('hi', { onWrittenBy: () => { called = true; } });
  assert.equal(called, false);
});

// ---- askOnceLogged: written_by lands in the REAL event log (readEvents round trip) ----

function tmpEventsFile() {
  const dir = mkdtempSync(join(tmpdir(), 'alexandria-events-'));
  return join(dir, 'events.jsonl');
}

test('askOnceLogged: a registry-produced answer writes an event with written_by="provider/model"', async () => {
  const file = tmpEventsFile();
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
  const { text, writtenBy } = await askOnceLogged(
    'hi',
    { role: 'base', settings: { roles: { base: 'ollama/gpt-oss:20b' } }, fetchImpl },
    { kind: 'test-call' },
    { file },
  );
  assert.equal(text, 'ok');
  assert.equal(writtenBy, 'ollama/gpt-oss:20b');
  const [row] = readEvents({ file });
  assert.equal(row.kind, 'test-call');
  assert.equal(row.written_by, 'ollama/gpt-oss:20b');
});

test('askOnceLogged: a fallback-to-claude answer stamps written_by="anthropic/<model>" in the event', async (t) => {
  shimClaude(t, 'printf \'{"result":"ok"}\'');
  const file = tmpEventsFile();
  const { text, writtenBy } = await askOnceLogged(
    'hi',
    { role: 'base', settings: { roles: { base: 'mystery/foo' } }, model: 'sonnet' }, // unknown provider -> fallback
    { kind: 'test-call' },
    { file },
  );
  assert.equal(text, 'ok');
  assert.equal(writtenBy, 'anthropic/sonnet');
  const [row] = readEvents({ file });
  assert.equal(row.written_by, 'anthropic/sonnet');
});

test('askOnceLogged: no role at all still stamps the real claude fallback identity ("default" with no model override)', async (t) => {
  shimClaude(t, 'printf \'{"result":"ok"}\'');
  const file = tmpEventsFile();
  const { writtenBy } = await askOnceLogged('hi', {}, {}, { file });
  assert.equal(writtenBy, 'anthropic/default');
  const [row] = readEvents({ file });
  assert.equal(row.written_by, 'anthropic/default');
});
