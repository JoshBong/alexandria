// resolveRole: role -> {provider, model, call}. anthropic/* is verified hermetically via
// the same PATH-shimmed fake `claude` as test/ask.test.js (never spawns the real CLI);
// other providers are verified via an injected fetchImpl (never hits the network).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveRole } from '../../src/providers/registry.js';

function shimClaude(t, script) {
  const dir = mkdtempSync(join(tmpdir(), 'alexandria-registry-'));
  const f = join(dir, 'claude');
  writeFileSync(f, `#!/bin/sh\n${script}\n`);
  chmodSync(f, 0o755);
  const old = process.env.PATH;
  process.env.PATH = `${dir}:${old}`;
  t.after(() => { process.env.PATH = old; });
}

test('anthropic/* resolves provider + model, call() delegates to the unchanged askOnce CLI path', async (t) => {
  shimClaude(t, 'printf "%s\\n" "$@"'); // echoes argv, one per line
  const { provider, model, call } = resolveRole('escalate', { roles: { escalate: 'anthropic/opus' } });
  assert.equal(provider, 'anthropic');
  assert.equal(model, 'opus');
  const argv = await call('hi');
  assert.match(argv, /--model\nopus/); // askOnce forwarded the resolved model, unchanged
});

test('ollama/* builds an openai-compat call: no apiKeyEnv configured -> no Authorization header', async () => {
  const { provider, model, call } = resolveRole('base', { roles: { base: 'ollama/gpt-oss:20b' } });
  assert.equal(provider, 'ollama');
  assert.equal(model, 'gpt-oss:20b');
  let seenUrl, seenHeaders, seenBody;
  const fetchImpl = async (url, opts) => {
    seenUrl = url;
    seenHeaders = opts.headers;
    seenBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  const text = await call('hi', { fetchImpl });
  assert.equal(seenUrl, 'http://localhost:11434/v1/chat/completions');
  assert.equal(seenHeaders.Authorization, undefined);
  assert.deepEqual(seenBody, { model: 'gpt-oss:20b', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(text, 'ok');
});

test('gemini/* builds an openai-compat call with a system message prepended and the named apiKeyEnv', async () => {
  process.env.GEMINI_API_KEY = 'sekret';
  try {
    const { call } = resolveRole('creative', { roles: { creative: 'gemini/gemini-2.5-flash' } });
    let seenHeaders, seenBody;
    const fetchImpl = async (url, opts) => {
      seenHeaders = opts.headers;
      seenBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    await call('hi', { system: 'be creative', fetchImpl });
    assert.equal(seenHeaders.Authorization, 'Bearer sekret');
    assert.deepEqual(seenBody.messages, [
      { role: 'system', content: 'be creative' },
      { role: 'user', content: 'hi' },
    ]);
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test('ollama/* honors settings.ollamaUrl (non-default port / LAN box)', async () => {
  const { call } = resolveRole('base', { roles: { base: 'ollama/x' }, ollamaUrl: 'http://192.168.1.9:11434/v1' });
  let seenUrl;
  const fetchImpl = async (url) => {
    seenUrl = url;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  await call('hi', { fetchImpl });
  assert.equal(seenUrl, 'http://192.168.1.9:11434/v1/chat/completions');
});

test('an unknown provider throws at resolve time (loud failure, not a silent no-op)', () => {
  assert.throws(
    () => resolveRole('base', { roles: { base: 'mystery/foo' } }),
    /unknown provider "mystery"/,
  );
});

test('a missing or malformed role spec throws', () => {
  assert.throws(() => resolveRole('base', { roles: {} }), /role "base"/);
  assert.throws(() => resolveRole('base', { roles: { base: 'no-slash' } }), /role "base"/);
});
