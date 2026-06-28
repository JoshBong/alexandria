// The compaction tier — handoff + reseed for a degraded Keeper.
//
// When the secretary sees a Keeper's answer lose its canary, the warm thread is
// degraded. We can't reach into the claude session to compact it cleanly, but we
// CAN do the next best thing (Josh: "it's late but better than nothing"): write a
// handoff, flush the session, and REDO the turn on a fresh session reseeded with
// continuity. The handoff file is the durable artifact (an external supervisor or
// the next process can read it); the reseed preamble is what actually restores
// continuity on the redo.
//
// Continuity source = the last few prompts to that Keeper, tracked in the registry
// (pointers, not warm context — stays within the stateless-secretary rule). This is
// the minimal durable trace needed to make a fresh session pick up where it left off.

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../');
const defaultDir = join(repoRoot, '.pharos', 'handoffs');

const RECENT_CAP = 5;

// Record a prompt against a Keeper's rolling recent-list (the reseed source).
export function trackRecent(reg, keeperId, prompt) {
  reg.recent = reg.recent || {};
  reg.recent[keeperId] = [...(reg.recent[keeperId] || []), prompt].slice(-RECENT_CAP);
  return reg.recent[keeperId];
}

// Write the durable handoff artifact for a flushed Keeper. Returns the file path.
export function writeHandoff(keeperId, reg, opts = {}) {
  const dir = opts.dir || defaultDir;
  const recent = (reg.recent && reg.recent[keeperId]) || [];
  const stamp = opts.now || new Date().toISOString();
  const lines = [
    `# Handoff — ${keeperId}`,
    '',
    `> Written ${stamp} because the canary dropped (degraded warm thread). The`,
    `> session was flushed; the next turn reseeds from the recent requests below.`,
    '',
    '## Recent requests in this domain',
    ...(recent.length ? recent.map((p) => `- ${p}`) : ['- (none recorded)']),
    '',
  ];
  const file = join(dir, `${keeperId}.md`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, lines.join('\n'));
  return file;
}

// Build the reseed preamble prepended to the redo prompt, giving a fresh session
// continuity with the flushed thread. Empty string if there's nothing to restore.
export function buildReseed(keeperId, alias, reg) {
  const recent = (reg.recent && reg.recent[keeperId]) || [];
  if (!recent.length) return '';
  return [
    `[reseed] Resuming your ${alias} thread after a compaction — earlier context was`,
    `flushed. Recent requests in this domain, for continuity:`,
    ...recent.map((p) => `- ${p}`),
    `Carry on from these; don't re-ask for what they already established.`,
  ].join('\n');
}

// Read a handoff file back (for an external supervisor / next process). null if absent.
export function readHandoff(keeperId, opts = {}) {
  const file = join(opts.dir || defaultDir, `${keeperId}.md`);
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
