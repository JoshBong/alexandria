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
import fs from 'node:fs';
import { getSettings, saveSettings } from '../src/pharos/settings.js';
import { hasProfile, saveProfile, getProfile } from '../src/pharos/profile.js';

const mock = process.argv.includes('--mock');
const noPrewarm = process.argv.includes('--no-prewarm');
// Mock runs get their own throwaway registry so offline poking never overwrites the
// live warm sessions. Live runs use the default (.pharos/registry.json).
const registryPath = mock ? path.join(process.cwd(), '.pharos', 'registry.mock.json') : undefined;

// ---- tiny dependency-free terminal UI · gold (Egypt) theme ----
const TTY = !!process.stdout.isTTY;
const g = (n) => (TTY ? `\x1b[38;5;${n}m` : ''); // 256-colour
const C = {
  reset: TTY ? '\x1b[0m' : '', dim: TTY ? '\x1b[2m' : '', b: TTY ? '\x1b[1m' : '',
  gold: g(220), // bright gold — primary accent
  deep: g(178), // deep gold
  bronze: g(136), // bronze — rules / muted
  sand: g(223), // light sand — body highlights
  green: g(108), // sage — warm/ok
  red: g(174), // soft red — errors/degraded
  gray: g(244), // muted gray — notes
};
const W = () => Math.min(process.stdout.columns || 80, 96) - 2;
const rule = (ch = '─') => ch.repeat(Math.max(8, W()));

// The input prompt: a slim bronze rule above (the "line around where you type") and a
// gold ankh marker — open by design, so nothing ever looks half-drawn or cut off. A
// true fixed-bottom floating box would need a raw-mode TUI; this reads clean in plain
// readline. Plain prompt when not a TTY.
const PROMPT = TTY ? `\n  ${C.gold}◆${C.reset} ${C.deep}›${C.reset} ` : 'alexandria› ';

// An animated "thinking" line (braille spinner + elapsed seconds), cleared in place
// when the answer arrives. No-op on a non-TTY (keeps piped output clean).
function thinking(label = 'routing') {
  if (!TTY) return { stop() {} };
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const t0 = Date.now();
  let i = 0;
  const timer = setInterval(() => {
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`\r${C.gold}${frames[i = (i + 1) % frames.length]}${C.reset} ${C.dim}${label}… ${s}s${C.reset}\x1b[K`);
  }, 80);
  return { stop() { clearInterval(timer); process.stdout.write('\r\x1b[K'); } };
}

const ask = (rl, q) => new Promise((res) => rl.question(q, res));

// First run: learn the operator's name BEFORE the Keeper registry is imported, so
// personas interpolate it. Only when interactive — a piped/non-TTY run (tests, CI)
// silently keeps the neutral default. profile.js pulls in nothing heavy.
if (!hasProfile() && process.stdin.isTTY) {
  const rl0 = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n  ${C.b}${C.gold}✦ Alexandria${C.reset} ${C.dim}— first run.${C.reset}\n`);
  const name = (await ask(rl0, `  ${C.gold}What should your Keepers call you?${C.reset} `)).trim();
  rl0.close();
  const saved = saveProfile({ name: name || 'operator' });
  console.log(`\n  ${C.green}✓${C.reset} Setting up Alexandria for ${C.b}${saved.name}${C.reset}…\n`);
}

const profile = getProfile();
let cfg = getSettings();
let showMetrics = cfg.metrics;

// Import the rest AFTER onboarding so KEEPERS build with the saved name.
const { handle } = await import('../src/pharos.js');
const { prewarmAll } = await import('../src/pharos/prewarm.js');
const { loadRegistry } = await import('../src/pharos/registry.js');
const { KEEPERS } = await import('../src/pharos/keepers.js');
const { tokenLimit } = await import('../src/pharos/tokens.js');

const roster = KEEPERS.filter((k) => k.active).map((k) => `${C.b}${k.id[0].toUpperCase() + k.id.slice(1)}${C.reset}${C.dim}(${k.alias})${C.reset}`).join('  ');

console.log('');
console.log(`  ${C.b}${C.gold}Alexandria${C.reset}  ${C.dim}Pharos routes · Keepers hold · Alexandria remembers${C.reset}  ${C.gray}·${C.reset}  ${C.sand}${profile.name}${C.reset}`);
console.log(`  ${C.dim}${mock ? 'mock mode (no API)' : 'live mode'} ${C.reset}${roster}`);
console.log(`  ${C.gray}/help for commands  ·  /exit to quit${C.reset}`);
console.log('');

// Warm every Keeper up front (parallel) so the first switch to a domain resumes a
// hot, prompt-cached thread instead of cold-spawning one. Off in mock / --no-prewarm
// / when the setting is disabled. Best-effort.
//
// The boot animation: light the Pharos. Each Keeper is a lamp that flickers (braille
// spinner) until its session is established, then locks to a steady ●. They warm in
// parallel and finish at slightly different times, so the row lights up organically —
// which is exactly what hides the few seconds of spin-up.
if (!mock && !noPrewarm && cfg.prewarm) {
  const active = KEEPERS.filter((k) => k.active);
  const reg0 = loadRegistry();
  const lit = Object.fromEntries(active.map((k) => [k.id, !!(reg0.sessions && reg0.sessions[k.id])]));
  const flames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const label = (k) => k.id[0].toUpperCase() + k.id.slice(1);

  if (TTY) {
    let frame = 0;
    const render = () => {
      const cells = active.map((k) =>
        lit[k.id]
          ? `${C.deep}◆${C.reset} ${C.b}${label(k)}${C.reset}`
          : `${C.gray}${flames[frame % flames.length]}${C.reset} ${C.dim}${label(k)}${C.reset}`,
      ).join('   ');
      process.stdout.write(`\r  ${C.dim}lighting the Pharos${C.reset}  ${cells}\x1b[K`);
    };
    process.stdout.write(`\n  ${C.gold}${C.b}✦ Alexandria${C.reset}\n\n`);
    const timer = setInterval(() => { frame++; render(); }, 80);
    render();
    await prewarmAll({ settings: cfg, onResult: (k, ok) => { lit[k.id] = ok || lit[k.id]; render(); } });
    clearInterval(timer);
    render();
    process.stdout.write('\n\n');
  } else {
    process.stdout.write('  warming Keepers…');
    const { results } = await prewarmAll({ settings: cfg });
    const ok = results.filter((r) => r.ok).length;
    console.log(` ${ok} warm\n`);
  }
}

// The per-turn metrics line — token load against the window, lifecycle flags, recall.
function printMetrics(r) {
  const lim = tokenLimit();
  const ctx = r.contextTokens || 0;
  const pct = lim ? Math.round((ctx / lim) * 100) : 0;
  const heat = pct >= 80 ? C.red : pct >= 50 ? C.deep : C.green;
  const flags = [
    r.compacting && `${C.deep}⟳ compacting${C.reset}`,
    r.degraded && `${C.red}⚠ degraded${C.reset}`,
    r.redone && !r.degraded && `${C.green}reseeded${C.reset}`,
    r.recalled?.length && `${C.dim}recalled ${r.recalled.length}${C.reset}`,
  ].filter(Boolean).join(`${C.dim} · ${C.reset}`);
  console.log(`  ${C.gray}⊙${C.reset} ${C.dim}ctx${C.reset} ${heat}${ctx.toLocaleString()}${C.reset}${C.dim}/${lim.toLocaleString()} (${pct}%) · ${r.fresh ? 'fresh' : 'warm'}${C.reset}${flags ? `${C.dim} · ${C.reset}${flags}` : ''}`);
}

// /settings — view and toggle. `/settings` lists; `/settings <key>` flips a bool;
// `/settings <key> <value>` sets a string (sharedTools/mcpConfig). Writes through to
// .pharos/settings.json so the next turn's getSettings() picks it up.
const BOOL_KEYS = ['reframe', 'revoice', 'skipPerms', 'prewarm', 'metrics'];
const STR_KEYS = ['sharedTools', 'mcpConfig'];
const SETTING_HELP = {
  reframe: 'secretary rewrites your prompt for the Keeper',
  revoice: 'secretary re-voices the Keeper\'s answer',
  skipPerms: 'boats run headless (skip permission prompts)',
  prewarm: 'warm all Keepers on startup',
  metrics: 'show the per-turn metrics line',
  sharedTools: 'extra built-in tools every Keeper can load on demand',
  mcpConfig: 'shared MCP connector config (browser/Gmail/…) for every Keeper',
};
function printSettings() {
  console.log(`  ${C.b}${C.gold}Settings${C.reset}`);
  for (const k of BOOL_KEYS) {
    const on = cfg[k];
    console.log(`    ${on ? `${C.green}●${C.reset}` : `${C.gray}○${C.reset}`} ${C.b}${k.padEnd(11)}${C.reset} ${C.dim}${(on ? 'on' : 'off').padEnd(4)} ${SETTING_HELP[k]}${C.reset}`);
  }
  for (const k of STR_KEYS) {
    console.log(`    ${C.gray}◦${C.reset} ${C.b}${k.padEnd(11)}${C.reset} ${C.dim}${(cfg[k] || '(none)')}  ${SETTING_HELP[k]}${C.reset}`);
  }
  console.log(`  ${C.gray}/settings <key> to toggle · /settings <key> <value> to set${C.reset}\n`);
}
function changeSettings(args) {
  const [key, ...rest] = args;
  if (!key) return printSettings();
  if (BOOL_KEYS.includes(key)) {
    const val = rest.length ? /^(1|true|on|yes)$/i.test(rest[0]) : !cfg[key];
    cfg = saveSettings({ [key]: val });
    if (key === 'metrics') showMetrics = val;
    console.log(`  ${C.green}✓${C.reset} ${key} ${val ? `${C.green}on` : 'off'}${C.reset}\n`);
  } else if (STR_KEYS.includes(key)) {
    const val = rest.join(' ');
    cfg = saveSettings({ [key]: val });
    console.log(`  ${C.green}✓${C.reset} ${key} = ${C.gold}${val || '(none)'}${C.reset}\n`);
  } else {
    console.log(`  ${C.red}unknown setting${C.reset} ${C.dim}'${key}' — try one of: ${[...BOOL_KEYS, ...STR_KEYS].join(', ')}${C.reset}\n`);
  }
}

// /reset — wipe all operator state (.pharos: profile, settings, overrides, registry,
// memory, warm sessions) so the next launch is a clean first-run. For testing the
// setup flow from scratch. TODO before public release: gate behind an "are you sure?"
// confirm so nobody nukes their state by accident.
function doReset() {
  const dir = path.join(process.cwd(), '.pharos');
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  console.log(`  ${C.green}✓${C.reset} reset — operator state wiped ${C.dim}(${dir})${C.reset}`);
  console.log(`  ${C.dim}restart Alexandria (npm run alexandria) to set up from scratch.${C.reset}\n`);
}

// Interactive /settings — an arrow-key menu so you can flip several at once. ↑↓ move,
// enter toggles a bool / edits a string inline, esc leaves. Raw-mode; falls back to the
// static list on a non-TTY. Pauses the main readline while it owns the keyboard.
function settingsMenu() {
  if (!TTY) { printSettings(); return Promise.resolve(); }
  const rows = [...BOOL_KEYS.map((k) => ({ k, type: 'bool' })), ...STR_KEYS.map((k) => ({ k, type: 'str' }))];
  let idx = 0, printed = 0, editing = null;
  const stdin = process.stdin;
  rl.pause();
  readline.emitKeypressEvents(stdin);
  const wasRaw = !!stdin.isRaw;
  if (stdin.setRawMode) stdin.setRawMode(true);

  const render = () => {
    if (printed) process.stdout.write(`\x1b[${printed}A\x1b[0J`);
    const out = [`  ${C.b}${C.gold}Settings${C.reset}  ${C.dim}↑↓ move · enter ${editing ? 'save' : 'toggle/edit'} · esc ${editing ? 'cancel' : 'done'}${C.reset}`];
    rows.forEach((r, i) => {
      const mark = i === idx ? `${C.gold}►${C.reset}` : ' ';
      if (editing && i === idx && r.type === 'str') {
        out.push(`  ${mark} ${C.gray}◦${C.reset} ${C.b}${r.k.padEnd(11)}${C.reset} ${C.gold}${editing.buf}${C.reset}${C.dim}▏${C.reset}`);
      } else if (r.type === 'bool') {
        const on = cfg[r.k];
        out.push(`  ${mark} ${on ? `${C.green}●${C.reset}` : `${C.gray}○${C.reset}`} ${C.b}${r.k.padEnd(11)}${C.reset} ${C.dim}${(on ? 'on' : 'off').padEnd(4)} ${SETTING_HELP[r.k]}${C.reset}`);
      } else {
        out.push(`  ${mark} ${C.gray}◦${C.reset} ${C.b}${r.k.padEnd(11)}${C.reset} ${C.dim}${cfg[r.k] || '(none)'}  ${SETTING_HELP[r.k]}${C.reset}`);
      }
    });
    process.stdout.write(out.join('\n') + '\n');
    printed = out.length;
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      stdin.removeListener('keypress', onKey);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw);
      process.stdout.write('\n');
      rl.resume();
      resolve();
    };
    const onKey = (str, key) => {
      key = key || {};
      if (editing) {
        if (key.name === 'return') { cfg = saveSettings({ [rows[idx].k]: editing.buf.trim() }); editing = null; render(); }
        else if (key.name === 'escape') { editing = null; render(); }
        else if (key.name === 'backspace') { editing.buf = editing.buf.slice(0, -1); render(); }
        else if (str && str.length === 1 && !key.ctrl && str >= ' ') { editing.buf += str; render(); }
        return;
      }
      if (key.ctrl && key.name === 'c') return cleanup();
      switch (key.name) {
        case 'up': idx = (idx - 1 + rows.length) % rows.length; render(); break;
        case 'down': case 'tab': idx = (idx + 1) % rows.length; render(); break;
        case 'escape': case 'q': cleanup(); break;
        case 'return': case 'space': {
          const r = rows[idx];
          if (r.type === 'bool') { const v = !cfg[r.k]; cfg = saveSettings({ [r.k]: v }); if (r.k === 'metrics') showMetrics = v; render(); }
          else { editing = { buf: cfg[r.k] || '' }; render(); }
          break;
        }
      }
    };
    stdin.on('keypress', onKey);
    render();
  });
}

const COMMANDS = [
  ['/settings', 'view & toggle settings (arrow keys, enter, esc)'],
  ['/name', 'change what your Keepers call you'],
  ['/metrics', 'toggle the per-turn token + timing line'],
  ['/status', 'show each Keeper and whether it is warm'],
  ['/reset', 'wipe all state for a clean first-run (testing)'],
  ['/help', 'this list'],
  ['/exit', 'quit'],
];
function printHelp() {
  console.log(`  ${C.b}${C.gold}Commands${C.reset}`);
  for (const [c, d] of COMMANDS) console.log(`    ${C.gold}${c.padEnd(10)}${C.reset} ${C.dim}${d}${C.reset}`);
  console.log(`  ${C.dim}anything else is a question — Pharos routes it to the right Keeper.${C.reset}\n`);
}

function printStatus() {
  const reg = loadRegistry(registryPath);
  const cur = reg.current;
  console.log(`  ${C.b}Keepers${C.reset}`);
  for (const k of KEEPERS.filter((k) => k.active)) {
    const warm = !!(reg.sessions && reg.sessions[k.id]);
    const dot = warm ? `${C.green}●${C.reset}` : `${C.gray}○${C.reset}`;
    const here = cur === k.id ? `  ${C.gold}← here${C.reset}` : '';
    console.log(`    ${dot} ${C.b}${k.id.padEnd(8)}${C.reset} ${C.dim}${k.alias.padEnd(10)}${warm ? 'warm' : 'cold'}${C.reset}${here}`);
  }
  console.log(`  ${C.dim}metrics ${showMetrics ? 'on' : 'off'}${cfg.mcpConfig ? ` · mcp ${cfg.mcpConfig}` : ''}${cfg.sharedTools ? ` · shared tools ${cfg.sharedTools}` : ''}${C.reset}`);
  console.log('');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: PROMPT });

// Input prompt: a top rule + `◆ › `. (A persistent bottom border WHILE typing isn't
// possible in plain readline — readline owns the input line and fights any manual
// paint below it, producing a staircase. A true fixed box needs a raw-mode TUI.)
const reprompt = () => rl.prompt();
reprompt();

// Serialize turns and track the in-flight one so a stdin close (EOF / piped input)
// waits for it instead of dropping it. Pause input while a turn runs.
let pending = Promise.resolve();
let closed = false;
rl.on('line', (line) => {
  const p = line.trim();
  if (!p) return reprompt();
  if (TTY) console.log(`  ${C.bronze}${rule()}${C.reset}`); // the divider hugs the line you just typed
  if (p === '/exit' || p === '/quit') return rl.close();
  if (p === '/reset') {
    doReset();
    return reprompt();
  }
  if (p === '/metrics') {
    showMetrics = !showMetrics;
    console.log(`  ${C.dim}metrics ${showMetrics ? `${C.green}on` : 'off'}${C.reset}\n`);
    return reprompt();
  }
  if (p === '/status') {
    printStatus();
    return reprompt();
  }
  if (p === '/help' || p === '/hlp' || p === '/?' || p === '/h') {
    printHelp();
    return reprompt();
  }
  if (p === '/settings' || p.startsWith('/settings ')) {
    const args = p.split(/\s+/).slice(1);
    if (args.length) { changeSettings(args); return reprompt(); } // text form (scripting / non-TTY)
    settingsMenu().then(reprompt); // interactive arrow-key menu
    return;
  }
  if (p === '/name' || p.startsWith('/name ')) {
    const apply = (nm) => {
      if (nm) {
        const saved = saveProfile({ name: nm });
        profile.name = saved.name;
        console.log(`  ${C.green}✓${C.reset} name set to ${C.b}${saved.name}${C.reset} ${C.dim}(applies to new Keeper sessions; restart to refresh personas)${C.reset}\n`);
      } else {
        console.log(`  ${C.dim}name unchanged${C.reset}\n`);
      }
      reprompt();
    };
    const arg = p.slice(5).trim();
    if (arg) return apply(arg);
    return rl.question(`  new name: `, (a) => apply(a.trim()));
  }

  rl.pause();
  pending = (async () => {
    const t0 = Date.now();
    const spin = thinking('routing');
    const r = await handle(p, { mock, registryPath });
    spin.stop();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const arrow = r.switched ? `${C.gold}↪${C.reset}` : `${C.gray}·${C.reset}`;
    const recall = r.recalled?.length ? ` ${C.dim}· recalled ${r.recalled.length}${C.reset}` : '';
    const flush = r.redone ? (r.degraded ? ` ${C.red}· ⚠ degraded${C.reset}` : ` ${C.green}· reseeded${C.reset}`) : '';
    const early = r.compacting ? ` ${C.deep}· ⟳ pre-compacted${C.reset}` : '';
    console.log(`  ${arrow} ${C.b}${r.routed}${C.reset} ${C.dim}(${r.alias})${C.reset} ${C.gray}${r.note}${r.fresh ? ' · new' : ''}${C.reset}${recall}${flush}${early}`);
    if (showMetrics) printMetrics(r);
    console.log('');
    // Indent the answer body under a soft left gutter for readability.
    console.log(r.text.split('\n').map((l) => `  ${l}`).join('\n'));
    // The footer Josh likes: how long it took + how loaded the thread is now.
    const ctx = r.contextTokens || 0;
    const tok = ctx >= 1000 ? `${(ctx / 1000).toFixed(1)}k` : `${ctx}`;
    console.log(`  ${C.gray}⧖ ${secs}s${ctx ? ` ${C.dim}·${C.gray} ◈ ${tok} tokens` : ''}${C.reset}`);
    console.log('');
    if (closed) return; // EOF arrived mid-turn — don't touch a closed interface
    rl.resume();
    reprompt();
  })();
});

rl.on('close', async () => {
  closed = true;
  await pending; // don't drop a turn that's still flushing/logging
  console.log(`  ${C.dim}— Alexandria out.${C.reset}`);
  process.exit(0);
});
