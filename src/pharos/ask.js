// A one-shot, stateless `claude -p` call — no session, no persona, no repo context.
//
// Used for the quick calls that aren't a full Keeper turn: Pharos's routing decision
// (read the message → pick a Keeper, on the cheap model) and the Keeper's reframe/revoice
// passes (on the Keeper's own model — the model is per-call). Clean (`--setting-sources
// local`, no CLAUDE.md) and sessionless so it's fast. Best-effort: returns '' on any
// failure so the caller can fall back (routing falls back to the keyword scorer).

import { spawn } from 'node:child_process';

export function askOnce(prompt, { model, system, tools, skipPerms, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    env.ALEXANDRIA_BOAT = '1'; // suppress the operator's ark hooks inside the boat
    // `system` is the optional Keeper persona/instruction for reframe & revoice (passed
    // as a second arg by those seams). Without it this stays the plain routing call.
    // `tools` (+ `skipPerms`) let a caller grant this one-shot real capability — the
    // research fan-out workers pass `WebSearch,WebFetch` so they can actually search;
    // skipPerms mirrors a boat so a headless call never hangs on a permission prompt.
    // `tools: ''` is meaningful (disables ALL built-ins), so the guard is on undefined.
    const args = ['-p',
      ...(model ? ['--model', model] : []),
      ...(system ? ['--append-system-prompt', system] : []),
      ...(tools !== undefined ? ['--tools', tools] : []),
      ...(skipPerms ? ['--dangerously-skip-permissions'] : []),
      '--setting-sources', 'local', '--output-format', 'json', prompt];
    let child;
    try {
      child = spawn('claude', args, { env, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return resolve('');
    }
    // Optional watchdog: a hung boat resolves '' instead of hanging the caller forever
    // (the research fan-out awaits N of these in a Promise.all). Resolve straight from the
    // timer — 'close' can lag arbitrarily when a grandchild keeps the stdout pipe open —
    // and destroy the pipe so it can't hold the event loop. No timeoutMs = old behavior.
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      try { child.stdout.destroy(); } catch { /* already closed */ }
      resolve('');
    }, timeoutMs) : null;
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { if (timer) clearTimeout(timer); resolve(''); });
    child.on('close', () => {
      if (timer) clearTimeout(timer);
      if (timedOut) return; // already resolved by the watchdog
      let text = out.trim();
      try { text = JSON.parse(text).result ?? text; } catch { /* relay raw */ }
      resolve(text);
    });
  });
}
