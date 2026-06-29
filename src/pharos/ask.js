// A one-shot, stateless `claude -p` call — no session, no persona, no repo context.
//
// Used for the quick calls that aren't a full Keeper turn: Pharos's routing decision
// (read the message → pick a Keeper, on the cheap model) and the Keeper's reframe/revoice
// passes (on the Keeper's own model — the model is per-call). Clean (`--setting-sources
// local`, no CLAUDE.md) and sessionless so it's fast. Best-effort: returns '' on any
// failure so the caller can fall back (routing falls back to the keyword scorer).

import { spawn } from 'node:child_process';

export function askOnce(prompt, { model } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    env.ALEXANDRIA_BOAT = '1'; // suppress the operator's ark hooks inside the boat
    const args = ['-p', ...(model ? ['--model', model] : []), '--setting-sources', 'local', '--output-format', 'json', prompt];
    let child;
    try {
      child = spawn('claude', args, { env, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return resolve('');
    }
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve(''));
    child.on('close', () => {
      let text = out.trim();
      try { text = JSON.parse(text).result ?? text; } catch { /* relay raw */ }
      resolve(text);
    });
  });
}
