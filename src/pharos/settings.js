// Alexandria settings — runtime toggles for the harness.
//
// Resolution order (later wins): DEFAULTS < .pharos/settings.json < env vars.
// Kept tiny and dependency-free. Injectable via getSettings({ settingsPath }) so
// tests run against an isolated file (or none → defaults).
//
//   reframe   — the routed KEEPER (on its own model) REWRITES the user's prompt into
//               a clean, context-stamped question before answering (forward path).
//               Costs +1 LLM call per turn on the Keeper's model. Default off (the
//               free local composer just frames + attaches recall).
//   revoice   — the routed KEEPER (on its own model) RE-VOICES its answer in one
//               consistent voice before returning it (return path). Costs +1 LLM call
//               per turn. Default off (raw Keeper answer relayed straight through —
//               faster, and each Keeper's own voice is usually fine).
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

//   kittyKeys — enable the kitty keyboard protocol on the TTY so Shift+Enter can be told
//               apart from plain Enter (a plain terminal sends a bare CR for both). On a
//               supporting terminal (ghostty/kitty/WezTerm/…) this is what makes Shift+Enter
//               insert a newline. Default ON; the box also accepts a trailing "\" + Enter and
//               Option+Enter as portable fallbacks, so turning this off loses only Shift+Enter.
//   advisor   — the escalate-up gate (see pharos/advisor.js): advisor-enabled Keepers
//               (Ptah, on a cheap driver model) may emit an ADVISE: brief at a hard
//               fork, which Pharos relays to the shared warm opus advisor and hands
//               the verdict back to the same warm Keeper session. This is the GLOBAL
//               kill switch; which Keepers participate is per-Keeper (keepers.js
//               `advisor` + keepers.local.json override). Default ON.
//   mouseScroll — SGR mouse reporting in the box so the WHEEL scrolls the in-app
//               transcript history (the pinned box's scroll region never reaches the
//               terminal's native scrollback). Trade-off: while on, drag-to-select in
//               the terminal needs Shift held. Default ON; turn off if you copy from
//               the transcript more than you scroll it.
//   discountOffline — discount/offline mode: force every role-routed one-shot onto the
//               LOCAL base role (point roles.base at a local provider, e.g. ollama) and
//               never fall back to the claude spawn — a fallback would silently leave
//               the machine (and the free tier). Covers the provider layer (askOnce
//               role calls) only: warm Keeper turns still run through the claude CLI
//               and are NOT made local by this. Default OFF.
//   learn     — learn-over-time (memory/learn.js): after a turn answers, a forked
//               extractor writes any durable fact about the operator through the gated
//               store, on the cheap `bulk` tier, fire-and-forget (zero turn latency).
//               This is what fills the memory the Keepers later recall. Default ON.
export const DEFAULTS = {
  reframe: false,
  revoice: false,
  skipPerms: true,
  prewarm: true,
  metrics: false,
  kittyKeys: true,
  advisor: true,
  mouseScroll: true,
  discountOffline: false,
  learn: true,
};

// String-valued settings (not booleans) — resolved separately from the bool flags.
// The claude CLI's --effort levels. Anything else in the `effort` setting is ignored.
export const EFFORT_CHOICES = ['low', 'medium', 'high', 'xhigh', 'max'];

export const STRING_DEFAULTS = {
  // The read-only / research tools every Keeper gets by default: web (search+fetch) plus
  // file inspection (read a referenced file, grep contents, glob for paths). All safe to
  // share with any Keeper and deferred — each costs ~300 tokens only if used in a turn.
  // The file/shell WRITERS (Bash/Write/Edit) are deliberately NOT here — sharing those
  // with every Keeper is a footgun; toggle them per need in /settings → shared tools.
  sharedTools: 'WebSearch,WebFetch,Read,Grep,Glob',
  mcpConfig: '',
  model: '', // which model the Keepers run on (claude CLI --model alias/id). '' = CLI default.
  effort: '', // claude CLI --effort for every Keeper (one of EFFORT_CHOICES). '' = CLI default.
  // Where the local Ollama server lives (its OpenAI-compatible /v1 root). The provider
  // registry reads this so a non-default port/host (or a remote box on the LAN) is one
  // setting away, not a code change.
  ollamaUrl: 'http://localhost:11434/v1',
  // The operator's own TODO markdown file — /todo reads and checks off items there.
  // Empty = feature off. Deliberately a user path, never a repo default: Alexandria
  // owns no todo list (P2 rail — the user's store, adapted, not replaced).
  todoPath: '',
};

// Number-valued settings.
//   contextWindow — the model's context window, used as the "max" the UI shows context
//                   load against (NOT the early-flush trigger). Default 200k; set to
//                   1000000 for a 1M-context model.
export const NUMBER_DEFAULTS = {
  contextWindow: 200_000,
};

// roles — the multi-provider model map, keyed by ROLE not by Keeper. A role is a job
//         a turn needs done (not "who" — that's Keepers); the provider adapter (parked,
//         see SESSION_LOG 2026-06-29) will read this to pick which model runs each job.
//   base     — the default driver for an ordinary Keeper turn.
//   creative — writing/brainstorm-flavored turns.
//   bulk     — cheap/high-volume turns (e.g. loop steps, batch grading).
//   escalate — the advisor/reviewer tier (hard forks, independent verdicts).
// Format "<provider>/<model>" so the adapter can dispatch on the prefix. Merged per-key
// (not replaced wholesale) so a partial override in settings.json only touches one role.
export const ROLES_DEFAULTS = {
  base: 'ollama/gpt-oss:20b',
  creative: 'gemini/gemini-2.5-flash',
  bulk: 'anthropic/haiku',
  escalate: 'anthropic/opus',
};

const ENV = {
  reframe: 'ALEXANDRIA_REFRAME',
  revoice: 'ALEXANDRIA_REVOICE',
  skipPerms: 'ALEXANDRIA_SKIP_PERMS',
  prewarm: 'ALEXANDRIA_PREWARM',
  metrics: 'ALEXANDRIA_METRICS',
  kittyKeys: 'ALEXANDRIA_KITTY_KEYS',
  advisor: 'ALEXANDRIA_ADVISOR',
  mouseScroll: 'ALEXANDRIA_MOUSE_SCROLL',
  discountOffline: 'ALEXANDRIA_DISCOUNT_OFFLINE',
  learn: 'ALEXANDRIA_LEARN',
};

const STRING_ENV = {
  sharedTools: 'ALEXANDRIA_SHARED_TOOLS',
  mcpConfig: 'ALEXANDRIA_MCP_CONFIG',
  model: 'ALEXANDRIA_MODEL',
  effort: 'ALEXANDRIA_EFFORT',
  ollamaUrl: 'ALEXANDRIA_OLLAMA_URL',
  todoPath: 'ALEXANDRIA_TODO_PATH',
};

const NUMBER_ENV = {
  contextWindow: 'ALEXANDRIA_CONTEXT_WINDOW',
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
  const out = { ...DEFAULTS, ...STRING_DEFAULTS, ...NUMBER_DEFAULTS, roles: { ...ROLES_DEFAULTS } };

  const p = settingsPath || path.join(process.cwd(), '.pharos', 'settings.json');
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    for (const k of Object.keys(DEFAULTS)) if (k in file) out[k] = !!file[k];
    for (const k of Object.keys(STRING_DEFAULTS)) if (typeof file[k] === 'string') out[k] = file[k];
    for (const k of Object.keys(NUMBER_DEFAULTS)) if (Number.isFinite(file[k]) && file[k] > 0) out[k] = file[k];
    if (file.roles && typeof file.roles === 'object') {
      for (const k of Object.keys(ROLES_DEFAULTS)) if (typeof file.roles[k] === 'string') out.roles[k] = file.roles[k];
    }
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
  for (const k of Object.keys(NUMBER_DEFAULTS)) {
    const e = Number(process.env[NUMBER_ENV[k]]);
    if (Number.isFinite(e) && e > 0) out[k] = e;
  }

  return out;
}
