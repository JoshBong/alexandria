// A minimal OpenAI-compatible chat-completions client — the one client that covers any
// provider speaking that wire format (Ollama's local /v1, Gemini's OpenAI-compat endpoint,
// …). Non-streaming, single POST, no SDK. `fetchImpl` is injectable so tests never hit the
// network (mock-first, same pattern as src/update.js).

// config: { baseUrl, model, apiKeyEnv } — apiKeyEnv is the NAME of an env var to read the
// key from (not the key itself), e.g. 'GEMINI_API_KEY'. Unset/empty → no Authorization
// header at all, which is exactly what a local Ollama endpoint wants.
export async function chatCompletion(config, messages, { fetchImpl = fetch } = {}) {
  const { baseUrl, model, apiKeyEnv } = config;
  const key = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) throw new Error(`openai-compat: ${res.status} ${res.statusText}`);

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}
