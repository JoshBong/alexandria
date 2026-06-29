#!/usr/bin/env node
// Alexandria front door — one prompt, Pharos routes it to the right warm Keeper.
//
//   node bin/pharos.js              # live (uses the claude CLI / subscription)
//   node bin/pharos.js --mock       # offline: routes + switches, no API calls
//   node bin/pharos.js --no-prewarm # skip the startup Keeper warmup
//
// Type a prompt and press enter.
//   /metrics   toggle the per-turn metrics line (token load, compaction, recall)
//   /status    show each Keeper's warm/cold state
//   /exit      quit

import readline from 'node:readline';
import path from 'node:path';
import { getSettings } from '../src/pharos/settings.js';
import { hasProfile, saveProfile, getProfile } from '../src/pharos/profile.js';

const mock = process.argv.includes('--mock');
const noPrewarm = process.argv.includes('--no-prewarm');
// Mock runs get their own throwaway registry so offline poking never overwrites the
// live warm sessions. Live runs use the default (.pharos/registry.json).
const registryPath = mock ? path.join(process.cwd(), '.pharos', 'registry.mock.json') : undefined;

// ---- tiny dependency-free terminal UI ----
const TTY = !!process.stdout.isTTY;
const C = TTY
  ? { reset: '\x1b[0m', dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', gray: '\x1b[90m', mag: '\x1b[35m', red: '\x1b[31m' }
  : { reset: '', dim: '', b: '', cyan: '', green: '', yellow: '', gray: '', mag: '', red: '' };
const W = () => Math.min(process.stdout.columns || 80, 96) - 2;
const rule = (ch = '─') => ch.repeat(Math.max(8, W()));

// The framed input box (top + left bar). The bottom border is drawn on submit, so the
// box closes neatly around whatever was typed. Plain prompt when not a TTY.
const PROMPT = TTY ? `${C.cyan}╭${rule()}╮${C.reset}\n${C.cyan}│${C.reset} ${C.b}${C.cyan}›${C.reset} ` : 'alexandria› ';
const closeBox = () => { if (TTY) process.stdout.write(`${C.cyan}╰${rule()}╯${C.reset}\n`); };

// An animated "thinking" line (braille spinner + elapsed seconds), cleared in place
// when the answer arrives. No-op on a non-TTY (keeps piped output clean).
function thinking(label = 'routing') {
  if (!TTY) return { stop() {} };
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const t0 = Date.now();
  let i = 0;
  const timer = setInterval(() => {
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`\r${C.cyan}${frames[i = (i + 1) % frames.length]}${C.reset} ${C.dim}${label}… ${s}s${C.reset}\x1b[K`);
  }, 80);
  return { stop() { clearInterval(timer); process.stdout.write('\r\x1b[K'); } };
}

const ask = (rl, q) => new Promise((res) => rl.question(q, res));

// First run: learn the operator's name BEFORE the Keeper registry is imported, so
// personas interpolate it. Only when interactive — a piped/non-TTY run (tests, CI)
// silently keeps the neutral default. profile.js pulls in nothing heavy.
if (!hasProfile() && process.stdin.isTTY) {
  const rl0 = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n  ${C.b}${C.cyan}✦ Alexandria${C.reset} ${C.dim}— first run.${C.reset}\n`);
  const name = (await ask(rl0, `  ${C.cyan}What should your Keepers call you?${C.reset} `)).trim();
  rl0.close();
  const saved = saveProfile({ name: name || 'operator' });
  console.log(`\n  ${C.green}✓${C.reset} Setting up Alexandria for ${C.b}${saved.name}${C.reset}…\n`);
}

const profile = getProfile();
const cfg = getSettings();
let showMetrics = cfg.metrics;

// Import the rest AFTER onboarding so KEEPERS build with the saved name.
const { handle } = await import('../src/pharos.js');
const { prewarmAll } = await import('../src/pharos/prewarm.js');
const { loadRegistry } = await import('../src/pharos/registry.js');
const { KEEPERS } = await import('../src/pharos/keepers.js');
const { tokenLimit } = await import('../src/pharos/tokens.js');

const roster = KEEPERS.filter((k) => k.active).map((k) => `${C.b}${k.id[0].toUpperCase() + k.id.slice(1)}${C.reset}${C.dim}(${k.alias})${C.reset}`).join('  ');

console.log('');
console.log(`  ${C.b}${C.cyan}Alexandria${C.reset}  ${C.dim}Pharos routes · Keepers hold · Alexandria remembers${C.reset}  ${C.gray}·${C.reset}  ${C.mag}${profile.name}${C.reset}`);
console.log(`  ${C.dim}${mock ? 'mock mode (no API)' : 'live mode'} ${C.reset}${roster}`);
console.log(`  ${C.gray}/metrics  /status  /exit${C.reset}`);
console.log('');

// Warm every Keeper up front (parallel) so the first switch to a domain resumes a
// hot, prompt-cached thread instead of cold-spawning one. Off in mock / --no-prewarm
// / when the setting is disabled. Best-effort.
if (!mock && !noPrewarm && cfg.prewarm) {
  const spin = thinking('warming Keepers');
  if (!TTY) process.stdout.write('  warming Keepers…');
  const { results } = await prewarmAll({ settings: cfg });
  spin.stop();
  const ok = results.filter((r) => r.ok).map((r) => r.alias);
  const failed = results.filter((r) => !r.ok).map((r) => r.alias);
  console.log(
    results.length
      ? `  ${C.green}✓${C.reset} ${ok.length} warm ${C.dim}(${ok.join(', ')})${C.reset}${failed.length ? `  ${C.yellow}· ${failed.length} cold (${failed.join(', ')})${C.reset}` : ''}`
      : `  ${C.dim}all Keepers already warm${C.reset}`,
  );
  console.log('');
}

// The per-turn metrics line — token load against the window, lifecycle flags, recall.
function printMetrics(r) {
  const lim = tokenLimit();
  const ctx = r.contextTokens || 0;
  const pct = lim ? Math.round((ctx / lim) * 100) : 0;
  const heat = pct >= 80 ? C.red : pct >= 50 ? C.yellow : C.green;
  const flags = [
    r.compacting && `${C.yellow}⟳ compacting${C.reset}`,
    r.degraded && `${C.red}⚠ degraded${C.reset}`,
    r.redone && !r.degraded && `${C.green}reseeded${C.reset}`,
    r.recalled?.length && `${C.dim}recalled ${r.recalled.length}${C.reset}`,
  ].filter(Boolean).join(`${C.dim} · ${C.reset}`);
  console.log(`  ${C.gray}⊙${C.reset} ${C.dim}ctx${C.reset} ${heat}${ctx.toLocaleString()}${C.reset}${C.dim}/${lim.toLocaleString()} (${pct}%) · ${r.fresh ? 'fresh' : 'warm'}${C.reset}${flags ? `${C.dim} · ${C.reset}${flags}` : ''}`);
}

function printStatus() {
  const reg = loadRegistry(registryPath);
  const cur = reg.current;
  console.log(`  ${C.b}Keepers${C.reset}`);
  for (const k of KEEPERS.filter((k) => k.active)) {
    const warm = !!(reg.sessions && reg.sessions[k.id]);
    const dot = warm ? `${C.green}●${C.reset}` : `${C.gray}○${C.reset}`;
    const here = cur === k.id ? `  ${C.cyan}← here${C.reset}` : '';
    console.log(`    ${dot} ${C.b}${k.id.padEnd(8)}${C.reset} ${C.dim}${k.alias.padEnd(10)}${warm ? 'warm' : 'cold'}${C.reset}${here}`);
  }
  console.log(`  ${C.dim}metrics ${showMetrics ? 'on' : 'off'}${cfg.mcpConfig ? ` · mcp ${cfg.mcpConfig}` : ''}${cfg.sharedTools ? ` · shared tools ${cfg.sharedTools}` : ''}${C.reset}`);
  console.log('');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: PROMPT });
rl.prompt();

// Serialize turns and track the in-flight one so a stdin close (EOF / piped input)
// waits for it instead of dropping it. Pause input while a turn runs.
let pending = Promise.resolve();
let closed = false;
rl.on('line', (line) => {
  const p = line.trim();
  closeBox();
  if (!p) return rl.prompt();
  if (p === '/exit' || p === '/quit') return rl.close();
  if (p === '/metrics') {
    showMetrics = !showMetrics;
    console.log(`  ${C.dim}metrics ${showMetrics ? `${C.green}on` : 'off'}${C.reset}\n`);
    return rl.prompt();
  }
  if (p === '/status') {
    printStatus();
    return rl.prompt();
  }

  rl.pause();
  pending = (async () => {
    const spin = thinking('routing');
    const r = await handle(p, { mock, registryPath });
    spin.stop();
    const arrow = r.switched ? `${C.cyan}↪${C.reset}` : `${C.gray}·${C.reset}`;
    const recall = r.recalled?.length ? ` ${C.dim}· recalled ${r.recalled.length}${C.reset}` : '';
    const flush = r.redone ? (r.degraded ? ` ${C.red}· ⚠ degraded${C.reset}` : ` ${C.green}· reseeded${C.reset}`) : '';
    const early = r.compacting ? ` ${C.yellow}· ⟳ pre-compacted${C.reset}` : '';
    console.log(`  ${arrow} ${C.b}${r.routed}${C.reset} ${C.dim}(${r.alias})${C.reset} ${C.gray}${r.note}${r.fresh ? ' · new' : ''}${C.reset}${recall}${flush}${early}`);
    if (showMetrics) printMetrics(r);
    console.log('');
    // Indent the answer body under a soft left gutter for readability.
    console.log(r.text.split('\n').map((l) => `  ${l}`).join('\n'));
    console.log('');
    if (closed) return; // EOF arrived mid-turn — don't touch a closed interface
    rl.resume();
    rl.prompt();
  })();
});

rl.on('close', async () => {
  closed = true;
  await pending; // don't drop a turn that's still flushing/logging
  console.log(`  ${C.dim}— Alexandria out.${C.reset}`);
  process.exit(0);
});
