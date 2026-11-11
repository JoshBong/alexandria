// A one-shot, stateless `claude -p` call — no session, no persona, no repo context.
//
// Used for the quick calls that aren't a full Keeper turn: Pharos's routing decision
// (read the message → pick a Keeper, on the cheap model) and the Keeper's reframe/revoice
// passes (on the Keeper's own model — the model is per-call). Clean (`--setting-sources
// local`, no CLAUDE.md) and sessionless so it's fast. Best-effort: returns '' on any
// failure so the caller can fall back (routing falls back to the keyword scorer).

import { spawn } from 'node:child_process';
import { resolveRole } from '../providers/registry.js';
import { logEvent } from './events.js';

// `role` (+ `settings`) routes this call through the provider registry instead of the
// default claude CLI path below. Never breaks a turn: if the role's provider is
// unconfigured (resolveRole throws — unknown provider, missing role spec) or its call
// throws or exceeds `timeoutMs`, this falls straight back to the unchanged default path
// with the same prompt/opts (minus role/settings). anthropic/* roles resolve BACK to this
// same default path (registry.js), so they're already on the fail-soft claude spawn below.
//
// `onWrittenBy` (optional) fires with '<provider>/<model>' ONLY when the registry itself
// produced the answer (no fallback) — the seam a caller uses to stamp `written_by` on its
// own event-log row (see pharos/events.js). askOnce's return stays a plain string in every
// case, fallback or not, so no existing caller's contract changes.
// Discount/offline mode (settings.discountOffline): every one-shot that reaches this
// with `settings` runs on the LOCAL base role — role overridden to 'base', and the
// claude-spawn fallback is DISABLED (falling back would silently leave the machine and
// the free tier). Failure then resolves '' — the same fail-to-empty contract as a dead
// boat — so callers' fail-soft paths behave as they already do.
export function askOnce(prompt, opts = {}) {
  const { role, settings, onWrittenBy, ...rest } = opts;
  if (settings?.discountOffline) return askOnceViaRole(prompt, 'base', settings, rest, onWrittenBy, { noFallback: true });
  if (!role) return askOnceDefault(prompt, rest);
  return askOnceViaRole(prompt, role, settings, rest, onWrittenBy);
}

// A caller that wants the registry's provenance made DURABLE (not just returned
// via the callback) uses this instead of wiring onWrittenBy by hand: same askOnce
// call, plus one event-log row (via pharos/events.js's logEvent) stamped
// `written_by`. `written_by` is the registry's 'provider/model' when the registry
// itself produced the answer, else the real fallback identity — askOnceDefault
// always spawns the claude CLI, so 'anthropic/<model>' (opts.model, or 'default'
// when no model override was given) is accurate whether the fallback triggered
// because `role` was absent, unconfigured, or the provider call failed. `event`
// seeds the row's other fields (same shape as any pharos/events.js entry);
// `eventOpts` forwards logEvent's own test seams (file/dir/enabled/now).
export async function askOnceLogged(prompt, opts = {}, event = {}, eventOpts = {}) {
  let writtenBy = null;
  const text = await askOnce(prompt, { ...opts, onWrittenBy: (w) => { writtenBy = w; } });
  writtenBy = writtenBy || `anthropic/${opts.model || 'default'}`;
  logEvent({ ...event, written_by: writtenBy }, eventOpts);
  return { text, writtenBy };
}

async function askOnceViaRole(prompt, role, settings, rest, onWrittenBy, { noFallback = false } = {}) {
  let resolved;
  try {
    resolved = resolveRole(role, settings);
    // Discount/offline promises "never leaves the machine" — a base role that resolves
    // to anthropic/* would ride the claude spawn, so it counts as unconfigured here.
    if (noFallback && resolved.provider === 'anthropic') throw new Error('discountOffline: base role is not local');
  } catch {
    return noFallback ? '' : askOnceDefault(prompt, rest); // unconfigured/unknown provider
  }
  try {
    // fetchImpl is not a real askOnce opt — it's a test-only seam that flows straight
    // through to a non-anthropic provider's chatCompletion call (see openai-compat.js).
    const text = await withTimeout(resolved.call(prompt, { system: rest.system, fetchImpl: rest.fetchImpl }), rest.timeoutMs);
    if (onWrittenBy) onWrittenBy(`${resolved.provider}/${resolved.model}`);
    return text;
  } catch {
    return noFallback ? '' : askOnceDefault(prompt, rest); // threw or timed out
  }
}

function withTimeout(promise, timeoutMs) {
  if (!timeoutMs) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('askOnce: role call timed out')), timeoutMs);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function askOnceDefault(prompt, { model, system, tools, skipPerms, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    env.ALEXANDRIA_BOAT = '1'; // suppress the operator's own SessionStart hooks inside the boat
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
