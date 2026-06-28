// Pharos — the head. Stateless per prompt: classify → route → relay.
//
// Routes the prompt to a Keeper (with stickiness/hysteresis from the current
// Keeper in the registry), runs the turn against that Keeper's warm session, and
// updates the registry. Inactive Keepers (no live session yet, e.g. Thoth/Horus
// in Phase 1) fall back to intake (Anubis) with a note.

import { classify } from './pharos/classify.js';
import { KEEPERS } from './pharos/keepers.js';
import { loadRegistry, saveRegistry } from './pharos/registry.js';
import { runTurn } from './keeper.js';
import { createStore, shouldRecall } from './memory/store.js';
import { composeTurn } from './pharos/compose.js';
import { hasCanary, stripCanary } from './pharos/canary.js';
import { trackRecent, writeHandoff, buildReseed } from './pharos/handoff.js';
import { isTokenLow } from './pharos/tokens.js';

const ACTIVE = new Set(KEEPERS.filter((k) => k.active).map((k) => k.id));
const aliasOf = (id) => (KEEPERS.find((k) => k.id === id) || {}).alias || id;

export async function handle(prompt, opts = {}) {
  const { mock = false, persist = true } = opts;
  const reg = opts.reg || loadRegistry();

  const decision = classify(prompt, { currentKeeper: reg.current });
  let routed = decision.routed;
  let note = decision.reason;

  if (!ACTIVE.has(routed)) {
    note = `no '${routed}' Keeper yet → intake`;
    routed = 'anubis';
  }

  // Keepers hit memory only on a miss (cold session / low-confidence routing). The
  // decision used the routed Keeper from classify; recompute the miss against the
  // FINAL routed Keeper (intake fallback above can change it). On a hit we skip the
  // store entirely — a warm, confident thread already holds its context.
  let recalled = [];
  const miss = shouldRecall({ ...decision, routed }, reg);
  if (miss) {
    const store = opts.store || createStore(opts);
    try {
      recalled = await store.search(prompt, { limit: 3, keeper: routed });
    } catch {
      recalled = []; // memory is best-effort; never break a turn on a recall failure
    }
  }

  // The secretary writes the turn (it doesn't just hand off the raw prompt): the
  // composer frames the request and attaches recalled context. Injectable via
  // opts.compose so an LLM-backed writer can replace the default local one. With no
  // recall, composeTurn returns the prompt unchanged (mock/warm-hit paths untouched).
  const compose = opts.compose || composeTurn;
  const fresh = !reg.sessions[routed];
  let turnPrompt = compose({ prompt, recalled, fresh, switched: routed !== reg.current });

  // If this Keeper was proactively flushed last turn for capacity (the EARLY
  // token-low gate below), its fresh session needs continuity. Prepend the reseed
  // and clear the pending flag. (The canary path reseeds inline on its own redo;
  // this handles the early path, where the flush happened on a PRIOR good turn.)
  reg.reseedPending = reg.reseedPending || {};
  if (fresh && reg.reseedPending[routed]) {
    const reseed = buildReseed(routed, aliasOf(routed), reg);
    if (reseed) turnPrompt = `${reseed}\n\n${turnPrompt}`;
    delete reg.reseedPending[routed];
  }

  // Track this prompt against the Keeper's recent-list — the reseed source if the
  // thread later degrades. Pointers, not warm context (stateless-secretary rule).
  trackRecent(reg, routed, prompt);

  const switched = routed !== reg.current;
  const run = opts.runTurn || runTurn;
  let turn = run(routed, turnPrompt, { mock, reg });

  // The canary gate. Late-but-better-than-nothing (Josh): if the Keeper's answer
  // lost its marker, the warm thread is degraded — write a handoff, flush the
  // session, and REDO once on a fresh session reseeded with continuity. Skipped on
  // the mock path (no real model to judge). Max 1 redo, then relay with a ⚠ flag.
  let degraded = false;
  let redone = false;
  if (!mock && !hasCanary(turn.text)) {
    writeHandoff(routed, reg, opts.handoff);
    delete reg.sessions[routed]; // flush the degraded warm session
    const reseed = buildReseed(routed, aliasOf(routed), reg);
    const redoPrompt = reseed ? `${reseed}\n\n${turnPrompt}` : turnPrompt;
    turn = run(routed, redoPrompt, { mock, reg }); // fresh session
    redone = true;
    degraded = !hasCanary(turn.text); // still no canary → honestly flag it
  }

  // The EARLY (token-low) gate. The answer this turn was fine, but the Keeper's
  // context load has crossed the limit — flush it now so the NEXT turn opens on a
  // fresh, reseeded session, before the slow slide reaches the canary cliff. We do
  // NOT redo this turn (capacity warning, not quality failure). Skipped when the
  // canary path already flushed+redid (session is fresh again) and on mock turns
  // (no usage → contextTokens 0 → never fires).
  let compacting = false;
  if (!redone && isTokenLow(turn.contextTokens || 0)) {
    writeHandoff(routed, reg, opts.handoff);
    delete reg.sessions[routed]; // flush the heavy warm session
    reg.reseedPending[routed] = true; // next turn to this Keeper reseeds
    compacting = true;
  }

  reg.current = routed;
  if (persist) saveRegistry(reg);

  return {
    routed,
    alias: aliasOf(routed),
    switched,
    fresh: turn.fresh,
    reason: decision.reason,
    note,
    scores: decision.scores,
    recalled,
    redone,
    degraded,
    compacting,
    contextTokens: turn.contextTokens || 0,
    text: stripCanary(turn.text),
  };
}
