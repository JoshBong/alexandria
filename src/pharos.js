// Pharos — the head. Stateless per prompt: classify → route → relay.
//
// Routes the prompt to a Keeper (with stickiness/hysteresis from the current
// Keeper in the registry), runs the turn against that Keeper's warm session, and
// updates the registry. Inactive Keepers (no live session yet, e.g. Thoth/Horus
// in Phase 1) fall back to intake (Anubis) with a note.

import { classify, makeLLMClassifier } from './pharos/classify.js';
import { KEEPERS } from './pharos/keepers.js';
import { loadRegistry, saveRegistry } from './pharos/registry.js';
import { runTurn } from './keeper.js';
import { createStore, shouldRecall } from './memory/store.js';
import { composeTurn } from './pharos/compose.js';
import { hasCanary, stripCanary } from './pharos/canary.js';
import { trackRecent, writeHandoff, buildReseed } from './pharos/handoff.js';
import { isTokenLow } from './pharos/tokens.js';
import { logEvent, eventsEnabled } from './pharos/events.js';
import { getSettings } from './pharos/settings.js';
import { makeReframeComposer, revoiceAnswer } from './pharos/reframe.js';

const ACTIVE = new Set(KEEPERS.filter((k) => k.active).map((k) => k.id));
const aliasOf = (id) => (KEEPERS.find((k) => k.id === id) || {}).alias || id;
const modelOf = (id) => (KEEPERS.find((k) => k.id === id) || {}).model;

export async function handle(prompt, opts = {}) {
  const { mock = false, persist = true } = opts;
  // opts.registryPath isolates the head's pointer file (tests, or running more than
  // one Alexandria instance) — defaults to the real .pharos/registry.json.
  const reg = opts.reg || loadRegistry(opts.registryPath);
  const cfg = opts.settings || getSettings();
  // An LLM seam fires only when its setting is on AND we're live (or a runner is
  // injected) — so mock tests never spawn a real `claude` even if a flag leaked on.
  const wantLLM = (flag) => flag && (!mock || !!opts.ask);

  // Routing is LLM-first: when an `ask` runner is available (live — the entrypoint
  // injects askOnce), Pharos READS the message and picks the domain. Without a
  // runner (mock / offline tests) it falls back to the keyword scorer — which also stays
  // the safety net inside makeLLMClassifier if the model call fails. opts.classify still
  // overrides everything (tests of the routing/fallback seam).
  const classifyFn = opts.classify || (opts.ask ? makeLLMClassifier({ run: opts.ask }) : classify);
  const decision = await classifyFn(prompt, { currentKeeper: reg.current });
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

  // reframe/revoice are the KEEPER's own passes, not Pharos's cheap router — so they run
  // on the routed Keeper's model and match whoever is answering. opts.ask is the same
  // one-shot runner; we bind it to this Keeper's model (its override, else the global
  // model setting, else the CLI default). Routing itself stays on the cheap model.
  const keeperModel = modelOf(routed) || cfg.model || undefined;
  // reframe/revoice call their runner as run(system, user) — two positional strings. Bridge
  // that to opts.ask's (prompt, { model, system }) shape: the USER message is the prompt,
  // the persona/instruction is the system. (Getting this backwards silently dropped the
  // user's message and sent the system prompt as the question — the "no question attached" bug.)
  const keeperAsk = opts.ask ? (system, user) => opts.ask(user, { model: keeperModel, system }) : opts.ask;

  // The turn gets composed (it isn't just the raw prompt): the composer frames the request
  // and attaches recalled context. Injectable via opts.compose so an LLM-backed writer can
  // replace the default local one. With no recall, composeTurn returns the prompt unchanged
  // (mock/warm-hit paths untouched). reframe ON → the Keeper rewrites the prompt into a
  // clean question first (forward path). OFF → the free local composer frames + attaches recall.
  const compose = opts.compose || (wantLLM(cfg.reframe) ? makeReframeComposer({ run: keeperAsk }) : composeTurn);
  const fresh = !reg.sessions[routed];
  let turnPrompt = await compose({ prompt, recalled, fresh, switched: routed !== reg.current, alias: aliasOf(routed) });

  // If this Keeper was proactively flushed last turn for capacity (the EARLY
  // token-low gate below), its fresh session needs continuity. Prepend the reseed
  // and clear the pending flag. (The canary path reseeds inline on its own redo;
  // this handles the early path, where the flush happened on a PRIOR good turn.)
  reg.reseedPending = reg.reseedPending || {};
  let reseeded = false; // did this turn prepend a continuity reseed?
  if (fresh && reg.reseedPending[routed]) {
    const reseed = buildReseed(routed, aliasOf(routed), reg);
    if (reseed) {
      turnPrompt = `${reseed}\n\n${turnPrompt}`;
      reseeded = true;
    }
    delete reg.reseedPending[routed];
  }

  // Track this prompt against the Keeper's recent-list — the reseed source if the
  // thread later degrades. Pointers, not warm context (stateless-head rule).
  trackRecent(reg, routed, prompt);

  const switched = routed !== reg.current;
  const run = opts.runTurn || runTurn;
  let turn = await run(routed, turnPrompt, { mock, reg, settings: cfg });

  // The canary gate. Late-but-better-than-nothing (Josh): if a warm thread that's
  // ALREADY heavy lost its marker, it's degraded — write a handoff, flush the session,
  // and REDO once on a fresh session reseeded with continuity. Gated on isTokenLow so a
  // healthy-sized thread that just didn't echo the marker on a short reply (e.g. "Hi!")
  // is NOT treated as degraded — that false positive was re-running every turn (2× the
  // latency) and discarding prewarmed sessions. Degradation only matters near the limit,
  // which is exactly where the early gate also acts. Skipped on the mock path.
  let degraded = false;
  let redone = false;
  if (!mock && isTokenLow(turn.contextTokens || 0) && !hasCanary(turn.text)) {
    writeHandoff(routed, reg, opts.handoff);
    delete reg.sessions[routed]; // flush the degraded warm session
    const reseed = buildReseed(routed, aliasOf(routed), reg);
    const redoPrompt = reseed ? `${reseed}\n\n${turnPrompt}` : turnPrompt;
    if (reseed) reseeded = true;
    turn = await run(routed, redoPrompt, { mock, reg, settings: cfg }); // fresh session
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

  // revoice ON → the Keeper re-delivers its own answer in one consistent voice (return
  // path, on its own model). OFF → relay the Keeper's answer straight through.
  let finalText = stripCanary(turn.text);
  if (wantLLM(cfg.revoice)) finalText = await revoiceAnswer({ answer: finalText, prompt }, { run: keeperAsk });

  reg.current = routed;
  if (persist) saveRegistry(reg, opts.registryPath);

  // The run log — one durable event per turn (token load, session lifecycle, which
  // gates fired). Tied to `persist` so tests/sims (persist:false) stay silent;
  // best-effort so a logging failure never affects the turn. See pharos/events.js.
  if (persist && eventsEnabled()) {
    const u = turn.usage || {};
    logEvent(
      {
        prompt,
        routed,
        alias: aliasOf(routed),
        reason: decision.reason,
        switched,
        freshSession: !!turn.fresh, // a new claude session was started this turn
        sessionId: turn.sessionId || null,
        mock,
        contextTokens: turn.contextTokens || 0,
        usage: {
          input: u.input_tokens ?? null,
          cacheRead: u.cache_read_input_tokens ?? null,
          cacheCreation: u.cache_creation_input_tokens ?? null,
          output: u.output_tokens ?? null,
        },
        recalled: recalled.length,
        redone, // canary (LATE) gate fired a redo
        degraded, // still no canary after the redo
        compacting, // token (EARLY) gate flushed for next turn
        reseeded, // this turn was reseeded for continuity
      },
      opts.events,
    );
  }

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
    contextTokens: turn.contextTokens || 0, // TOTAL resident context carried into the turn
    // Per-turn token usage — the MARGINAL cost of THIS question (new input + the answer),
    // distinct from contextTokens (the whole replayed thread). The UI shows this, not the
    // total, so "hi" reads as ~17 tokens, not the 20k+ of resident context.
    usage: turn.usage || null,
    turnTokens: (turn.usage?.input_tokens || 0) + (turn.usage?.output_tokens || 0),
    touched: turn.touched || [], // files this turn edited → loop plateau (g1) + scope/risk drift (g2)
    text: finalText,
  };
}
