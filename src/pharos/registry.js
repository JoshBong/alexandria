// Pharos's tiny persistent state — NOT warm context, just a pointer file.
//
// Records which Keeper you're currently in and each Keeper's resumable session id.
// This is the only thing the (otherwise stateless) head remembers between prompts.
// Lives at <repo>/.pharos/registry.json (gitignored).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../');
const file = join(repoRoot, '.pharos', 'registry.json');

const fresh = () => ({ current: null, sessions: {} });

export function loadRegistry(target = file) {
  try {
    return { ...fresh(), ...JSON.parse(readFileSync(target, 'utf8')) };
  } catch {
    return fresh();
  }
}

export function saveRegistry(reg, target = file) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(reg, null, 2) + '\n');
}
