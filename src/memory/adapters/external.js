// External memory adapter — delegate to a memory backend you already run.
//
// For an operator whose notes already live in an indexed store with its own search
// and consolidation. The adapter does NOT reimplement a store: it forwards to that
// backend's read-only query script and maps results into Records. Alexandria owns
// the seam; the backend owns the store.
//
// The backend is a directory (opts.dir, or ALEXANDRIA_EXTERNAL_DIR) holding:
//   search → node <dir>/query.cjs "<query>" <limit>   (read-only, JSON rows out)
//   get    → node <dir>/query.cjs --get "<id>"        (one JSON row out)
//   write  → append to <dir>/data/orchestrator-inbox.jsonl (non-destructive; the
//            backend's own consolidation decides what earns a place)
// Not configured → search/get return nothing and writes are skipped, so a turn never
// breaks on it.
//
// The subprocess runner is injectable so tests mock the backend entirely.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gateWrite } from '../gate.js';

// Dedup window for the write gate: the text of the last N inbox records.
const DEDUP_WINDOW = 20;
function inboxTail(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return raw.trim().split('\n').slice(-DEDUP_WINDOW).map((l) => {
    try { return JSON.parse(l).text || ''; } catch { return ''; }
  });
}

// Default runner: spawn `node <dir>/query.cjs <args>` and return parsed JSON.
// Returns null on any failure so the adapter degrades to "no recall" rather than
// throwing into a turn.
function defaultRun(dir, args) {
  if (!dir) return null; // not configured
  const res = spawnSync('node', [join(dir, 'query.cjs'), ...args], {
    encoding: 'utf8',
    maxBuffer: 1e8,
    timeout: 10000,
  });
  if (res.error || res.status !== 0) return null;
  try {
    return JSON.parse((res.stdout || '').trim());
  } catch {
    return null;
  }
}

export function createExternalStore(opts = {}) {
  const dir = opts.dir || process.env.ALEXANDRIA_EXTERNAL_DIR || '';
  const run = opts.run || ((args) => defaultRun(dir, args));
  const inbox = opts.inbox || (dir ? join(dir, 'data', 'orchestrator-inbox.jsonl') : '');

  return {
    source: 'external',

    async search(query, { limit = 5 } = {}) {
      if (!query || !query.trim()) return [];
      const rows = run([query, String(limit)]);
      if (!Array.isArray(rows)) return [];
      return rows.map((r) => ({
        id: r.id,
        text: r.summary || r.title || r.id,
        title: r.title,
        vault: r.vault,
        path: r.path,
        score: r.score,
        source: 'external',
      }));
    },

    async get(id) {
      if (!id) return null;
      const r = run(['--get', id]);
      if (!r || typeof r !== 'object') return null;
      return { id: r.id, text: r.summary || r.title || r.id, title: r.title, vault: r.vault, path: r.path, source: 'external' };
    },

    // Non-destructive: append to the backend's inbox. We never write its index
    // directly — its consolidation pipeline owns promotion.
    // GATED + STAMPED like the folder adapter: transient/near-dup facts are skipped
    // with the reason (dedup window = the inbox tail), and writtenBy provenance rides
    // the record so the backend can trust-filter.
    async write({ text, keeper = null, tags = [], writtenBy = null } = {}) {
      if (!text || !text.trim()) throw new Error('write requires non-empty text');
      if (!inbox) return { skipped: true, reason: 'no external memory dir configured' };
      const verdict = gateWrite(text, inboxTail(inbox));
      if (!verdict.ok) return { skipped: true, reason: verdict.reason };
      const id = `inbox-${Date.now().toString(36)}`;
      const record = { id, text: text.trim(), keeper, tags, ts: new Date().toISOString(), via: 'alexandria', written_by: writtenBy };
      mkdirSync(dirname(inbox), { recursive: true });
      appendFileSync(inbox, JSON.stringify(record) + '\n');
      return { id };
    },
  };
}
