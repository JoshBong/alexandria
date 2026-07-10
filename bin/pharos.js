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
import { spawnSync } from 'node:child_process';
import { getSettings, saveSettings } from '../src/pharos/settings.js';
import { hasProfile, saveProfile, getProfile } from '../src/pharos/profile.js';
import { layout, visLen, wrapInput, wrapAnsi } from '../src/pharos/boxui.js';
import { initInput, reduceKey, parseCsiU } from '../src/pharos/input.js';
import { collapseCode, mdRender } from '../src/pharos/render.js';
import { initMenu, menuKey, MODEL_CHOICES, SHARED_TOOL_CHOICES, SETTINGS_SCHEMA } from '../src/pharos/menu.js';

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
  white: TTY ? '\x1b[97m' : '', // bright white — the active Keeper in the roster
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

const PREFIX = `  ${C.gold}⟡${C.reset} ${C.deep}›${C.reset} `; // visible input marker

// The "thinking" verbs — our own gerund list, Alexandria/Egypt-flavoured, shown in gold
// while a Keeper works (Claude-Code style). One is picked at random per turn and rotates
// every few seconds so a long turn doesn't feel stuck.
const VERBS = [
  'Routing', 'Divining', 'Summoning', 'Consulting', 'Pondering', 'Scribing',
  'Deciphering', 'Illuminating', 'Kindling', 'Navigating', 'Conjuring', 'Inscribing',
  'Surveying', 'Pathfinding', 'Decoding', 'Reasoning', 'Unfurling', 'Charting',
  'Translating', 'Calibrating',
];
const verbAt = (elapsedMs, seed) => VERBS[(seed + Math.floor(elapsedMs / 7000)) % VERBS.length];

// An animated "thinking" line (braille spinner + elapsed seconds), cleared in place
// when the answer arrives. No-op on a non-TTY (keeps piped output clean).
function thinking(label = 'thinking') {
  if (!TTY) return { stop() {}, set() {} };
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const t0 = Date.now();
  const seed = Math.floor(Math.random() * VERBS.length);
  let lbl = label;
  let i = 0;
  const timer = setInterval(() => {
    const el = Date.now() - t0;
    process.stdout.write(`\r  ${C.gray}${frames[i = (i + 1) % frames.length]}${C.reset} ${C.b}${C.gold}${verbAt(el, seed)}…${C.reset} ${C.dim}(${Math.floor(el / 1000)}s · ${lbl})${C.reset}\x1b[K`);
  }, 80);
  return { stop() { clearInterval(timer); process.stdout.write('\r\x1b[K'); }, set(l) { lbl = l; } };
}

const ask = (rl, q) => new Promise((res) => rl.question(q, res));

// Prereq: Alexandria's Keepers ARE `claude` boats — the CLI must be installed and
// signed in. Check once at startup (live only) and guide the user if it's missing,
// instead of failing cryptically on the first turn. Mock mode needs no claude.
if (!mock) {
  let ok = false;
  try { ok = spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0; } catch { ok = false; }
  if (!ok) {
    console.log(`\n  ${C.red}✗ Claude Code CLI not found on PATH.${C.reset} Alexandria runs its Keepers on it.`);
    console.log(`  ${C.dim}Install it (${C.reset}${C.gold}https://claude.com/claude-code${C.dim}), sign in, then re-run.${C.reset}`);
    console.log(`  ${C.dim}Or explore offline with ${C.reset}${C.gold}alexandria --mock${C.reset}${C.dim}.${C.reset}\n`);
    process.exit(1);
  }
}

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

// The pinned-box controller while the TTY chat loop runs (else null). When active, all
// console.log is redirected through its scroll-region writer (see startBox), so every
// existing print lands ABOVE the box without threading a writer through each call site.
let boxCtl = null;

// Import the rest AFTER onboarding so KEEPERS build with the saved name.
const { handle } = await import('../src/pharos.js');
const { prewarmAll } = await import('../src/pharos/prewarm.js');
const { loadRegistry, saveRegistry, migrateRegistry } = await import('../src/pharos/registry.js');
const { KEEPERS, applyProfile } = await import('../src/pharos/keepers.js');
const { loadOverrides, saveOverride } = await import('../src/pharos/overrides.js');
const { tokenLimit, contextWindow } = await import('../src/pharos/tokens.js');
const { askOnce } = await import('../src/pharos/ask.js');
const { research, MODES } = await import('../src/research/fanout.js');
const { update: selfUpdate, localVersion } = await import('../src/update.js');

// Pharos's routing call runs on the cheapest model — it's a one-word domain
// decision, no reason to spend a big model on it. Live only; mock stays offline.
const ROUTER_MODEL = 'haiku';
// Routing runs on the cheap model by default; callers (reframe/revoice in pharos.js) can
// override the model per call so those passes run on the answering Keeper's own model.
const router = mock ? undefined : (q, o = {}) => askOnce(q, { model: ROUTER_MODEL, ...o });

// Heal stale warm sessions: if the boat config changed since these sessions were
// created (new persona/cwd/tools), flush them so prewarm re-creates them cleanly
// instead of skipping the ones it finds "already warm."
{
  const reg = loadRegistry(registryPath);
  if (migrateRegistry(reg)) saveRegistry(reg, registryPath);
}

const roster = KEEPERS.filter((k) => k.active).map((k) => `${C.b}${k.id[0].toUpperCase() + k.id.slice(1)}${C.reset}${C.dim}(${k.alias})${C.reset}`).join('  ');

// Open clean: wipe everything above (the `npm run` preamble, a previous run) and clear
// scrollback so Alexandria starts at the top of an empty screen. TTY only.
if (TTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

console.log('');
console.log(`  ${C.b}${C.gold}Alexandria${C.reset}  ${C.dim}Pharos routes · Keepers hold · Alexandria remembers${C.reset}`);
console.log(`  ${C.dim}${mock ? 'mock mode (no API)' : 'live mode'} ${C.reset}${roster}`);
console.log(`  ${C.gray}logged in as ${C.reset}${C.sand}${profile.name}${C.reset}   ${C.gray}·   /help for commands  ·  quit to exit${C.reset}`);
console.log('');

// Warm every Keeper up front (parallel) so the first switch to a domain resumes a
// hot, prompt-cached thread instead of cold-spawning one. Off in mock / --no-prewarm
// / when the setting is disabled. Best-effort.
//
// The boot animation: light the Pharos. Each Keeper is a lamp that flickers (braille
// spinner) until it lights to a steady ⟡. The reveal is STAGGERED so the row lights up
// left-to-right EVERY login — even when all Keepers are already warm (a lamp lights on
// its slot once it's ready; warm ones are ready immediately, cold ones light when
// prewarm confirms them, which also masks the spin-up). A warmup that fails shows ⚠.
if (!mock && !noPrewarm && cfg.prewarm) {
  const active = KEEPERS.filter((k) => k.active);
  const reg0 = loadRegistry();
  const flames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const label = (k) => k.id[0].toUpperCase() + k.id.slice(1);
  const lit = Object.fromEntries(active.map((k) => [k.id, false])); // always animate from dark
  const ready = Object.fromEntries(active.map((k) => [k.id, !!(reg0.sessions && reg0.sessions[k.id])])); // warm = ready now
  const failed = new Set();

  if (TTY) {
    let frame = 0;
    let slot = 0; // how many lamp-slots have opened (advances slower than the flicker)
    let warmDone = false;
    const render = () => {
      const cells = active.map((k) => {
        if (lit[k.id]) return `${C.deep}⟡${C.reset} ${C.b}${label(k)}${C.reset}`;
        if (warmDone && failed.has(k.id)) return `${C.red}⚠${C.reset} ${C.dim}${label(k)}${C.reset}`;
        return `${C.gray}${flames[frame % flames.length]}${C.reset} ${C.dim}${label(k)}${C.reset}`;
      }).join('   ');
      process.stdout.write(`\r  ${C.dim}lighting the Pharos${C.reset}  ${cells}\x1b[K`);
    };
    process.stdout.write(`\n  ${C.gold}${C.b}✦ Alexandria${C.reset}\n\n`);
    const warming = prewarmAll({ settings: cfg, onResult: (k, ok) => { ready[k.id] = ok; if (!ok) failed.add(k.id); } })
      .then(() => { warmDone = true; });
    await new Promise((res) => {
      const t = setInterval(() => {
        frame += 1;
        if (frame % 2 === 0) slot += 1; // ~180ms per lamp slot
        active.forEach((k, i) => { if (!lit[k.id] && slot >= i + 1 && ready[k.id]) lit[k.id] = true; });
        render();
        const settled = active.every((k) => lit[k.id] || failed.has(k.id));
        if (settled && warmDone && slot >= active.length) { clearInterval(t); res(); }
      }, 90);
    });
    await warming;
    render();
    process.stdout.write('\n\n');
  } else {
    process.stdout.write('  warming Keepers…');
    const { results } = await prewarmAll({ settings: cfg });
    const ok = results.filter((r) => r.ok).length;
    console.log(` ${ok} warm\n`);
  }
}

// The full accounting line (shown when /metrics is on). The header already shows the
// per-turn cost; this adds the breakdown — new input ↑, answer ↓, the cheap replayed
// context (cache-read), and the TOTAL resident load against the window. A cache MISS
// (the context re-written from scratch after the ~5-min cache TTL) is flagged, since
// that's what makes the resident number briefly spike.
function printMetrics(r) {
  const lim = tokenLimit(); // EARLY compaction trigger
  const win = cfg.contextWindow || contextWindow(); // the real window (the denominator)
  const ctx = r.contextTokens || 0;
  const pct = win ? Math.round((ctx / win) * 100) : 0;
  const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : `${n}`);
  // Heat keyed to the FLUSH trigger, not the window: amber as we approach it, red past it.
  const heat = ctx >= lim ? C.red : ctx >= lim * 0.66 ? C.deep : C.green;
  const u = r.usage || {};
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheMiss = !r.fresh && cacheRead === 0 && (u.cache_creation_input_tokens || 0) > 0;
  const flags = [
    cacheMiss && `${C.deep}↻ cache miss (re-cached)${C.reset}`,
    r.compacting && `${C.deep}⟳ compacting${C.reset}`,
    r.degraded && `${C.red}⚠ degraded${C.reset}`,
    r.redone && !r.degraded && `${C.green}reseeded${C.reset}`,
    r.recalled?.length && `${C.dim}recalled ${r.recalled.length}${C.reset}`,
  ].filter(Boolean).join(`${C.dim} · ${C.reset}`);
  console.log(
    `  ${C.gray}⊙${C.reset} ${C.dim}turn${C.reset} ↑${u.input_tokens ?? 0} ↓${u.output_tokens ?? 0}` +
    `${C.dim} · cached ${cacheRead.toLocaleString()} · ctx${C.reset} ${heat}${fmtK(ctx)}${C.reset}${C.dim}/${fmtK(win)} (${pct}%) · compact @${fmtK(lim)} · ${r.fresh ? 'fresh' : 'warm'}${C.reset}` +
    `${flags ? `${C.dim} · ${C.reset}${flags}` : ''}`,
  );
}

// /settings — view and toggle. `/settings` lists; `/settings <key>` flips a bool;
// `/settings <key> <value>` sets a string (sharedTools/mcpConfig). Writes through to
// .pharos/settings.json so the next turn's getSettings() picks it up.
const BOOL_KEYS = ['advisor', 'reframe', 'revoice', 'skipPerms', 'prewarm', 'metrics', 'kittyKeys', 'mouseScroll'];
const STR_KEYS = ['model', 'sharedTools', 'mcpConfig'];
const NUM_KEYS = ['contextWindow'];
const SETTING_HELP = {
  advisor: 'advisor-enabled Keepers escalate hard forks to a warm opus advisor',
  reframe: 'the Keeper rewrites your prompt into a clean question first',
  revoice: 'the Keeper re-voices its own answer into one consistent voice',
  skipPerms: 'boats run headless (skip permission prompts)',
  prewarm: 'warm all Keepers on startup',
  metrics: 'show the per-turn metrics line',
  kittyKeys: 'enable Shift+Enter (kitty keyboard protocol; ghostty/kitty/WezTerm)',
  mouseScroll: 'mouse wheel scrolls the transcript (while on, hold Shift to select text)',
  model: 'which model the Keepers run on (e.g. sonnet, opus, haiku)',
  sharedTools: 'extra built-in tools every Keeper can load on demand',
  mcpConfig: 'shared MCP connector config (browser/Gmail/…) for every Keeper',
  contextWindow: 'model context window shown as the ctx max (e.g. 200000, 1000000)',
};
function printSettings() {
  console.log(`  ${C.b}${C.gold}Settings${C.reset}`);
  for (const k of BOOL_KEYS) {
    const on = cfg[k];
    console.log(`    ${on ? `${C.green}●${C.reset}` : `${C.gray}○${C.reset}`} ${C.b}${k.padEnd(13)}${C.reset} ${C.dim}${(on ? 'on' : 'off').padEnd(4)} ${SETTING_HELP[k]}${C.reset}`);
  }
  for (const k of STR_KEYS) {
    console.log(`    ${C.gray}◦${C.reset} ${C.b}${k.padEnd(13)}${C.reset} ${C.dim}${(cfg[k] || '(none)')}  ${SETTING_HELP[k]}${C.reset}`);
  }
  for (const k of NUM_KEYS) {
    console.log(`    ${C.gray}#${C.reset} ${C.b}${k.padEnd(13)}${C.reset} ${C.dim}${cfg[k]}  ${SETTING_HELP[k]}${C.reset}`);
  }
  console.log(`  ${C.gray}/settings <key> to toggle · /settings <key> <value> to set${C.reset}\n`);
}
// Settings baked into a warm session at spawn time. Changing one mid-run has NO effect
// until the Keepers re-warm — so flush their sessions when one of these changes (same as
// /name does for the persona), otherwise the setting silently "doesn't work".
// advisor is spawn-baked too: the ADVISE escalation rule is appended to an enabled
// Keeper's system prompt at session creation, so toggling it must re-warm (otherwise
// off still escalates / on never does, per whatever the old session was born with).
const SPAWN_KEYS = ['model', 'sharedTools', 'mcpConfig', 'skipPerms', 'advisor'];
function flushWarmSessions() {
  const reg = loadRegistry(registryPath);
  reg.sessions = {};
  saveRegistry(reg, registryPath);
}
function changeSettings(args) {
  const [key, ...rest] = args;
  if (!key) return printSettings();
  if (BOOL_KEYS.includes(key)) {
    const val = rest.length ? /^(1|true|on|yes)$/i.test(rest[0]) : !cfg[key];
    cfg = saveSettings({ [key]: val });
    if (key === 'metrics') showMetrics = val;
    if (key === 'mouseScroll' && boxCtl?.setMouse) boxCtl.setMouse(val); // applies live, no restart
    if (SPAWN_KEYS.includes(key)) flushWarmSessions();
    console.log(`  ${C.green}✓${C.reset} ${key} ${val ? `${C.green}on` : 'off'}${C.reset}${SPAWN_KEYS.includes(key) ? `${C.dim} — Keepers will re-warm${C.reset}` : ''}\n`);
  } else if (STR_KEYS.includes(key)) {
    const val = rest.join(' ');
    cfg = saveSettings({ [key]: val });
    if (SPAWN_KEYS.includes(key)) flushWarmSessions();
    console.log(`  ${C.green}✓${C.reset} ${key} = ${C.gold}${val || '(none)'}${C.reset}${SPAWN_KEYS.includes(key) ? `${C.dim} — Keepers will re-warm${C.reset}` : ''}\n`);
  } else if (NUM_KEYS.includes(key)) {
    const n = Number(String(rest[0]).replace(/[_,k]/gi, (m) => (m.toLowerCase() === 'k' ? '000' : '')));
    if (!Number.isFinite(n) || n <= 0) {
      console.log(`  ${C.red}${key} needs a positive number${C.reset} ${C.dim}(e.g. /settings ${key} 200000)${C.reset}\n`);
    } else {
      cfg = saveSettings({ [key]: n });
      console.log(`  ${C.green}✓${C.reset} ${key} = ${C.gold}${n.toLocaleString()}${C.reset}\n`);
    }
  } else {
    console.log(`  ${C.red}unknown setting${C.reset} ${C.dim}'${key}' — try one of: ${[...BOOL_KEYS, ...STR_KEYS, ...NUM_KEYS].join(', ')}${C.reset}\n`);
  }
}

// ---- interactive /settings menu (TTY box only) ----
// The reducer (menu.js) owns navigation; these own the DATA and COPY. buildMenuView
// snapshots current state into the rows the reducer reads; applyMenuIntent is the only
// writer (mirrors changeSettings, no console noise — the menu shows state live);
// menuLines renders the content rows the box frames. The keyboard capture lives in
// startBox. Mirrors how boxui.js (math) and bin (draw) split the input box.
const padTo = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
const modelLabel = (m) => (m || '(default)');
const toolList = () => (cfg.sharedTools || '').split(',').map((s) => s.trim()).filter(Boolean);
// What each shared tool is — the powerful (file/shell) ones flagged so sharing them to
// EVERY Keeper is a conscious choice.
const TOOL_HELP = {
  WebSearch: 'search the web', WebFetch: 'fetch & read a URL', Read: 'read a file you reference',
  Grep: 'search file contents', Glob: 'find files by pattern', TodoWrite: 'keep a task list',
  Bash: 'run shell commands ⚠ powerful', Write: 'create files ⚠ powerful', Edit: 'modify files ⚠ powerful',
};

function buildMenuView() {
  const main = SETTINGS_SCHEMA.map(({ key, kind, screen }) => ({
    key,
    kind,
    screen,
    label: key,
    display:
      key === 'model' ? 'per-Keeper ›'
      : key === 'sharedTools' ? `${toolList().length} on ›`
      : kind === 'bool' ? (cfg[key] ? 'on' : 'off')
      : kind === 'num' ? Number(cfg[key]).toLocaleString()
      : (cfg[key] || '(none)'),
  }));
  const ov = loadOverrides();
  const model = [
    { id: '*', label: 'all Keepers', model: cfg.model || '', effective: cfg.model || '(CLI default)' },
    ...KEEPERS.filter((k) => k.active).map((k) => {
      const m = (ov[k.id] || {}).model || '';
      return { id: k.id, label: k.alias, model: m, effective: m || `default (${cfg.model || 'CLI'})` };
    }),
  ];
  const on = new Set(toolList());
  const tools = SHARED_TOOL_CHOICES.map((name) => ({ name, on: on.has(name) }));
  return { main, model, tools };
}

function applyMenuIntent(it) {
  if (it.type === 'toggle') {
    cfg = saveSettings({ [it.key]: !cfg[it.key] });
    if (it.key === 'metrics') showMetrics = cfg.metrics;
    if (it.key === 'mouseScroll' && boxCtl?.setMouse) boxCtl.setMouse(cfg.mouseScroll); // live
    if (SPAWN_KEYS.includes(it.key)) flushWarmSessions();
  } else if (it.type === 'set') {
    if (it.kind === 'num') {
      const n = Number(String(it.value).replace(/[_,k]/gi, (m) => (m.toLowerCase() === 'k' ? '000' : '')));
      if (Number.isFinite(n) && n > 0) cfg = saveSettings({ [it.key]: n }); // ignore junk → keep old value
    } else {
      cfg = saveSettings({ [it.key]: it.value });
      if (SPAWN_KEYS.includes(it.key)) flushWarmSessions();
    }
  } else if (it.type === 'setModel') {
    if (it.id === '*') cfg = saveSettings({ model: it.value }); // the global default
    else { saveOverride(it.id, { model: it.value }); applyProfile(); } // per-Keeper, re-applied live
    flushWarmSessions(); // model is baked at spawn → re-warm so it takes effect
  } else if (it.type === 'toggleTool') {
    const set = new Set(toolList());
    if (set.has(it.name)) set.delete(it.name); else set.add(it.name);
    cfg = saveSettings({ sharedTools: [...set].join(',') });
    flushWarmSessions(); // sharedTools is baked at spawn → re-warm
  }
}

function menuLines(state, view) {
  const lines = [];
  if (state.screen === 'model') {
    lines.push(`  ${C.b}${C.gold}⚙ Settings ${C.dim}›${C.reset}${C.b}${C.gold} model${C.reset}   ${C.dim}↑↓ keeper · ←→ model · enter/esc back${C.reset}`);
    view.model.forEach((row, i) => {
      const sel = i === state.cursor;
      const mark = sel ? `${C.gold}▸${C.reset}` : ' ';
      const label = sel ? `${C.b}${C.gold}${padTo(row.label, 12)}${C.reset}` : `${C.dim}${padTo(row.label, 12)}${C.reset}`;
      const m = modelLabel(row.model);
      const val = sel ? `${C.gold}‹ ${m} ›${C.reset}` : `${C.sand}${m}${C.reset}`;
      const eff = row.id !== '*' && !row.model ? ` ${C.dim}→ ${row.effective}${C.reset}` : '';
      lines.push(`  ${mark} ${label} ${val}${eff}`);
    });
    return lines;
  }
  if (state.screen === 'tools') {
    lines.push(`  ${C.b}${C.gold}⚙ Settings ${C.dim}›${C.reset}${C.b}${C.gold} shared tools${C.reset}   ${C.dim}↑↓ move · enter toggle · esc back${C.reset}`);
    view.tools.forEach((row, i) => {
      const sel = i === state.cursor;
      const mark = sel ? `${C.gold}▸${C.reset}` : ' ';
      const box = row.on ? `${C.green}●${C.reset}` : `${C.gray}○${C.reset}`;
      const name = sel ? `${C.b}${C.gold}${padTo(row.name, 11)}${C.reset}` : `${padTo(row.name, 11)}`;
      lines.push(`  ${mark} ${box} ${name} ${C.dim}${TOOL_HELP[row.name] || ''}${C.reset}`);
    });
    return lines;
  }
  // main
  lines.push(`  ${C.b}${C.gold}⚙ Settings${C.reset}   ${C.dim}↑↓ move · enter select · esc close${C.reset}`);
  view.main.forEach((row, i) => {
    const sel = i === state.cursor;
    const mark = sel ? `${C.gold}▸${C.reset}` : ' ';
    const label = sel ? `${C.b}${C.gold}${padTo(row.label, 14)}${C.reset}` : `${C.dim}${padTo(row.label, 14)}${C.reset}`;
    let val;
    if (sel && state.edit) {
      const was = row.kind === 'num' ? Number(cfg[row.key]).toLocaleString() : (cfg[row.key] || 'none');
      val = `${C.gold}${state.edit.buf}▏${C.reset} ${C.dim}(was ${was} · enter save · esc cancel)${C.reset}`;
    } else if (row.kind === 'bool') {
      val = cfg[row.key] ? `${C.green}● on${C.reset}` : `${C.gray}○ off${C.reset}`;
    } else {
      val = `${C.sand}${row.display}${C.reset}`;
    }
    lines.push(`  ${mark} ${label} ${val}`);
  });
  const help = SETTING_HELP[view.main[state.cursor].key] || '';
  lines.push(`  ${C.dim}${help}${C.reset}`);
  return lines;
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

const COMMANDS = [
  ['/research', 'fan-out research (--idea for a startup verdict, --broad default)'],
  ['/update', 'update Alexandria from GitHub (then /restart to load it)'],
  ['/restart', 'relaunch Alexandria in place — loads a freshly updated version'],
  ['/settings', 'view & toggle settings'],
  ['/name', 'change what your Keepers call you'],
  ['/metrics', 'toggle the per-turn token + timing line'],
  ['/status', 'show each Keeper and whether it is warm'],
  ['/reset', 'wipe all state for a clean first-run (testing)'],
  ['/help', 'this list'],
  ['/quit', 'quit Alexandria — also /exit, or just typing "quit" / "q"'],
];
function printHelp() {
  console.log(`  ${C.b}${C.gold}Commands${C.reset}`);
  for (const [c, d] of COMMANDS) console.log(`    ${C.gold}${c.padEnd(10)}${C.reset} ${C.dim}${d}${C.reset}`);
  console.log(`  ${C.dim}keys: mouse wheel / Shift+↑/↓ / PgUp/PgDn scroll the transcript · Shift+Enter = newline${C.reset}`);
  console.log(`  ${C.dim}wheel scrolling owns the mouse — hold Shift to select text (/settings mouseScroll to disable)${C.reset}`);
  console.log(`  ${C.dim}anything else is a question — Pharos routes it to the right Keeper.${C.reset}\n`);
}

// Render a markdown string to the terminal the SAME way a Keeper answer is rendered
// (ANSI inline md + collapsed code + left gutter); plain/verbatim off-TTY. Reused by the
// answer path and /research so their output looks identical.
function renderMarkdown(text) {
  const body = TTY
    ? collapseCode(mdRender(text, {
      bold: (s) => `${C.b}${s}${C.reset}`,
      italic: (s) => `\x1b[3m${s}\x1b[23m`,
      code: (s) => `${C.bronze}${s}${C.reset}`,
      link: (t, u) => `${C.b}${t}${C.reset} ${C.dim}${u}${C.reset}`,
      bullet: (s) => `${C.gold}${s}${C.reset}`,
      heading: (s) => `${C.b}${C.gold}${s}${C.reset}`,
    }), { style: { summary: (s) => `${C.dim}${C.bronze}${s}${C.reset}` } })
    : text;
  console.log(body.split('\n').map((l) => `  ${l}`).join('\n'));
}

// /research <question> [--idea|--broad] [--angles N] — the fan-out research pipeline.
// Decompose → N parallel web-research workers → synthesis. Mode picks the lenses +
// verdict style: --broad (default) = cited report, --idea = BUILD/PASS council verdict.
async function doResearch(rest) {
  const toks = (rest || '').split(/\s+/).filter(Boolean);
  let mode = 'broad';
  let angles;
  const qWords = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '--idea' || t === '--startup') mode = 'idea';
    else if (t === '--broad') mode = 'broad';
    else if (t === '--mode') mode = toks[++i] || mode;
    else if (t === '--angles') angles = Number(toks[++i]) || undefined;
    else qWords.push(t);
  }
  const question = qWords.join(' ').trim();
  if (!question) {
    console.log(`  ${C.dim}usage: ${C.gold}/research <question>${C.reset}${C.dim} [${C.reset}--idea${C.dim}|${C.reset}--broad${C.dim}] [${C.reset}--angles N${C.dim}]${C.reset}\n`);
    return;
  }
  if (mock) { console.log(`  ${C.dim}/research needs live Keepers (not available in --mock)${C.reset}\n`); return; }

  const label = (MODES[mode] || MODES.broad).label;
  const t0 = Date.now();
  const spin = boxCtl ? boxCtl.spinner(`researching · ${label}`) : thinking(`researching · ${label}`);
  // Walk the spinner label through the stages so a multi-minute run shows where it is.
  const onStage = (s) => {
    if (s.stage === 'fanout') spin.set(`researching · ${label} · ${s.count} workers`);
    else if (s.stage === 'synthesize') spin.set(`researching · ${label} · synthesizing`);
  };
  let out;
  try {
    out = await research(question, { mode, angles, onStage });
  } catch (e) {
    spin.stop();
    console.log(`  ${C.red}✗ research failed:${C.reset} ${C.dim}${e.message}${C.reset}\n`);
    return;
  }
  spin.stop();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = out.findings.filter((f) => !f.error).length;
  console.log(`  ${C.gold}◆${C.reset} ${C.b}research${C.reset} ${C.dim}(${label})${C.reset} ${C.gray}${ok}/${out.findings.length} angles${C.reset}  ${C.gray}⧖ ${secs}s${C.reset}`);
  console.log('');
  renderMarkdown(out.report);
  console.log('');
}

// /update [--force] — self-update from GitHub in place. The running process keeps its
// loaded code; the new version applies on the next `alexandria` launch.
async function doUpdate(force) {
  const spin = boxCtl ? boxCtl.spinner('updating') : thinking('updating');
  const r = await selfUpdate({ force });
  spin.stop();
  if (r.status === 'current') console.log(`  ${C.green}✓${C.reset} ${C.dim}already up to date (${r.version})${C.reset}\n`);
  else if (r.status === 'updated') console.log(`  ${C.green}✓${C.reset} updated ${C.dim}${r.from}${C.reset} → ${C.b}${r.to}${C.reset} ${C.dim}— ${C.gold}/restart${C.reset}${C.dim} to load it${C.reset}\n`);
  else console.log(`  ${C.red}✗ update failed:${C.reset} ${C.dim}${r.reason}${force ? '' : ' — /update --force to reinstall anyway'}${C.reset}\n`);
}

function printStatus() {
  const reg = loadRegistry(registryPath);
  const cur = reg.current;
  console.log(`  ${C.b}Keepers${C.reset}`);
  for (const k of KEEPERS.filter((k) => k.active)) {
    const warm = !!(reg.sessions && reg.sessions[k.id]);
    const dot = warm ? `${C.green}●${C.reset}` : `${C.gray}○${C.reset}`;
    const here = cur === k.id ? `  ${C.gold}← here${C.reset}` : '';
    console.log(`    ${dot} ${C.b}${k.id.padEnd(8)}${C.reset} ${C.dim}${k.alias.padEnd(13)}${warm ? 'warm' : 'cold'}${C.reset}${here}`);
  }
  console.log(`  ${C.dim}metrics ${showMetrics ? 'on' : 'off'}${cfg.mcpConfig ? ` · mcp ${cfg.mcpConfig}` : ''}${cfg.sharedTools ? ` · shared tools ${cfg.sharedTools}` : ''}${C.reset}`);
  console.log('');
}

// ---- the input ----
// TTY: a pinned input box at the bottom. A terminal scroll region (DECSTBM) reserves
// the bottom 3 rows for the box; answers scroll in the region ABOVE it, the box stays
// put. Output uses the bottom-anchored scroll idiom (write at the last region row, LF
// to scroll, reprint) — nothing depends on a saved absolute cursor, so it never
// staircases the way the old ESC-7/8 box did. The cursor math is in src/pharos/boxui.js
// (unit-tested). Non-TTY (pipes / tests) keeps plain readline below.
const PROMPT = TTY ? `  ${C.gold}⟡${C.reset} ${C.deep}›${C.reset} ` : 'alexandria› ';
let rlNonTty = null; // the non-TTY readline (created only on the non-TTY path)

// A one-off sub-prompt (e.g. /name). The pinned box has a single always-live input (no
// nested prompts), so there it returns null and the caller falls back to inline usage
// (`/name <name>`); the non-TTY path uses readline's question().
function subAsk(promptStr) {
  if (boxCtl) return Promise.resolve(null);
  return ask(rlNonTty, promptStr);
}

// /restart sets this, then quits the loop like /exit — the exit sites re-exec instead
// of exiting. A Node process can't hot-reload its own ESM graph, so "restart" = restore
// the terminal, spawn a fresh instance of this same bin (which reads the freshly
// UPDATED files after /update), and mirror its exit code when it eventually quits.
let restartAfterExit = false;
function respawnIfRequested() {
  if (!restartAfterExit) return;
  console.log(`  ${C.dim}— restarting…${C.reset}`);
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}

// Handle one submitted line. Returns false to quit the loop, true to keep going.
async function handleLine(line) {
  const p = (line || '').trim();
  if (!p) return true;
  // Quit on the bare words too — someone leaving types "quit", not "/quit", and the
  // old behavior routed that to a Keeper as a question (a boat spawn to not-quit).
  // Exact single-word match only, so real questions never trip it.
  if (['/exit', '/quit', '/q', 'exit', 'quit', 'q'].includes(p.toLowerCase())) return false;
  if (p === '/restart') { restartAfterExit = true; return false; }
  if (p === '/reset') { doReset(); return true; }
  if (p === '/metrics') { showMetrics = !showMetrics; console.log(`  ${C.dim}metrics ${showMetrics ? `${C.green}on` : 'off'}${C.reset}\n`); return true; }
  if (p === '/status') { printStatus(); return true; }
  if (p === '/help' || p === '/hlp' || p === '/?' || p === '/h') { printHelp(); return true; }
  if (p === '/research' || p.startsWith('/research ')) { await doResearch(p.slice(9).trim()); return true; }
  if (p === '/update' || p === '/update --force') { await doUpdate(p.endsWith('--force')); return true; }
  if (p === '/model' || p.startsWith('/model ')) {
    const v = p.slice(6).trim();
    if (v) changeSettings(['model', v]); // takes effect next turn (--model on each boat spawn)
    else console.log(`  ${C.dim}model: ${C.gold}${cfg.model || '(CLI default)'}${C.reset}${C.dim} — /model <name> to change (sonnet, opus, haiku, …)${C.reset}\n`);
    return true;
  }
  if (p === '/settings' || p.startsWith('/settings ')) {
    const args = p.split(/\s+/).slice(1);
    if (args.length) changeSettings(args); // scriptable text path (also the non-TTY route)
    else if (boxCtl && boxCtl.openMenu) await boxCtl.openMenu(); // interactive arrow-key menu
    else printSettings();
    return true;
  }
  if (p === '/name' || p.startsWith('/name ')) {
    let nm = p.slice(5).trim();
    if (!nm) nm = ((await subAsk(`  ${C.gold}new name${C.reset} ${C.deep}›${C.reset} `)) || '').trim();
    if (nm) {
      const saved = saveProfile({ name: nm });
      profile.name = saved.name;
      applyProfile({ profile: saved }); // rebuild personas in place
      const reg = loadRegistry(registryPath); // flush warm sessions — persona is baked at creation
      reg.sessions = {};
      saveRegistry(reg, registryPath);
      console.log(`  ${C.green}✓${C.reset} name set to ${C.b}${saved.name}${C.reset} ${C.dim}— Keepers updated; they re-warm on next use${C.reset}\n`);
    } else {
      console.log(`  ${C.dim}use ${C.gold}/name <name>${C.reset}${C.dim} to set what your Keepers call you${C.reset}\n`);
    }
    return true;
  }

  // An unrecognized /command must NOT fall through to a Keeper as a question — that's
  // how a typo'd quit ("/qut") spawned a boat instead of closing. Only a lone /word
  // trips this (no second slash), so a real path in a question ("/Users/… what is
  // this?") still routes. Show the miss and the way out.
  const first = p.split(/\s+/)[0];
  if (/^\/[a-zA-Z?-]+$/.test(first)) {
    console.log(`  ${C.red}✗ unrecognized command${C.reset} ${C.dim}'${first}'${C.reset}\n`);
    printHelp();
    return true;
  }

  // A question → route it to a Keeper.
  const t0 = Date.now();
  const spin = boxCtl ? boxCtl.spinner('thinking') : thinking('thinking');
  const r = await handle(p, { mock, registryPath, ask: router });
  spin.stop();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  // A distinct solid marker for a Keeper's answer (↪ when it switched Keepers) — easy to
  // tell apart from the hollow ⟡ that prefixes YOUR lines and the · used elsewhere.
  const arrow = r.switched ? `${C.gold}↪${C.reset}` : `${C.gold}◆${C.reset}`;
  // Translate the classifier's internal reason codes into plain words for the header.
  // 'argmax' (a confident keyword win) is the quiet default → show nothing.
  const NOTE = { llm: 'routed by Pharos', argmax: '', 'sticky-below-floor': 'stayed put', 'sticky-hysteresis': 'stayed put', 'below-floor->intake': 'unclear → intake' };
  const note = NOTE[r.note] !== undefined ? NOTE[r.note] : r.note;
  const recall = r.recalled?.length ? ` ${C.dim}· recalled ${r.recalled.length}${C.reset}` : '';
  const adv = r.advised ? ` ${C.gold}· ⇡ advised${C.reset}` : '';
  const flush = r.redone ? (r.degraded ? ` ${C.red}· ⚠ degraded${C.reset}` : ` ${C.green}· reseeded${C.reset}`) : '';
  const early = r.compacting ? ` ${C.deep}· ⟳ pre-compacted${C.reset}` : '';
  // Header ABOVE the answer: who answered, how long it took, and the PER-TURN token cost
  // (new input + the answer) — the marginal cost of THIS question, not the resident
  // context. (The whole-thread load lives in the /metrics line.) So "hi" reads ~17 tok,
  // not the 20k+ of replayed context that was confusing here before.
  const u = r.usage || {};
  const turnTok = r.turnTokens || ((u.input_tokens || 0) + (u.output_tokens || 0));
  const tok = turnTok >= 1000 ? `${(turnTok / 1000).toFixed(1)}k` : `${turnTok}`;
  const meter = `  ${C.gray}⧖ ${secs}s${turnTok ? ` ${C.dim}·${C.gray} ◈ ${tok} tok` : ''}${C.reset}`;
  console.log(`  ${arrow} ${C.b}${r.routed}${C.reset} ${C.dim}(${r.alias})${C.reset} ${C.gray}${note}${r.fresh ? `${note ? ' · ' : ''}new` : ''}${C.reset}${recall}${adv}${flush}${early}${meter}`);
  if (showMetrics) printMetrics(r);
  console.log('');
  // Render the answer identically to /research — ANSI inline md, collapsed fenced code, and
  // the soft left gutter — via the shared helper. TTY only; piped/test output stays verbatim
  // (handled inside renderMarkdown). This was a verbatim copy of renderMarkdown's body.
  renderMarkdown(r.text);
  console.log('');
  // Update the persistent bottom-border HUD: current Keeper + TOTAL context against the
  // real context WINDOW (not the flush trigger — that was the confusing 150k "max").
  if (boxCtl) {
    const win = cfg.contextWindow || contextWindow();
    // Per-Keeper SESSION load (each Keeper is its own `claude` session), not a global
    // meter — and flag a fresh/reseeded session so a sudden DROP reads as "flushed",
    // not "broken". The HUD renders one figure per active Keeper from these.
    boxCtl.setStatus(r.routed, { ctx: r.contextTokens || 0, win, reseed: !!r.fresh });
  }
  return true;
}

// ---- the input box (TTY) — an ALWAYS-LIVE raw-mode line editor. It owns the keyboard
// for the whole session (not just per-prompt), so you can keep typing WHILE a Keeper
// thinks: each Enter drops the line into a queue that's answered one-at-a-time (turns
// never overlap). The box floats just under the content and the conversation fills the
// screen from the top down, then scrolls up once full — no dead whitespace. All cursor
// math is width-aware (boxui.js) so the ⟡ marker's colour codes never shift the column.
async function startBox() {
  const stdin = process.stdin;
  const out0 = process.stdout;
  const GUTTER = 2; // continuation lines wrap flush-left at the 2-col gutter (under the marker)
  let boxH = 3; // dynamic: 1 top rule + N wrapped input rows + 1 bottom border
  let lastBoxTop = null; // the box's last drawn top row + height — so a resize can wipe the
  let lastBoxH = boxH; //   old footprint instead of stranding a stale border mid-screen
  let lastContentBottom = null; // last transcript bottom — so a change in reserved rows (spinner /
  //                               pending queue) repaints instead of stranding old reserved rows
  let L = layout(out0.rows, boxH);
  const cols = () => out0.columns || 80;
  const w = (s) => out0.write(s);
  const bar = () => {
    if (scrollOff > 0) { // paging through history — show position + how to get back to live
      const above = Math.max(0, history.length - regionRows() - scrollOff);
      const tag = `↑ scrolled${above ? ` · ${above} above` : ' · top'} · Shift+↓/PgDn → live `;
      const fill = Math.max(8, W() - visLen(tag) - 2);
      return `  ${C.gold}${tag}${C.bronze}${'─'.repeat(fill)}${C.reset}`;
    }
    return `  ${C.bronze}${rule()}${C.reset}`;
  };

  // Row 1 is the PINNED ROSTER NAVBAR (drawNav) — the Keepers + ctx meter live at the TOP,
  // always visible while the transcript scrolls in the region BELOW it (rows 2…contentBottom).
  // The earlier frozen-top attempt smeared because nothing repainted the scrolled rows; now
  // paintTranscript() redraws the region from `history` and PgUp/PgDn give in-app scrollback,
  // so a row-1 navbar is clean. (Trade: the transcript's NATIVE scrollback top is sacrificed
  // for the one navbar row — acceptable now that scrollback paging exists.)
  const regionTop = 2;

  // The editable line lives in input.js's reducer state ({buf,curIdx,history,histIdx,draft,
  // pendingExit}); onKey is now a thin I/O shell that runs the reducer and applies its action.
  let edit = initInput();
  const kittyKeys = TTY && cfg.kittyKeys !== false; // kitty keyboard protocol → real Shift+Enter
  // The turn queue: submitted prompts answered one-at-a-time. Each item is { echo, raw, text }
  // — echo (coloured transcript line, printed right before ITS answer so echo/answer interleave),
  // raw (plain text for the pending indicator), text (paste-expanded, sent to the Keeper). Items
  // still waiting here are shown as pending rows UNDER the thinking line (drawPending).
  const queue = [];
  // Bracketed-paste capture: a multi-line paste is stashed whole and shown as a compact
  // `[Pasted text #N +L lines]` token in the box (the box is a single char-wrapping line —
  // it can't render the newlines), then expanded back to the full text on submit.
  let pasting = false;
  let pasteBuf = '';
  let pasteCount = 0;
  const pastes = new Map(); // id → full pasted text, expanded into the line at submit
  const expandPastes = (s) => String(s).replace(/\[Pasted text #(\d+) \+\d+ lines\]/g, (m, id) => (pastes.has(+id) ? pastes.get(+id) : m));
  const prefix = PROMPT;
  let activeId = null; // the Keeper that answered last — highlighted bold+white in the HUD roster
  const ctxById = new Map(); // keeperId(lower) → { ctx, reseed } : each Keeper's OWN session load
  let winTok = 0; // the context window (denominator), shown once at the end of the roster
  let spinning = false; // a thinking line is reserved on the row just above the box
  // Scrollback: every transcript line is retained here so the user can page UP through
  // earlier chat (the scroll region discards lines off its top — native scrollback can't
  // recover them). scrollOff = lines paged up from the live bottom (0 = live).
  const history = [];
  let scrollOff = 0;
  let menu = null; // menu.js reducer state while the /settings menu owns the keyboard
  let menuView = null; // row snapshot the reducer reads; rebuilt after each write
  let menuResolve = null; // resolves the openMenu() promise on close (unpauses the drain loop)

  // Wrap the current input across as many rows as it needs (long input flows to the next
  // line instead of scrolling sideways), and keep boxH/L in sync with that height.
  const measure = () => wrapInput(edit.buf, edit.curIdx, visLen(prefix), GUTTER, cols());
  // Box height = top rule + content rows + bottom border. Content is the menu when open,
  // otherwise the (wrapped) input line.
  const sync = () => { boxH = (menu ? menuLines(menu, menuView).length : measure().rows.length) + 2; L = layout(out0.rows, boxH); };

  const fmtK = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  // The roster — just the Keeper NAMES (the one that just answered bold+white, the rest grey).
  // Per-Keeper load numbers are gone: the active Keeper's load lives in the ctx meter below, so
  // repeating it here was redundant. Lives on the TOP navbar (drawNav).
  const rosterBar = () => KEEPERS.filter((k) => k.active).map((k) => {
    const name = k.id[0].toUpperCase() + k.id.slice(1);
    return activeId && k.id.toLowerCase() === activeId.toLowerCase()
      ? `${C.b}${C.white}${name}${C.reset}`
      : `${C.gray}${name}${C.reset}`;
  }).join(' ');
  // The context meter for the active Keeper — ctx used/window (pct); `↺` = the session was
  // reseeded/flushed this turn (so a drop reads as "flushed", not a broken meter). Lives on the
  // BOTTOM border where Josh wants it.
  const ctxMeter = () => {
    const rec = activeId ? ctxById.get(activeId.toLowerCase()) : null;
    if (rec && winTok) {
      const pct = Math.round((rec.ctx / winTok) * 100);
      return `${C.dim}ctx ${fmtK(rec.ctx)}/${fmtK(winTok)} (${pct}%)${rec.reseed ? ' ↺' : ''}${C.reset}`;
    }
    return winTok ? `${C.dim}/${fmtK(winTok)}${C.reset}` : '';
  };
  // A rule with a right-hand stat: `  ──────  <stat>  ─`. Used for both the top navbar and the
  // bottom border (a bare rule when the stat is empty).
  const statRule = (stat) => {
    if (!stat) return `  ${C.bronze}${rule()}${C.reset}`;
    const rail = Math.max(2, W() - visLen(stat) - 3);
    return `  ${C.bronze}${'─'.repeat(rail)}${C.reset} ${stat} ${C.bronze}─${C.reset}`;
  };
  // The pinned roster navbar (row 1, outside the scroll region) — Keeper NAMES only, always
  // visible at the TOP while the transcript scrolls beneath.
  const drawNav = () => w(`\x1b[1;1H\x1b[2K${statRule(rosterBar())}`);
  // The box's bottom border carries the ctx meter.
  const botBorder = () => statRule(ctxMeter());

  // The box is PINNED at the bottom. The transcript scrolls in a region ABOVE it, and
  // when a Keeper is thinking one extra row above the box is reserved for the spinner and
  // EXCLUDED from the scroll region — so streamed output (echoes, answers) can never land
  // on the spinner's row. This is what stops queued prompts from being overwritten.
  // Clamp the box's top row so a box taller than the terminal (e.g. the /settings menu in
  // a very short window) still draws from an on-screen row (leaving at least row 1 for the
  // transcript) instead of at a non-positive absolute row (which corrupts the draw).
  const boxTopRow = () => Math.max(regionTop + 1, out0.rows - boxH + 1);
  // Rows carved out between the transcript and the box, top→bottom: the spinner (1 row while
  // thinking) then the pending queue (one row per prompt still waiting). So the layout is
  // [transcript] [⠿ thinking] [⟡ queued…] [box] — queued prompts sit UNDER the verb line.
  const pendCount = () => queue.length;
  const contentBottom = () => Math.max(1, boxTopRow() - 1 - (spinning ? 1 : 0) - pendCount()); // last scrolling row
  const spinnerRow = () => boxTopRow() - 1 - pendCount(); // just above the pending block
  const setRegion = () => w(`\x1b[${regionTop};${contentBottom()}r`);
  const placeCursor = () => { const m = measure(); w(`\x1b[${boxTopRow() + 1 + m.cursorRow};${m.cursorCol + 1}H`); };
  // The pending-queue rows: one dim `⟡ … · queued` line per prompt still waiting, drawn just
  // above the box (below the spinner) so a prompt typed while a Keeper is busy shows it's queued.
  const drawPending = () => {
    const base = boxTopRow() - pendCount(); // first pending row
    queue.forEach((it, i) => {
      const flat = (it.raw || '').replace(/\s*\n\s*/g, ' ');
      const cap = Math.max(8, W() - 12);
      const shown = [...flat].length > cap ? `${[...flat].slice(0, cap - 1).join('')}…` : flat;
      w(`\x1b[${base + i};1H\x1b[2K  ${C.gray}⟡ ${shown} ${C.dim}· queued${C.reset}`);
    });
  };

  const drawBox = () => {
    sync();
    const top = boxTopRow();
    const cb = contentBottom();
    // The pinned zone changed shape — the box grew/shrank (multi-line, menu) OR the reserved
    // band did (spinner appeared/left, a queued prompt was added/answered). Rows that were box
    // or spinner/pending and now aren't are stale; wipe the whole old band and repaint the
    // transcript so nothing strands above the box (the `────` ladder / leftover `· queued` row).
    if (lastBoxTop != null && (top !== lastBoxTop || boxH !== lastBoxH || cb !== lastContentBottom)) {
      const from = Math.min(lastBoxTop, top) - 1;
      const to = Math.max(lastBoxTop + lastBoxH, top + boxH);
      for (let r = Math.max(regionTop, from); r <= Math.min(out0.rows, to); r += 1) w(`\x1b[${r};1H\x1b[2K`);
      setRegion();
      paintTranscript(); // refill the freed rows from history, bottom-aligned
    }
    setRegion(); // region matched to box height (+ spinner / pending rows)
    lastBoxTop = top; lastBoxH = boxH; lastContentBottom = cb; // remember this footprint
    drawNav(); // the pinned roster navbar on row 1
    drawPending(); // queued prompts under the spinner
    w(`\x1b[${top};1H\x1b[2K${bar()}`);
    if (menu) {
      const ls = menuLines(menu, menuView);
      ls.forEach((line, idx) => w(`\x1b[${top + 1 + idx};1H\x1b[2K${line}`));
      w(`\x1b[${top + 1 + ls.length};1H\x1b[2K${botBorder()}`);
      w(`\x1b[${top + 1 + ls.length};1H`); // park cursor on the border (no input caret in menu)
      return;
    }
    const m = measure();
    m.rows.forEach((line, idx) => {
      const lead = idx === 0 ? prefix : ' '.repeat(GUTTER); // marker on row 0; flush-left after
      w(`\x1b[${top + 1 + idx};1H\x1b[2K${lead}${line}`);
    });
    w(`\x1b[${top + 1 + m.rows.length};1H\x1b[2K${botBorder()}`);
    w(`\x1b[${top + 1 + m.cursorRow};${m.cursorCol + 1}H`);
  };
  const setStatus = (active, info) => {
    activeId = active;
    if (info && active) { ctxById.set(active.toLowerCase(), { ctx: info.ctx || 0, reseed: !!info.reseed }); winTok = info.win || winTok; }
    drawBox();
  };

  // Visible transcript rows (the scroll region's height) and the furthest we can page up.
  const regionRows = () => Math.max(1, contentBottom() - regionTop + 1);
  const maxScroll = () => Math.max(0, history.length - regionRows());
  // Repaint the transcript region from `history` at the current scrollOff (0 = live tail).
  // Absolute-addressed, so it overlays the natural-scroll output cleanly while paging.
  const paintTranscript = () => {
    const rows = regionRows();
    const bottom = contentBottom();
    // BOTTOM-align, matching out()'s natural-scroll model: sparse history sits at the bottom of
    // the region with blank rows above (top-aligning would jump the transcript to the top and
    // leave a gap under it). `scrollOff` pages the visible window back through history.
    const end = history.length - scrollOff;
    const visible = history.slice(Math.max(0, end - rows), end);
    const startRow = bottom - visible.length + 1;
    for (let r = regionTop; r <= bottom; r += 1) w(`\x1b[${r};1H\x1b[2K`); // clear the region
    visible.forEach((ln, i) => w(`\x1b[${startRow + i};1H${ln ?? ''}`));
  };
  const renderScroll = () => { paintTranscript(); drawBox(); }; // transcript + box/cursor back on top

  // Print into the scrolling transcript above the box. Natural scroll idiom: each line
  // scrolls the region up by one and prints at its bottom — so every echo and answer is
  // permanent and scrolls up in order (multiple queued prompts all stay visible). Every
  // line is also retained in `history` for scrollback.
  const out = (s = '') => {
    sync();
    // Pre-wrap EVERY line to the terminal width (ANSI-aware, hanging indent): the
    // scroll idiom below advances exactly one region row per line, so a line the
    // terminal itself would soft-wrap desyncs the row math (spinner/box drift) and
    // breaks the one-history-entry-per-row invariant paging repaints depend on.
    const lines = String(s).split('\n').flatMap((ln) => wrapAnsi(ln, cols()));
    for (const ln of lines) history.push(ln);
    // Paging up: don't disturb the view — buffer the output and hold the reader's position
    // (shift the offset by what arrived so the same lines stay on screen).
    if (scrollOff > 0) { scrollOff = Math.min(maxScroll(), scrollOff + lines.length); renderScroll(); return; }
    const bottom = contentBottom();
    w(`\x1b[${regionTop};${bottom}r`);
    for (const ln of lines) {
      w(`\x1b[${bottom};1H\n`);
      w(`\x1b[${bottom};1H\x1b[2K${ln}`);
    }
    drawBox();
  };

  // The thinking line — a rotating GOLD verb + elapsed seconds: `⠋ Divining… (4s · …)`.
  // On its own reserved row just above the box; cursor returns to the input each frame so
  // you can keep typing while it spins.
  const spinner = (label = 'thinking') => {
    const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
    const t0 = Date.now();
    const seed = Math.floor(Math.random() * VERBS.length);
    let lbl = label;
    let i = 0;
    // The just-submitted line was echoed onto the row that's about to become the spinner
    // row (when idle, contentBottom == spinnerRow). Scroll that row up into the permanent
    // transcript FIRST, so the spinner's clear doesn't eat the echo — this is the bug where
    // "my text disappears after I type it". A blank row here just scrolls harmlessly.
    if (!spinning) {
      const sr = spinnerRow();
      w(`\x1b[${regionTop};${sr}r`); // region down to the soon-to-be spinner row
      w(`\x1b[${sr};1H\n`); // scroll it up one: the echo moves into the transcript, sr goes blank
    }
    spinning = true;
    drawBox(); // reserve the spinner row (shrinks the scroll region by one)
    const paint = () => {
      const el = Date.now() - t0;
      w(`\x1b[${spinnerRow()};1H\x1b[2K  ${C.gray}${frames[i = (i + 1) % frames.length]}${C.reset} ${C.b}${C.gold}${verbAt(el, seed)}…${C.reset} ${C.dim}(${Math.floor(el / 1000)}s · ${lbl})${C.reset}`);
      placeCursor();
    };
    paint();
    const timer = setInterval(paint, 80);
    return { stop() { clearInterval(timer); w(`\x1b[${spinnerRow()};1H\x1b[2K`); spinning = false; drawBox(); }, set(l) { lbl = l; } };
  };

  // On resize the box moves to a new bottom-anchored position; its OLD rows aren't part
  // of the new scroll region and won't be scrolled away, so wipe that former footprint
  // (spinner row + box band) before redrawing — otherwise a grow strands a stale border
  // mid-screen and a shrink leaves orphaned transcript below the new box.
  const onResize = () => {
    if (lastBoxTop != null) {
      for (let k = -1; k <= lastBoxH; k += 1) {
        const r = lastBoxTop + k;
        if (r >= 1 && r <= out0.rows) w(`\x1b[${r};1H\x1b[2K`);
      }
    }
    drawBox();
  };
  // Mouse reporting (SGR encoding) so the WHEEL can drive the in-app scrollback — the
  // pinned box lives in a DECSTBM region on the main screen, so region-scrolled lines
  // never reach the terminal's native scrollback and the native wheel shows stale
  // frames. Trade-off (why this is a setting): while the app owns the mouse, plain
  // drag-to-select needs Shift held — terminal-standard for mouse TUIs, but if you
  // copy from the transcript constantly, `/settings mouseScroll` turns it off.
  const setMouse = (on) => { if (TTY) w(on ? '\x1b[?1000h\x1b[?1006h' : '\x1b[?1000l\x1b[?1006l'); };
  const teardown = () => {
    if (kittyKeys) w('\x1b[<u'); // pop the kitty keyboard-protocol flags we pushed
    setMouse(false); // always release the mouse, even if the setting flipped mid-run
    if (TTY) w('\x1b[?2004l'); // disable bracketed paste
    w('\x1b[r'); // release the scroll region
    w('\x1b[1;1H\x1b[2K'); // clear the pinned navbar row
    const top = boxTopRow();
    for (let k = -1; k < boxH; k += 1) w(`\x1b[${top + k};1H\x1b[2K`); // clear spinner row + box rows
    w(`\x1b[${top};1H\x1b[?25h`);
    out0.removeListener('resize', onResize);
    if (stdin.setRawMode) stdin.setRawMode(false);
  };

  // ---- the queue: submitted lines answered one-at-a-time, never overlapping ----
  let processing = false;
  let closing = false;
  let resolveLoop;
  const loopDone = new Promise((r) => { resolveLoop = r; });
  const finish = () => { if (!closing) { closing = true; resolveLoop(); } };

  async function drain() {
    if (processing) return;
    processing = true;
    while (queue.length && !closing) {
      const item = queue.shift(); // remove from the pending block first…
      if (item.echo) out(item.echo); // …then echo it into the transcript, right before ITS answer
      const keep = await handleLine(item.text);
      if (keep === false) { finish(); break; }
    }
    processing = false;
    drawBox();
  }

  // Enter → the line leaves the box and joins the queue; the box clears so you can type the
  // next one. The echo is DEFERRED to drain (printed right before the prompt's own answer) so
  // echoes/answers interleave; a prompt queued behind a running turn shows as a pending row.
  const submit = (line) => {
    drawBox(); // the reducer already cleared edit.buf — repaint the now-empty box
    const expanded = expandPastes(line || '').trim(); // full text (pastes restored) for the Keeper
    pastes.clear(); pasteCount = 0; // the line left the box — its pastes are consumed
    if (!expanded) return;
    const raw = (line || '').trim();
    // Pre-wrap the echo at a 4-cell gutter ('  ⟡ ') so every visual row of a multi-line
    // prompt lines up under the marker — the old \n-only indent left terminal-soft-wrapped
    // rows flush at column 0. wrapInput handles hard \n AND width (CJK-safe).
    const echoRows = raw ? wrapInput(raw, 0, 4, 4, cols()).rows : [];
    const echo = echoRows
      .map((r, i) => (i === 0
        ? `  ${C.deep}⟡${C.reset} ${C.sand}${r}${C.reset}`
        : `    ${C.sand}${r}${C.reset}`))
      .join('\n');
    queue.push({ echo, raw, text: expanded });
    if (processing) drawBox(); // a turn is already running → show this one as pending under the spinner
    drain();
  };

  // Open the interactive /settings menu: take over the keyboard and return a promise that
  // resolves on close, so the calling turn (handleLine) awaits — the drain loop pauses,
  // no new turns process while the menu is up.
  const openMenu = () => new Promise((res) => {
    menu = initMenu();
    menuView = buildMenuView();
    menuResolve = res;
    drawBox();
  });

  // Drive one keypress through the reducer while the menu owns the keyboard. Apply any
  // emitted intents (the only writers), re-snapshot the view to reflect them, redraw.
  const onMenuKey = (str, key) => {
    const r = menuKey(menu, { ...key, str }, menuView);
    for (const it of r.intents) applyMenuIntent(it);
    if (r.intents.length) menuView = buildMenuView();
    menu = r.state;
    if (r.close) {
      const top0 = boxTopRow(); const h = boxH; // the taller menu box's footprint
      menu = null; menuView = null;
      for (let i = -1; i <= h; i += 1) w(`\x1b[${top0 + i};1H\x1b[2K`); // wipe its band before the input box shrinks back in
      const res = menuResolve; menuResolve = null;
      drawBox();
      if (res) res();
      return;
    }
    drawBox();
  };

  // Ctrl+Z: suspend to the parent shell like any well-behaved program. Raw mode disables the
  // terminal's signal generation, so the keystroke arrives as a plain key — we restore the
  // terminal, raise SIGTSTP ourselves, and on resume (fg) re-arm raw mode and redraw from
  // history. Without this, Ctrl+Z just does nothing in the box.
  const suspend = () => {
    teardown(); // cooked mode, show cursor, release region, pop kitty/paste, drop resize listener
    stdin.removeListener('keypress', onKey);
    process.once('SIGCONT', () => {
      if (stdin.setRawMode) stdin.setRawMode(true);
      if (TTY) w('\x1b[?2004h');
      if (kittyKeys) w('\x1b[>1u');
      if (cfg.mouseScroll) setMouse(true);
      stdin.resume();
      stdin.on('keypress', onKey);
      out0.on('resize', onResize);
      lastBoxTop = null; // force a clean redraw (no stale-footprint wipe against a torn-down box)
      if (TTY) w('\x1b[2J\x1b[3J\x1b[H');
      setRegion();
      renderScroll(); // repaint transcript + navbar + box
    });
    // SIGSTOP (not SIGTSTP) so we stop reliably — it can't be caught/blocked and isn't subject
    // to the orphaned-process-group rule that silently drops SIGTSTP. `fg` resumes us via SIGCONT.
    process.kill(process.pid, 'SIGSTOP');
  };

  const onKey = (str, key) => {
    key = key || {};
    if (menu) return onMenuKey(str, key); // menu owns the keyboard while open
    // Bracketed paste: buffer the whole block, never let an embedded newline submit it.
    if (key.name === 'paste-start') { pasting = true; pasteBuf = ''; return; }
    if (key.name === 'paste-end') {
      pasting = false;
      const text = pasteBuf.replace(/\r\n?/g, '\n'); // normalise CRLF/CR → LF
      pasteBuf = '';
      const lines = text.split('\n').length;
      let ins;
      if (lines > 1) { pasteCount += 1; pastes.set(pasteCount, text); ins = `[Pasted text #${pasteCount} +${lines} lines]`; }
      else ins = text; // single-line paste flows inline (the box wraps it)
      edit = { ...edit, buf: edit.buf.slice(0, edit.curIdx) + ins + edit.buf.slice(edit.curIdx), curIdx: edit.curIdx + ins.length };
      return drawBox();
    }
    if (pasting) { if (typeof str === 'string') pasteBuf += str; return; } // accumulate, redraw once at paste-end
    // Scrollback: PageUp/PageDown page through retained transcript history (a page = one
    // region-height, minus a row of overlap for orientation). Any other key snaps to live.
    if (key.name === 'pageup') { scrollOff = Math.min(maxScroll(), scrollOff + Math.max(1, regionRows() - 1)); return renderScroll(); }
    if (key.name === 'pagedown') { scrollOff = Math.max(0, scrollOff - Math.max(1, regionRows() - 1)); return renderScroll(); }
    // Shift+↑/↓ scroll line-wise — the Mac-friendly binding (PgUp/PgDn need Fn+arrows on a
    // laptop keyboard, which nobody finds).
    if (key.shift && key.name === 'up') { scrollOff = Math.min(maxScroll(), scrollOff + 1); return renderScroll(); }
    if (key.shift && key.name === 'down') { scrollOff = Math.max(0, scrollOff - 1); return renderScroll(); }
    // Mouse wheel (SGR mouse reporting, enabled when mouseScroll is on): button 64 = wheel
    // up, 65 = wheel down. 3 lines per notch. Any other mouse event (clicks, drags) is
    // swallowed so it never leaks bytes into the input buffer.
    const seq = typeof key.sequence === 'string' ? key.sequence : '';
    const wheel = /^\x1b\[<(6[45]);\d+;\d+[Mm]$/.exec(seq);
    if (wheel) {
      if (wheel[1] === '64') scrollOff = Math.min(maxScroll(), scrollOff + 3);
      else scrollOff = Math.max(0, scrollOff - 3);
      return renderScroll();
    }
    if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(seq)) return; // non-wheel mouse event — ignore
    if (scrollOff > 0) { scrollOff = 0; renderScroll(); } // typing/navigating snaps back to the live tail, then handle the key
    if (key.ctrl && key.name === 'z') return suspend(); // Ctrl+Z → background to the shell like a normal program
    // kitty keyboard protocol: a key with no legacy encoding (Shift+Enter, Esc, …) arrives as
    // a CSI-u sequence readline can't classify — its raw bytes land in key.sequence. Decode it
    // into the normalized key the reducer understands (alt ⇒ meta). Everything else (printable,
    // Ctrl+letter, arrows) keeps its legacy encoding and flows through readline's key as-is.
    const ku = kittyKeys ? parseCsiU(key.sequence) : null;
    const nk = ku ? { name: ku.name, shift: ku.shift, ctrl: ku.ctrl, meta: ku.alt } : key;
    const ch = ku ? '' : str;
    // Everything else — editing, navigation, history, cancel — is decided by the pure reducer.
    const { state, action } = reduceKey(edit, nk, ch);
    edit = state;
    switch (action.type) {
      case 'submit': return submit(action.line);
      case 'exit': return finish();
      case 'hint-exit': return out(`  ${C.dim}press Ctrl+C again to exit${C.reset}`);
      case 'redraw': return drawBox();
      default: return undefined; // 'none'
    }
  };

  // Pin the box at the bottom and open the scroll region above it. The boot screen stays
  // on view and scrolls up into history naturally as the conversation grows.
  if (stdin.setRawMode) stdin.setRawMode(true);
  if (TTY) w('\x1b[?2004h'); // enable bracketed paste → readline emits paste-start/paste-end
  // Push the kitty keyboard-protocol "disambiguate escape codes" flag so Shift+Enter (and Esc)
  // arrive as distinct CSI-u sequences. Surgical: keys with a legacy encoding (Ctrl+W, arrows,
  // printables) are unaffected, so readline's parsing of them still works. Popped in teardown.
  if (kittyKeys) w('\x1b[>1u');
  if (cfg.mouseScroll) setMouse(true);
  stdin.resume();
  sync();
  setRegion();

  boxCtl = { out, spinner, redraw: drawBox, setStatus, teardown, openMenu, setMouse };
  const origLog = console.log;
  console.log = (...a) => out(a.map((x) => (typeof x === 'string' ? x : String(x))).join(' '));
  out0.on('resize', onResize);
  process.on('exit', () => { try { console.log = origLog; teardown(); } catch { /* noop */ } });

  readline.emitKeypressEvents(stdin);
  stdin.on('keypress', onKey);
  drawBox();

  await loopDone;
  stdin.removeListener('keypress', onKey);
  console.log = origLog;
  teardown(); // terminal fully restored BEFORE a possible re-exec inherits it
  respawnIfRequested();
  origLog(`  ${C.dim}— Alexandria out.${C.reset}`);
  process.exit(0);
}

if (TTY) {
  await startBox();
} else {
  // Non-TTY (pipes / tests): plain readline. Serialize turns through a queue — piped
  // input emits all its 'line' events up front, so we process strictly one-at-a-time
  // and finish the in-flight turn before a later '/exit' closes (else the turn drops).
  rlNonTty = readline.createInterface({ input: process.stdin, output: process.stdout });
  const showPrompt = () => { rlNonTty.setPrompt(PROMPT); rlNonTty.prompt(); };
  const queue = [];
  let processing = false;
  let closing = false;
  const drain = async () => {
    if (processing) return;
    processing = true;
    while (queue.length && !closing) {
      const keep = await handleLine(queue.shift());
      if (!keep) { closing = true; rlNonTty.close(); }
    }
    processing = false;
    if (!closing) showPrompt();
  };
  showPrompt();
  rlNonTty.on('line', (line) => { queue.push(line); drain(); });
  rlNonTty.on('close', () => { respawnIfRequested(); console.log(`  ${C.dim}— Alexandria out.${C.reset}`); process.exit(0); });
}
