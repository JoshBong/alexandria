// The memory seam — Alexandria's pluggable storage interface.
//
// This is the senior signal of the whole project: the orchestrator does NOT ship a
// store, it ships a CONTRACT. A forker gets the zero-setup flat-file adapter; Josh
// points his at the ark (which already implements a real memory graph). Same three
// methods, swappable backend.
//
// A MemoryStore is any object implementing:
//   search(query, { limit?, keeper? }) -> Promise<Record[]>   // ranked, may be []
//   write({ text, keeper?, tags? })    -> Promise<{ id }>      // persist a durable fact
//   get(id)                            -> Promise<Record|null> // fetch one by id
//
// A Record is { id, text, score?, source, ...extra }. `source` names the adapter
// ('flatfile' | 'ark') so the caller can tell where a recall came from.
//
// "Keepers hit it only on a miss": a warm, confident thread already holds its own
// context — consulting memory then is wasted tokens. shouldRecall() encodes when a
// turn is a miss (cold session or low-confidence routing) and memory is worth a look.

import { createFolderStore } from './adapters/folder.js';
import { createArkStore } from './adapters/ark.js';

// Pick an adapter. Precedence: explicit instance > explicit kind > env > default.
//   createStore({ adapter })           -> use it as-is (tests inject a fake here)
//   createStore({ kind: 'ark' })       -> named adapter
//   ALEXANDRIA_MEMORY=ark              -> env override
//   (nothing)                          -> folder (open-ended, zero-setup default)
export function createStore(opts = {}) {
  if (opts.adapter) return opts.adapter;
  const kind = opts.kind || process.env.ALEXANDRIA_MEMORY || 'folder';
  if (kind === 'ark') return createArkStore(opts);
  return createFolderStore(opts);
}

// The miss-policy. Given a routing decision and the registry, decide whether this
// turn should consult memory before running. A "miss" is one of:
//   - cold session: the routed Keeper has no warm session yet (nothing to lean on),
//   - low-confidence routing: the classifier never cleared the floor (vocab-free /
//     sticky-below-floor / fell to intake) — the thread can't be trusted to know.
// A warm Keeper reached by a confident argmax/hysteresis decision is a HIT: skip.
export function shouldRecall(decision, reg = {}) {
  if (!decision) return false;
  const sessions = reg.sessions || {};
  const cold = !sessions[decision.routed];
  const lowConfidence =
    decision.reason === 'below-floor->intake' ||
    decision.reason === 'sticky-below-floor' ||
    decision.routed === 'anubis';
  return cold || lowConfidence;
}
