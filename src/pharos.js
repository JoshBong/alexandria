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
  const turnPrompt = compose({ prompt, recalled, fresh: !reg.sessions[routed], switched: routed !== reg.current });

  const switched = routed !== reg.current;
  const turn = runTurn(routed, turnPrompt, { mock, reg });

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
    text: turn.text,
  };
}
