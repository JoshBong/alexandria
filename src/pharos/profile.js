// Operator profile — who Alexandria is running for. The repo ships NO identity;
// this is the single seam that personalizes it, written on first run (onboarding)
// and gitignored, so nothing personal is ever committed.
//
//   name   — what the Keepers call the operator (interpolated into personas as
//            the `${name}` token). Defaults to a neutral placeholder.
//   about  — optional freeform context appended to every Keeper persona (schools,
//            role, what they're working on). The operator fills this in; it never
//            ships in the repo.
//
// Resolution: DEFAULT < .pharos/profile.json < env (ALEXANDRIA_NAME). Injectable
// path for tests. Standalone (no heavy imports) so onboarding can run before the
// Keeper registry is built.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PROFILE = { name: 'the operator', about: '' };

export function profilePath() {
  return process.env.ALEXANDRIA_PROFILE || path.join(process.cwd(), '.pharos', 'profile.json');
}

function read(p) {
  try {
    const f = JSON.parse(fs.readFileSync(p || profilePath(), 'utf8'));
    return f && typeof f === 'object' ? f : null;
  } catch {
    return null;
  }
}

export function getProfile({ path: p } = {}) {
  const out = { ...DEFAULT_PROFILE };
  const f = read(p);
  if (f) {
    if (typeof f.name === 'string' && f.name.trim()) out.name = f.name.trim();
    if (typeof f.about === 'string') out.about = f.about;
  }
  if (process.env.ALEXANDRIA_NAME && process.env.ALEXANDRIA_NAME.trim()) out.name = process.env.ALEXANDRIA_NAME.trim();
  return out;
}

// True once the operator has a saved name — used to gate first-run onboarding.
export function hasProfile({ path: p } = {}) {
  const f = read(p);
  return !!(f && typeof f.name === 'string' && f.name.trim());
}

export function saveProfile(profile, { path: p } = {}) {
  const target = p || profilePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const merged = { ...DEFAULT_PROFILE, ...read(target), ...profile };
  fs.writeFileSync(target, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}
