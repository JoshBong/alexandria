// Keeper runner — runs one turn against a Keeper's persistent warm session.
//
// First turn for a Keeper: create a session with a stable id (--session-id) and
// the Keeper's persona (--append-system-prompt). Later turns: --resume that id,
// so the thread stays warm (its prior context is replayed). All over the `claude`
// CLI, so it bills to the subscription — NOT the per-token API (we strip
// ANTHROPIC_API_KEY from the child env to be sure).
//
// `mock: true` skips the CLI entirely and returns a deterministic line — used to
// test routing / stickiness / warm-switching offline, without the (flaky) API.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { KEEPERS } from './pharos/keepers.js';
import { CANARY_INSTRUCTION } from './pharos/canary.js';
import { contextTokensOf } from './pharos/tokens.js';
import { getSettings } from './pharos/settings.js';

export function runTurn(keeperId, prompt, { mock = false, reg, settings } = {}) {
  const keeper = KEEPERS.find((k) => k.id === keeperId) || { id: keeperId, alias: keeperId, persona: '' };
  const existing = reg.sessions[keeperId];
  const fresh = !existing;

  if (mock) {
    if (fresh) reg.sessions[keeperId] = { sessionId: `mock-${keeperId}`, started: true };
    const verb = fresh ? 'NEW session' : 'resume';
    return { text: `    [${keeperId}/${keeper.alias}] (mock ${verb}) → "${prompt}"`, sessionId: reg.sessions[keeperId].sessionId, fresh };
  }

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  // Mark this as a Keeper boat so Josh's private ark SessionStart hooks self-
  // suppress inside it (auto-load/canary/etc. early-exit on ALEXANDRIA_BOAT).
  // Without this the boat inherits the ark's `Ark:`/🐒 canary, which competes
  // with our own ⟡ marker and fires false `degraded` redos (wasted live calls);
  // it also inherits Josh's global handoff/identity injection — all off-topic to
  // a domain Keeper. The guard lives in the ark hooks, so forkers (no ark hooks)
  // are unaffected and Josh's direct sessions keep their canary.
  env.ALEXANDRIA_BOAT = '1';

  // Per-Keeper toolbox + headless permission bypass, sized to the domain. A reasoner
  // Keeper carries `--tools ''` (no built-in tool schemas → boat baseline ~5k, not
  // ~26k); only an acting Keeper (Ptah) carries a real set. skipPerms bypasses the
  // permission prompt a headless boat can't answer. Applied to fresh AND resume
  // spawns (tools are per-process, not stored in the session).
  const cfg = settings || getSettings();
  const extra = [];
  if (typeof keeper.tools === 'string') extra.push('--tools', keeper.tools);
  if (cfg.skipPerms) extra.push('--dangerously-skip-permissions');

  let args;
  let sessionId;
  if (fresh) {
    sessionId = randomUUID();
    // Persona + canary instruction set once at session creation; persists across
    // --resume turns (the system prompt isn't re-sent on resume).
    args = ['-p', '--session-id', sessionId, '--append-system-prompt', keeper.persona + CANARY_INSTRUCTION, ...extra, '--output-format', 'json', prompt];
  } else {
    sessionId = existing.sessionId;
    args = ['-p', '--resume', sessionId, ...extra, '--output-format', 'json', prompt];
  }

  const res = spawnSync('claude', args, { env, encoding: 'utf8', maxBuffer: 1e8 });
  if (res.error) {
    return { text: `    [${keeperId}] ⚠ failed to launch claude: ${res.error.message}`, sessionId, fresh, error: true };
  }
  if (res.status !== 0) {
    return { text: `    [${keeperId}] ⚠ claude exited ${res.status}: ${(res.stderr || '').trim().slice(0, 300)}`, sessionId, fresh, error: true };
  }

  let text = (res.stdout || '').trim();
  let usage;
  try {
    const parsed = JSON.parse(text);
    text = parsed.result ?? text;
    usage = parsed.usage; // per-turn token accounting → the EARLY compaction signal
  } catch {
    /* non-JSON output — relay raw */
  }

  reg.sessions[keeperId] = { sessionId, started: true };
  // contextTokens = the load carried into this turn (input + cache reads/creation).
  // Pharos uses it as the EARLY (token-low) flush trigger; see pharos/tokens.js.
  return { text, sessionId, fresh, usage, contextTokens: contextTokensOf(usage) };
}
