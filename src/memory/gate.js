// The memory WRITE GATE — reject junk at the source (docs/memory-curation.md §3–4).
//
// Deliberately NARROWER than the skill screen (loop/selfwrite.js): a skill must be
// class-level and reusable, but a memory fact is ALLOWED to be specific — a path, an
// IP, a keeper-scoped note ("the user prefers X in ~/notes") are legitimate facts.
// So only the TRANSIENT subset ports: a claim that something is currently broken /
// failed / timed out is junk in any durable store, because it describes a moment,
// not a fact.
//
// Dedup reuses the loop's Jaccard (plateau.js) over BODY tokens (pharos/classify.js
// tokenize — the same tokenizer routing and folder-search use, so "what counts as a
// term" agrees across the system). Near-dup → skip the write, don't append.

import { jaccard } from '../loop/plateau.js';
import { tokenize } from '../pharos/classify.js';

const TRANSIENT_PATTERNS = [
  /\bis (?:broken|down|failing|stuck|hosed)\b/i,
  /\b(?:doesn'?t|don'?t|won'?t|can'?t|cannot) work\b/i,
  /\b(?:failed|failing|failure)\b/i,
  /\berror:/i,
  /\bpermission denied\b/i,
  /\b(?:not found|no such file|couldn'?t find|cannot find)\b/i,
  /\btimed out\b/i,
  /\b(?:on my machine|works for me)\b/i,
];

// The first transient pattern a fact trips, or null — logged so a skipped write is
// auditable, never silently lossy.
export function memoryPoisonReason(text = '') {
  const raw = String(text);
  for (const re of TRANSIENT_PATTERNS) if (re.test(raw)) return re.source;
  return null;
}

export const DEFAULT_DUP_THRESHOLD = 0.8;

// True when `text` is a near-duplicate of any existing body. Token-set Jaccard, so
// reworded-but-same facts collide while genuinely new facts (even on the same topic)
// pass — a topic overlap alone won't clear 0.8.
export function isDuplicate(text = '', existing = [], { threshold = DEFAULT_DUP_THRESHOLD } = {}) {
  const t = new Set(tokenize(String(text)));
  if (!t.size) return false;
  for (const prev of existing) {
    if (jaccard(t, new Set(tokenize(String(prev || '')))) >= threshold) return true;
  }
  return false;
}

// The whole gate in one call: { ok } | { ok: false, reason }. Adapters run this before
// persisting and return { skipped: true, reason } instead of writing.
export function gateWrite(text, existing = [], opts = {}) {
  const poison = memoryPoisonReason(text);
  if (poison) return { ok: false, reason: `transient: ${poison}` };
  if (isDuplicate(text, existing, opts)) return { ok: false, reason: 'near-duplicate' };
  return { ok: true };
}
