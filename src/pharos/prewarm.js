// Prewarm — establish every active Keeper's session on Alexandria start.
//
// Each Keeper's first real turn is otherwise a COLD fresh spawn: a new `claude`
// process that has to ingest the persona system prompt before it can answer. Here
// we pay that once, up front, for every active Keeper IN PARALLEL — a single tiny
// establishing turn that creates the session (so later turns `--resume` it) and
// primes the Anthropic prompt cache for the persona prefix. The first switch to a
// domain then lands on a warm thread with a cached prefix: faster and cheaper.
//
// Only ever does FRESH establishing spawns (never --resume), so it builds its own
// minimal args rather than threading through runTurn. Skips any Keeper that already
// holds a session (idempotent — re-running never double-spawns). Best-effort: a
// Keeper whose warmup fails is simply left cold and spawns normally on first use.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { KEEPERS } from './keepers.js';
import { CANARY_INSTRUCTION } from './canary.js';
import { getSettings } from './settings.js';
import { loadRegistry, saveRegistry } from './registry.js';

const WARM_PROMPT = 'Session warmup — you are now resident. Reply with exactly: ⟡ ready';

// Spawn one fresh establishing turn; resolve to the new sessionId on success, null
// on any failure. Async (node:child_process spawn) so all Keepers warm concurrently.
function spawnFresh(keeper, prompt, { settings }) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    env.ALEXANDRIA_BOAT = '1';
    const sessionId = randomUUID();
    const extra = [];
    if (typeof keeper.tools === 'string') extra.push('--tools', keeper.tools);
    if (settings.skipPerms) extra.push('--dangerously-skip-permissions');
    const args = ['-p', '--session-id', sessionId, '--append-system-prompt', keeper.persona + CANARY_INSTRUCTION, ...extra, '--output-format', 'json', prompt];
    const child = spawn('claude', args, { env, stdio: 'ignore' });
    let settled = false;
    const finish = (ok) => { if (settled) return; settled = true; resolve(ok ? sessionId : null); };
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

// Warm every active Keeper that doesn't already have a session, in parallel.
// Injectable: spawnFn (tests pass a stub — no subprocess), keepers, reg, save.
export async function prewarmAll({ settings, reg, keepers = KEEPERS, registryPath, save = true, spawnFn = spawnFresh, onResult } = {}) {
  const cfg = settings || getSettings();
  const registry = reg || loadRegistry(registryPath);
  registry.sessions = registry.sessions || {};
  const targets = keepers.filter((k) => k.active && !registry.sessions[k.id]);

  const results = await Promise.all(
    targets.map(async (k) => {
      const sessionId = await spawnFn(k, WARM_PROMPT, { settings: cfg });
      if (sessionId) registry.sessions[k.id] = { sessionId, started: true };
      if (onResult) onResult(k, !!sessionId);
      return { id: k.id, alias: k.alias, ok: !!sessionId };
    }),
  );

  if (save && targets.length) saveRegistry(registry, registryPath);
  return { reg: registry, results };
}
