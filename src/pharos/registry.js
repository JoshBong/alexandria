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

// Bump whenever the boat spawn config changes in a way that makes EXISTING warm
// sessions stale — persona/identity text, cwd, tools, setting-sources. A session bakes
// its persona + environment at creation; prewarm SKIPS already-warm Keepers, so without
// this an old session would survive a code change forever. migrateRegistry flushes the
// sessions on a version mismatch so they re-create cleanly on next use.
export const REGISTRY_VERSION = 4;

export function migrateRegistry(reg) {
  if (reg.version !== REGISTRY_VERSION) {
    reg.sessions = {};
    reg.current = null;
    reg.version = REGISTRY_VERSION;
    return true; // flushed
  }
  return false;
}

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
