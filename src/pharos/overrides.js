// Per-Keeper local overrides — the operator's OWN routing vocabulary and persona
// context, layered onto the generic shipped Keepers. Lives at a gitignored
// `.pharos/keepers.local.json`, so personal terms (names, places, employers) and
// any private persona context never touch the repo.
//
// Shape (every key optional):
//   {
//     "<keeperId>": {
//       "terms":          { "<term>": <weight>, ... },   // merged onto base terms
//       "personaContext": "one or two sentences of standing context for this domain",
//       "model":          "<alias>"   // per-Keeper model override; '' / absent = follow
//                                     // the global `model` setting (see settings.js)
//     },
//     ...
//   }
//
// Ships ABSENT by default — the public repo runs on the generic registry alone. An
// operator grows this over time (by hand, or as Alexandria learns their vocabulary).

import fs from 'node:fs';
import path from 'node:path';

export function overridesPath() {
  return process.env.ALEXANDRIA_KEEPERS_LOCAL || path.join(process.cwd(), '.pharos', 'keepers.local.json');
}

export function loadOverrides({ path: p } = {}) {
  try {
    const f = JSON.parse(fs.readFileSync(p || overridesPath(), 'utf8'));
    return f && typeof f === 'object' ? f : {};
  } catch {
    return {}; // absent / unreadable → generic registry only
  }
}

// Merge a partial override for one Keeper into .pharos/keepers.local.json (creating the
// file on first write). Mirrors saveSettings/saveProfile. Returns the full overrides map
// after the write so callers can re-apply in place (buildKeepers/applyProfile).
export function saveOverride(keeperId, patch, { path: p } = {}) {
  const target = p || overridesPath();
  const cur = loadOverrides({ path: target });
  const next = { ...cur, [keeperId]: { ...(cur[keeperId] || {}), ...patch } };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(next, null, 2) + '\n');
  return next;
}
