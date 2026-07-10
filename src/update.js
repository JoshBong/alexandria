// Self-update — check the GitHub repo for a newer version and reinstall in place.
//
// Alexandria installs straight from GitHub (`npm i -g github:JoshBong/alexandria`), so
// "update" is just: compare the local package.json version against main's, and re-run the
// same install when it's behind. Mock-first like everything else: the fetch and the
// installer are injectable so tests never hit the network or npm.

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const PKG_SPEC = 'github:JoshBong/alexandria';
const RAW_PKG_URL = 'https://raw.githubusercontent.com/JoshBong/alexandria/main/package.json';

export function localVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version;
}

// Numeric dotted compare: 1 if a>b, -1 if a<b, 0 if equal. Plain x.y.z only.
export function cmpVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// The real installer: `npm i -g <spec>` as a child process, quiet. Resolves exit code.
function npmInstall() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('npm', ['install', '-g', PKG_SPEC], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      return resolve(1);
    }
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

// Check + (maybe) install. Returns one of:
//   { status: 'current',  version }                     — already on main's version
//   { status: 'updated',  from, to }                    — installed the newer version
//   { status: 'failed',   from, to?, reason }           — check or install broke
// `force: true` skips the version compare and reinstalls unconditionally.
export async function update({ force = false, fetchImpl = fetch, install = npmInstall } = {}) {
  const from = localVersion();
  let to;
  try {
    const res = await fetchImpl(RAW_PKG_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    to = (await res.json()).version;
  } catch (e) {
    if (!force) return { status: 'failed', from, reason: `version check failed (${e.message})` };
    to = undefined; // forced: install anyway, sight unseen
  }
  if (!force && to !== undefined && cmpVersions(to, from) <= 0) return { status: 'current', version: from };
  const code = await install();
  if (code !== 0) return { status: 'failed', from, to, reason: `npm install exited ${code}` };
  return { status: 'updated', from, to: to ?? '(latest)' };
}
