// The input elaborator — the "full potential" piece (docs/auto-loop.md §5).
//
// Raw input never hits the planner. It's elaborated into intent first, and the
// output EXPOSES THE SEAM between what you said and what it's guessing — so you set
// the elaboration depth at a glance instead of the model guessing a sweet spot:
//
//   You said:  <verbatim>
//   Entailed:  <derived, confident — each point cites a source: file / goal / decision>
//   Assuming:  <inferred, you didn't say it — vetoable in one glance>
//   Fork:      <irreversible choice that can't be derived — the only thing worth asking>
//
// Rules: unpack freely, extrapolate never; an Entailed point must trace to evidence or
// it demotes to Assuming; calibrate TOWARD Assuming (under-confidence is free, you
// glance + approve; over-confidence is silent drift); depth ∝ reversibility. An
// elaborated input may decompose into several steps — the planner weaves them all in.
//
// Live elaboration (opts.ask) is P1. P0 ships a deterministic local elaborator so the
// control flow is provable offline: it brackets the raw text as `said`, derives one
// step, and leaves entailed/assuming/fork empty (nothing to infer without an LLM).

// Make an elaborator bound to an LLM runner. Mock-first: with no `ask`, returns the
// deterministic local elaborator (no claude spawn) — same discipline as the rest.
export function makeElaborator({ ask } = {}) {
  if (!ask) return localElaborate;
  return async (input, ctx = {}) => liveElaborate(input, ctx, ask);
}

// Deterministic, offline. One input → one step carrying the verbatim intent.
export function localElaborate(input, _ctx = {}) {
  const raw = typeof input === 'string' ? input : input.raw;
  return {
    id: typeof input === 'object' ? input.id : null,
    said: raw,
    entailed: [], // sourced consequences — only an LLM derives these
    assuming: [], // inferences — calibrate here when unsure
    fork: null, // irreversible choice worth confirming
    steps: [{ intent: raw }], // may be many once live; one offline
  };
}

// Live shape (wired in P1). Kept here so the contract is visible; not exercised in P0.
async function liveElaborate(input, ctx, ask) {
  const raw = typeof input === 'string' ? input : input.raw;
  const prompt =
    `Elaborate this injected request into intent. Expose the seam: what was SAID ` +
    `(verbatim), what is ENTAILED (each point must cite a source — file, goal, or prior ` +
    `decision; if it can't be sourced, demote it to ASSUMING), what you are ASSUMING ` +
    `(calibrate toward this when unsure), and any FORK (an irreversible choice that ` +
    `can't be derived — the only thing worth asking about). Then decompose into one or ` +
    `more concrete steps. Unpack freely, extrapolate never. Depth is proportional to ` +
    `reversibility.\n\nGoal: ${ctx.goal || '(unknown)'}\nInput: ${raw}`;
  const out = await ask(prompt);
  // The live parser/contract is a P1 concern; for now pass the raw model text through
  // alongside the verbatim said so nothing is silently dropped.
  return { id: typeof input === 'object' ? input.id : null, said: raw, raw: out, steps: [{ intent: raw }] };
}
