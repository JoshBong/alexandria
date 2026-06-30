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

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KEEPERS } from './pharos/keepers.js';
import { CANARY_INSTRUCTION } from './pharos/canary.js';
import { contextTokensOf } from './pharos/tokens.js';
import { getSettings } from './pharos/settings.js';

// Where a boat runs. A `clean` (reasoner) Keeper spawns from a neutral, empty dir
// OUTSIDE the repo (a git repo leaks the operator's git identity into the model's env
// context — that's how a personal Keeper ended up answering "your name is <git
// user.name>"). An out-of-repo temp dir has no git, no project files, no CLAUDE.md to
// inhabit, so the Keeper relies purely on its persona. Ptah (code) keeps the repo cwd
// (undefined → inherit). Created on demand; stable across prewarm and live turns.
export function boatCwd(keeper) {
  if (!keeper.clean) return undefined;
  const dir = join(tmpdir(), 'alexandria-keeper-cwd');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return dir;
}

// The per-boat spawn flags shared by EVERY `claude` invocation for a Keeper, so a
// prewarm spawn and a live turn open identical sessions (no context drift):
//   --tools <list>            keeper's built-ins + shared on-demand tools (lean by
//                             default; '' disables all built-ins)
//   --setting-sources local   for `clean` Keepers — skip project/user CLAUDE.md
//                             auto-discovery (a personal/career Keeper shouldn't
//                             inherit the repo's dev-tooling context)
//   --dangerously-skip-permissions   headless boats can't answer a permission prompt
//   --mcp-config <path>       shared connector config (browser/Gmail/calendar), if set
// MCP connectors stay DEFERRED — available on demand, never injected up front.
export function boatExtraArgs(keeper, cfg) {
  const extra = [];
  const toolParts = [keeper.tools, cfg.sharedTools].filter((s) => typeof s === 'string' && s.length);
  if (typeof keeper.tools === 'string') extra.push('--tools', toolParts.join(','));
  if (keeper.clean) extra.push('--setting-sources', 'local');
  if (cfg.skipPerms) extra.push('--dangerously-skip-permissions');
  if (cfg.mcpConfig) extra.push('--mcp-config', cfg.mcpConfig);
  // A Keeper's own `model` wins over the global setting — so a generalist like Anubis
  // can run on a cheaper model than the acting/specialist Keepers. Falls back to cfg.model,
  // then the CLI default.
  const model = keeper.model || cfg.model;
  if (model) extra.push('--model', model);
  return extra;
}

// Tools whose calls mean the turn ACTED ON a file (vs merely reading it). `touched` is
// the set of files a turn changed — the granularity plateau (repeated same-file thrash)
// and scope-creep (a file no planned step declared) both compare. Reads are excluded on
// purpose: reading a file is not unplanned work and is not thrash.
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Parse `claude --output-format stream-json` NDJSON: harvest the final text + usage from
// the `result` event and the edited file paths from every assistant `tool_use` block.
// Fail-soft: unparseable lines are skipped; an empty/garbled stream falls back to the raw
// stdout as text (so a transport hiccup degrades to "answer, no touched", never a crash).
export function parseStreamJson(stdout) {
  const raw = String(stdout || '');
  let text = '';
  let usage;
  const touched = new Set();
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const b of ev.message.content) {
        if (b && b.type === 'tool_use' && EDIT_TOOLS.has(b.name) && b.input && b.input.file_path) {
          touched.add(b.input.file_path);
        }
      }
    } else if (ev.type === 'result') {
      if (typeof ev.result === 'string') text = ev.result;
      if (ev.usage) usage = ev.usage;
    }
  }
  return { text: text || raw.trim(), usage, touched: [...touched] };
}

// ASYNC by design: the live turn spawns `claude` non-blocking (was spawnSync, which
// froze the whole event loop for the turn's duration — so any setInterval, like the
// thinking spinner, never painted). With async spawn the loop stays free to animate
// while the boat thinks. The mock path is synchronous work wrapped in the async return.
export async function runTurn(keeperId, prompt, { mock = false, reg, settings } = {}) {
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

  // Per-Keeper spawn flags (tools / clean context / perms / shared connectors),
  // sized to the domain and applied to fresh AND resume spawns (these are
  // per-process, not stored in the session). See boatExtraArgs.
  const cfg = settings || getSettings();
  const extra = boatExtraArgs(keeper, cfg);

  let args;
  let sessionId;
  // stream-json (+ required --verbose) instead of plain json: the streamed event log
  // carries the per-turn TOOL CALLS, not just the final text — that's how we surface
  // `touched` (the files this turn edited) so the loop's plateau (g1) and scope/risk
  // drift (g2) detectors have real signal live. The final `result` event still carries
  // the text + usage, so contextTokens/canary behave exactly as before.
  if (fresh) {
    sessionId = randomUUID();
    // Persona + canary instruction set once at session creation; persists across
    // --resume turns (the system prompt isn't re-sent on resume).
    args = ['-p', '--session-id', sessionId, '--append-system-prompt', keeper.persona + CANARY_INSTRUCTION, ...extra, '--output-format', 'stream-json', '--verbose', prompt];
  } else {
    sessionId = existing.sessionId;
    args = ['-p', '--resume', sessionId, ...extra, '--output-format', 'stream-json', '--verbose', prompt];
  }

  const res = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn('claude', args, { env, cwd: boatCwd(keeper) });
    } catch (error) {
      return resolve({ error });
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => resolve({ error }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  if (res.error) {
    return { text: `    [${keeperId}] ⚠ failed to launch claude: ${res.error.message}`, sessionId, fresh, error: true };
  }
  if (res.status !== 0) {
    return { text: `    [${keeperId}] ⚠ claude exited ${res.status}: ${(res.stderr || '').trim().slice(0, 300)}`, sessionId, fresh, error: true };
  }

  const { text, usage, touched } = parseStreamJson(res.stdout);

  reg.sessions[keeperId] = { sessionId, started: true };
  // contextTokens = the load carried into this turn (input + cache reads/creation).
  // Pharos uses it as the EARLY (token-low) flush trigger; see pharos/tokens.js.
  // touched = the files this turn edited → the loop's plateau/drift detectors.
  return { text, sessionId, fresh, usage, contextTokens: contextTokensOf(usage), touched };
}
