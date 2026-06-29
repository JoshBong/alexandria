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

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  reframe: false,
  revoice: false,
  skipPerms: true,
};

const ENV = {
  reframe: 'ALEXANDRIA_REFRAME',
  revoice: 'ALEXANDRIA_REVOICE',
  skipPerms: 'ALEXANDRIA_SKIP_PERMS',
};

function envBool(name) {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = String(v).toLowerCase();
  if (t === '1' || t === 'true' || t === 'on' || t === 'yes') return true;
  if (t === '0' || t === 'false' || t === 'off' || t === 'no') return false;
  return undefined;
}

export function getSettings({ settingsPath } = {}) {
  const out = { ...DEFAULTS };

  const p = settingsPath || path.join(process.cwd(), '.pharos', 'settings.json');
  try {
    const f = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const k of Object.keys(DEFAULTS)) if (k in f) out[k] = !!f[k];
  } catch {
    /* no file / unreadable → defaults */
  }

  for (const k of Object.keys(DEFAULTS)) {
    const e = envBool(ENV[k]);
    if (e !== undefined) out[k] = e;
  }

  return out;
}
