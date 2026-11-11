// The input buffer — an append-only JSONL file, one raw injection per line.
//
// Human input is async, buffered, and batched: it NEVER interrupts a running step
// (docs/auto-loop.md §1). Injections land here while a step runs; the boundary
// drains everything new and hands it to the elaborator + planner.
//
// "Drained" is not stored in the file (it stays append-only) — the driver keeps a
// cursor in plan.inboxDrained, so drainInbox is pure given that cursor. Same
// append-only shape as events.js.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loopPaths } from './paths.js';

const fileFor = (opts) => opts.file || loopPaths(opts.loopId, opts).inbox;

// Read all injections (parsed). Bad lines skipped. [] if the file is absent.
export function readInbox(opts = {}) {
  try {
    return readFileSync(fileFor(opts), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

// Append one raw injection. Stamps an id (`i<N>` by line count) and ts unless given.
// `STOP` is just an ordinary input whose raw the driver recognizes — no special path
// here, keeping the buffer dumb (the one structure rule).
export function appendInput(raw, opts = {}) {
  const file = fileFor(opts);
  const n = readInbox(opts).length;
  const record = {
    id: opts.id || `i${n + 1}`,
    raw,
    ts: opts.ts || new Date().toISOString(),
    elaborated: opts.elaborated ?? null,
  };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + '\n');
  return record;
}

// Drain everything after `cursor` (count of already-folded lines). Returns the new
// injections and the advanced cursor; the driver persists the cursor in the plan.
export function drainInbox(cursor = 0, opts = {}) {
  const all = readInbox(opts);
  return { drained: all.slice(cursor), cursor: all.length };
}
