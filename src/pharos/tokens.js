// The EARLY compaction trigger — token-low detection from a Keeper's own usage.
//
// The canary (canary.js) is the LATE backstop: it only fires once instruction-
// following has already dropped, i.e. at the cliff. The design always wanted an
// EARLY trigger that catches the slow slide before quality goes — "compact early."
//
// The inherited plan reached for a Claude Code PreCompact hook. But Alexandria's
// Keepers are headless `claude -p` subprocesses that keeper.js fully drives, and
// `claude -p --output-format json` already reports per-turn `usage`. So Alexandria
// is its own supervisor: it can read the context load straight off each turn and
// flush+reseed PROACTIVELY before the next turn — earlier than a PreCompact hook
// (which fires at the ~95% auto-compact cliff), and with no dependency on the
// user's hook config (a forker has no ~/.claude hooks). The hook was a worse,
// later, less-forkable version of what the loop can already do directly.
//
// Behaviour difference from the canary gate: a token-low turn was still GOOD (the
// answer relays as-is). We flush AFTER it so the NEXT turn to that Keeper opens on
// a fresh session reseeded for continuity. Capacity warning, not quality failure.

// Default ceiling on a Keeper's context load before we proactively flush. Set
// below typical auto-compact (~95% of the window) so we act EARLY, and overridable
// for different window sizes / appetites. 0 or a non-positive value disables the
// early gate entirely (canary-only).
const DEFAULT_LIMIT = 150_000;

export function tokenLimit(env = process.env) {
  const raw = Number(env.ALEXANDRIA_TOKEN_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LIMIT;
}

// Total context load carried into a turn = everything on the input side. With
// --resume, the bulk of the replayed thread shows up as cache reads, so all three
// input buckets count. Missing fields default to 0 (older CLI / mock → load 0 →
// gate never fires, which is the safe direction).
export function contextTokensOf(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return (
    n(usage.input_tokens) +
    n(usage.cache_read_input_tokens) +
    n(usage.cache_creation_input_tokens)
  );
}

// EARLY trigger: is this turn's context load at/over the limit? A disabled limit
// (<= 0) never fires.
export function isTokenLow(contextTokens, limit = tokenLimit()) {
  return limit > 0 && contextTokens >= limit;
}
