// The run log — a durable, append-only event stream, one JSON line per turn.
//
// The REPL's one-line bracket tells you what the router just did, then scrolls
// away. For bug-testing the live path (is a Keeper actually accumulating tokens?
// when does a new session start? did the gate fire?) and for watching how the
// system behaves over time, we also append a structured event per turn to
// `.pharos/events.jsonl` (gitignored). Grep/jq it, or run `npm run events`.
//
// Best-effort by design: instrumentation must NEVER break a turn, so every write
// is wrapped and a failure is swallowed. Disable with ALEXANDRIA_EVENTS=0.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../');
const defaultFile = join(repoRoot, '.pharos', 'events.jsonl');

const fileFor = (opts = {}) =>
  opts.file || (opts.dir ? join(opts.dir, 'events.jsonl') : defaultFile);

// Off only when explicitly disabled — on by default (the whole point is passive
// visibility you don't have to remember to turn on).
export function eventsEnabled(env = process.env) {
  const v = String(env.ALEXANDRIA_EVENTS ?? '').toLowerCase();
  return v !== '0' && v !== 'off' && v !== 'false';
}

// Append one event as a JSON line. Stamps `ts` if absent. Returns the file path,
// or null if disabled / the write failed (never throws).
export function logEvent(event, opts = {}) {
  if (opts.enabled === false) return null;
  const file = fileFor(opts);
  const row = { ts: opts.now || new Date().toISOString(), ...event };
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(row) + '\n');
    return file;
  } catch {
    return null;
  }
}

// Read the stream back as parsed objects (bad lines skipped). [] if absent.
export function readEvents(opts = {}) {
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
