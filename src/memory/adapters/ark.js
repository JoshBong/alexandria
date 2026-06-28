// Ark memory adapter — Josh's private backend behind the public interface.
//
// The ark IS the memory graph: ~/.claude/hooks/ark/ already implements a real
// durable tier (BM25 index over every vault, communities=domains, consolidation).
// This adapter is thin by design — it does NOT reimplement a store, it forwards to
// the ark's read-only query entrypoint (query.cjs) and maps results into Records.
// That's the thesis: orchestrator owns the seam, the ark owns the store.
//
//   search → node query.cjs "<query>" <limit>   (read-only BM25 over all vaults)
//   get    → node query.cjs --get "<id>"        (id = a vault relPath)
//   write  → append to the ark's orchestrator inbox JSONL (non-destructive; the
//            ark's own consolidation decides if it earns a place in the graph)
//
// The subprocess runner is injectable so tests can mock the ark entirely — this
// adapter is verifiable offline without the ark present (a forker has no ark, and
// CI has no ~/.claude). Real use shells `node` against the live entrypoint.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const defaultArkDir = join(homedir(), '.claude', 'hooks', 'ark');

// Default runner: spawn `node <arkDir>/query.cjs <args>` and return parsed JSON.
// Returns null on any failure so the adapter degrades to "no recall" rather than
// throwing into a turn.
function defaultRun(arkDir, args) {
  const res = spawnSync('node', [join(arkDir, 'query.cjs'), ...args], {
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

export function createArkStore(opts = {}) {
  const arkDir = opts.arkDir || defaultArkDir;
  const run = opts.run || ((args) => defaultRun(arkDir, args));
  const inbox = opts.inbox || join(arkDir, 'data', 'orchestrator-inbox.jsonl');

  return {
    source: 'ark',

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
        source: 'ark',
      }));
    },

    async get(id) {
      if (!id) return null;
      const r = run(['--get', id]);
      if (!r || typeof r !== 'object') return null;
      return { id: r.id, text: r.summary || r.title || r.id, title: r.title, vault: r.vault, path: r.path, source: 'ark' };
    },

    // Non-destructive: append to the ark's inbox. We never write the index directly
    // — the ark's consolidation pipeline owns promotion into the graph.
    async write({ text, keeper = null, tags = [] } = {}) {
      if (!text || !text.trim()) throw new Error('write requires non-empty text');
      const id = `ark-inbox-${Date.now().toString(36)}`;
      const record = { id, text: text.trim(), keeper, tags, ts: new Date().toISOString(), via: 'alexandria' };
      mkdirSync(dirname(inbox), { recursive: true });
      appendFileSync(inbox, JSON.stringify(record) + '\n');
      return { id };
    },
  };
}
