// Per-Keeper local overrides — the operator's OWN routing vocabulary and persona
// context, layered onto the generic shipped Keepers. Lives at a gitignored
// `.pharos/keepers.local.json`, so personal terms (names, places, employers) and
// any private persona context never touch the repo.
//
// Shape (every key optional):
//   {
//     "<keeperId>": {
//       "terms":          { "<term>": <weight>, ... },   // merged onto base terms
//       "personaContext": "one or two sentences of standing context for this domain"
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
