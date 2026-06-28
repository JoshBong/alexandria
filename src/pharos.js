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

const ACTIVE = new Set(KEEPERS.filter((k) => k.active).map((k) => k.id));
const aliasOf = (id) => (KEEPERS.find((k) => k.id === id) || {}).alias || id;

export function handle(prompt, opts = {}) {
  const { mock = false, persist = true } = opts;
  const reg = opts.reg || loadRegistry();

  const decision = classify(prompt, { currentKeeper: reg.current });
  let routed = decision.routed;
  let note = decision.reason;

  if (!ACTIVE.has(routed)) {
    note = `no '${routed}' Keeper yet → intake`;
    routed = 'anubis';
  }

  const switched = routed !== reg.current;
  const turn = runTurn(routed, prompt, { mock, reg });

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
    text: turn.text,
  };
}
