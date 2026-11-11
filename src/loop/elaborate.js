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

import { extractJson } from './parse.js';

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

// Live shape (P1). Ask for the seam as JSON, parse it, and always keep the verbatim
// `said` + a non-empty `steps` so the planner has something to weave even if the model
// returns junk (fail-soft to the one-step decomposition).
async function liveElaborate(input, ctx, ask) {
  const raw = typeof input === 'string' ? input : input.raw;
  const prompt =
    `Elaborate this injected request into intent, exposing the seam between what was said ` +
    `and what you're inferring.\n\nGoal: ${ctx.goal || '(unknown)'}\nInput: ${raw}\n\n` +
    `Return ONLY JSON: {"said":"<verbatim>","entailed":["<sourced consequence>"],` +
    `"assuming":["<inference you'd veto-check>"],"fork":"<irreversible choice or null>",` +
    `"steps":[{"intent":"<concrete step>"}]}. Unpack freely, extrapolate never; an entailed ` +
    `point must trace to evidence or it's an assumption; calibrate toward assuming.`;
  const out = await ask(prompt);
  const p = extractJson(out) || {};
  const steps = Array.isArray(p.steps) && p.steps.length
    ? p.steps.map((s) => (typeof s === 'string' ? { intent: s } : { intent: s.intent || raw }))
    : [{ intent: raw }];
  return {
    id: typeof input === 'object' ? input.id : null,
    said: p.said || raw,
    entailed: Array.isArray(p.entailed) ? p.entailed : [],
    assuming: Array.isArray(p.assuming) ? p.assuming : [],
    fork: p.fork || null,
    steps,
  };
}
