// Alexandria settings — runtime toggles for the harness.
//
// Resolution order (later wins): DEFAULTS < .pharos/settings.json < env vars.
// Kept tiny and dependency-free. Injectable via getSettings({ settingsPath }) so
// tests run against an isolated file (or none → defaults).
//
//   reframe   — the secretary REWRITES the user's prompt into a clean, context-
//               stamped question before handing it to the Keeper (forward path).
//               Costs +1 cheap LLM call per turn. Default off (the free local
//               composer just frames + attaches recall).
//   revoice   — the secretary RE-VOICES the Keeper's answer in one consistent
//               Alexandria voice before returning it (return path). Costs +1 LLM
//               call per turn. Default off (raw Keeper answer relayed straight
//               through — faster, and each Keeper's own voice is usually fine).
//   skipPerms — boats spawn with `--dangerously-skip-permissions`. Default ON:
//               boats are headless `claude -p` and an acting Keeper (Ptah) would
//               otherwise hang on a permission prompt with no one to answer it.
//   prewarm   — on Alexandria start, establish every active Keeper's session in
//               PARALLEL (one cheap turn each) so the first switch to a domain is
//               a warm `--resume` (persona prefix already prompt-cached) instead of
//               a cold fresh spawn. Default ON. Costs N cheap calls at startup,
//               once; trades a few seconds of boot for a faster first switch.
//   metrics   — show a detailed per-turn metrics line in the REPL (token load vs
//               the window, compaction/degrade state, recall count, warm/cold).
//               Default OFF; toggle live with `/metrics`.
//
// Two STRING settings carry the shared on-demand tool layer (every Keeper, loaded
// lazily, never injected up front — see keeper.js):
//   sharedTools — extra built-in tools appended to every Keeper's allowlist, e.g.
//                 "WebSearch,WebFetch" so any Keeper can browse on demand. Each
//                 deferred tool costs ~300 tokens only if/when actually loaded.
//   mcpConfig   — path to a shared MCP server config (`--mcp-config`) handed to
//                 every boat: connectors like a browser, Gmail, or calendar that all
//                 Keepers can reach on demand. Default "" (none).

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  reframe: false,
  revoice: false,
  skipPerms: true,
  prewarm: true,
  metrics: false,
};

// String-valued settings (not booleans) — resolved separately from the bool flags.
export const STRING_DEFAULTS = {
  sharedTools: '',
  mcpConfig: '',
  model: '', // which model the Keepers run on (claude CLI --model alias/id). '' = CLI default.
};

const ENV = {
  reframe: 'ALEXANDRIA_REFRAME',
  revoice: 'ALEXANDRIA_REVOICE',
  skipPerms: 'ALEXANDRIA_SKIP_PERMS',
  prewarm: 'ALEXANDRIA_PREWARM',
  metrics: 'ALEXANDRIA_METRICS',
};

const STRING_ENV = {
  sharedTools: 'ALEXANDRIA_SHARED_TOOLS',
  mcpConfig: 'ALEXANDRIA_MCP_CONFIG',
  model: 'ALEXANDRIA_MODEL',
};

function envBool(name) {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = String(v).toLowerCase();
  if (t === '1' || t === 'true' || t === 'on' || t === 'yes') return true;
  if (t === '0' || t === 'false' || t === 'off' || t === 'no') return false;
  return undefined;
}

// Persist a partial change to .pharos/settings.json (merging onto what's there), so a
// runtime `/settings` toggle survives restarts and is picked up by the next turn's
// getSettings(). Returns the resolved settings after the write.
export function saveSettings(patch, { settingsPath } = {}) {
  const p = settingsPath || path.join(process.cwd(), '.pharos', 'settings.json');
  let cur = {};
  try {
    cur = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch {
    /* no file yet */
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2) + '\n');
  return getSettings({ settingsPath });
}

export function getSettings({ settingsPath } = {}) {
  const out = { ...DEFAULTS, ...STRING_DEFAULTS };

  const p = settingsPath || path.join(process.cwd(), '.pharos', 'settings.json');
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    for (const k of Object.keys(DEFAULTS)) if (k in file) out[k] = !!file[k];
    for (const k of Object.keys(STRING_DEFAULTS)) if (typeof file[k] === 'string') out[k] = file[k];
  } catch {
    /* no file / unreadable → defaults */
  }

  for (const k of Object.keys(DEFAULTS)) {
    const e = envBool(ENV[k]);
    if (e !== undefined) out[k] = e;
  }
  for (const k of Object.keys(STRING_DEFAULTS)) {
    const e = process.env[STRING_ENV[k]];
    if (typeof e === 'string') out[k] = e;
  }

  return out;
}
