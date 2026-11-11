// Offline: fetchImpl is always injected, so no real network call is ever made.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chatCompletion } from '../../src/providers/openai-compat.js';

const okFetch = (body) => async () => ({ ok: true, json: async () => body });
const messages = [{ role: 'user', content: 'hi' }];

test('POSTs {baseUrl}/chat/completions with model + messages in the body', async () => {
  let seenUrl, seenOpts;
  const fetchImpl = async (url, opts) => {
    seenUrl = url;
    seenOpts = opts;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  await chatCompletion({ baseUrl: 'http://localhost:11434/v1', model: 'gpt-oss:20b' }, messages, { fetchImpl });
  assert.equal(seenUrl, 'http://localhost:11434/v1/chat/completions');
  assert.equal(seenOpts.method, 'POST');
  assert.deepEqual(JSON.parse(seenOpts.body), { model: 'gpt-oss:20b', messages });
});

test('omits Authorization when apiKeyEnv is unset (Ollama)', async () => {
  let seenHeaders;
  const fetchImpl = async (url, opts) => {
    seenHeaders = opts.headers;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  await chatCompletion({ baseUrl: 'http://localhost:11434/v1', model: 'gpt-oss:20b' }, messages, { fetchImpl });
  assert.equal(seenHeaders.Authorization, undefined);
});

test('sends Bearer <key> from the named env var when apiKeyEnv is set (Gemini)', async () => {
  process.env.TEST_GEMINI_KEY = 'sekret';
  try {
    let seenHeaders;
    const fetchImpl = async (url, opts) => {
      seenHeaders = opts.headers;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    await chatCompletion(
      { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', apiKeyEnv: 'TEST_GEMINI_KEY' },
      messages,
      { fetchImpl },
    );
    assert.equal(seenHeaders.Authorization, 'Bearer sekret');
  } finally {
    delete process.env.TEST_GEMINI_KEY;
  }
});

test('omits Authorization when apiKeyEnv is set but the env var is empty', async () => {
  delete process.env.TEST_UNSET_KEY;
  let seenHeaders;
  const fetchImpl = async (url, opts) => {
    seenHeaders = opts.headers;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  await chatCompletion({ baseUrl: 'http://x', model: 'm', apiKeyEnv: 'TEST_UNSET_KEY' }, messages, { fetchImpl });
  assert.equal(seenHeaders.Authorization, undefined);
});

test('returns the assistant text from the response', async () => {
  const fetchImpl = okFetch({ choices: [{ message: { content: 'hello there' } }] });
  const text = await chatCompletion({ baseUrl: 'http://x', model: 'm' }, messages, { fetchImpl });
  assert.equal(text, 'hello there');
});

test('a non-ok response throws (never silently returns empty — caller/fallback decides)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
  await assert.rejects(
    () => chatCompletion({ baseUrl: 'http://x', model: 'm' }, messages, { fetchImpl }),
    /500/,
  );
});

test('no network: fetchImpl is the only I/O seam, default arg never invoked in these tests', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  await chatCompletion({ baseUrl: 'http://x', model: 'm' }, messages, { fetchImpl });
  assert.equal(calls, 1);
});
