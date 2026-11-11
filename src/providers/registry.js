// Resolves a settings role ('base' | 'creative' | 'bulk' | 'escalate' — see ROLES_DEFAULTS
// in src/pharos/settings.js) to a runnable provider: { provider, model, call }.
//
// `call(prompt, { system } = {})` is deliberately shaped like askOnce (src/pharos/ask.js)
// so a caller can swap roles without branching on provider. anthropic/* rides the
// existing claude one-shot path UNCHANGED (askOnce already knows the CLI's model names,
// auth, sessionless semantics); every other provider builds a generic OpenAI-compatible
// call via chatCompletion.

import { askOnce } from '../pharos/ask.js';
import { chatCompletion } from './openai-compat.js';

// Known non-anthropic providers and how to reach them, keyed by the provider segment of
// a role's 'provider/model' string. apiKeyEnv is the NAME of an env var (see openai-compat).
const PROVIDER_CONFIGS = {
  ollama: { baseUrl: 'http://localhost:11434/v1' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'GEMINI_API_KEY' },
};

export function resolveRole(role, settings) {
  const spec = settings?.roles?.[role];
  const slash = typeof spec === 'string' ? spec.indexOf('/') : -1;
  if (slash <= 0) throw new Error(`resolveRole: no 'provider/model' string for role "${role}"`);

  const provider = spec.slice(0, slash);
  const model = spec.slice(slash + 1);

  if (provider === 'anthropic') {
    return { provider, model, call: (prompt, opts = {}) => askOnce(prompt, { ...opts, model }) };
  }

  let config = PROVIDER_CONFIGS[provider];
  if (!config) throw new Error(`resolveRole: unknown provider "${provider}" (role "${role}")`);
  // The Ollama server's location is a setting (non-default port, a box on the LAN),
  // not a code constant — see settings.js ollamaUrl.
  if (provider === 'ollama' && settings?.ollamaUrl) config = { ...config, baseUrl: settings.ollamaUrl };

  return {
    provider,
    model,
    call: (prompt, { system, fetchImpl } = {}) => {
      const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
      return chatCompletion({ ...config, model }, messages, fetchImpl ? { fetchImpl } : {});
    },
  };
}
