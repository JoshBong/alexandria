// Pharos — the classifier. Local, dependency-free, API-free.
//
// Given a prompt (and optionally the Keeper you're currently in), decide which
// Keeper it belongs to. Returns the routed Keeper, a confidence score, the margin
// over the runner-up, and a reason — so the caller can see *why* it routed.
//
// Two guards beyond plain argmax:
//   - FLOOR:        nothing scores high enough → intake (Anubis).
//   - SWITCH_MARGIN: a new candidate must clearly beat the current Keeper to
//                    switch, else we stay put (sticky hysteresis, no thrash).

import { KEEPERS, FLOOR, SWITCH_MARGIN } from './keepers.js';

const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'my', 'me',
  'i', 'is', 'it', 'this', 'that', 'with', 'do', 'did', 'should', 'what',
  'whats', 'how', 'why', 'help', 'can', 'you', 'your', 'about', 'if', 'im',
  'ill', 'as', 'at', 'be', 'by', 'just', 'not', 'out', 'up', 'so', 'before',
  'some', 'get', 'got', 'are', 'was', 'will', 'would', 'need', 'want', 'into',
]);

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function scorePrompt(prompt) {
  const lower = prompt.toLowerCase();
  const tokenSet = new Set(tokenize(prompt));
  const scores = {};
  for (const k of KEEPERS) {
    let s = 0;
    for (const [term, w] of Object.entries(k.terms)) {
      if (term.includes(' ')) {
        if (lower.includes(term)) s += w + 1; // phrase match, small bonus
      } else if (tokenSet.has(term)) {
        s += w;
      }
    }
    scores[k.id] = s;
  }
  return scores;
}

export function classify(prompt, opts = {}) {
  const {
    currentKeeper = null,
    floor = FLOOR,
    switchMargin = SWITCH_MARGIN,
  } = opts;

  const scores = scorePrompt(prompt);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = ranked[0];
  const secondScore = ranked[1] ? ranked[1][1] : 0;
  const margin = topScore - secondScore;

  let routed = topId;
  let reason = 'argmax';

  if (topScore < floor) {
    // Stickiness outranks the floor: a terse/vocab-free prompt mid-conversation
    // ("ship it", "does it pass now") belongs to the Keeper you're already in.
    // Only a cold start (no current Keeper) falls through to intake.
    if (currentKeeper) {
      routed = currentKeeper;
      reason = 'sticky-below-floor';
    } else {
      routed = 'anubis';
      reason = 'below-floor->intake';
    }
  } else if (currentKeeper && routed !== currentKeeper) {
    const curScore = scores[currentKeeper] ?? 0;
    if (topScore - curScore < switchMargin) {
      routed = currentKeeper;
      reason = 'sticky-hysteresis';
    }
  }

  const keeper = KEEPERS.find((k) => k.id === routed) || {};
  return { routed, alias: keeper.alias || routed, top: topId, topScore, margin, reason, scores };
}

// How decisively the keyword winner must lead the runner-up before a LIVE turn TRUSTS
// the local route and skips the LLM router. Terms are weighted 1/2/3, so a margin of 3
// is a full strong-term lead — wide enough that a model read wouldn't plausibly disagree.
export const CONFIDENT_MARGIN = 3;

// Is the local (keyword) decision confident enough to skip the LLM router (a cold
// `claude -p` haiku spawn, ~5s)? Two safe cases:
//   - sticky-below-floor: a terse follow-up with NO domain signal at all, kept in the
//     current Keeper. The model — told it's a short follow-up — would keep it there too.
//   - a clear keyword winner (argmax) leading the runner-up by CONFIDENT_MARGIN.
// Everything else — thin-margin argmax, hysteresis near-ties, cold-start intake with no
// vocab — is genuinely ambiguous and escalates to the model, which reads intent where
// keywords are weak. This is the gate that keeps the common case ("hi", "ship it", a
// vocab-rich request) off the spawn while preserving the LLM exactly where it earns it.
export function localConfident(decision) {
  if (!decision) return false;
  if (decision.reason === 'sticky-below-floor') return true;
  if (decision.reason === 'argmax' && (decision.margin ?? 0) >= CONFIDENT_MARGIN) return true;
  return false;
}

// LLM routing — Pharos READS the message and picks a domain, the way a person
// (or any model) trivially would. This is the real classifier in live mode; the keyword
// scorer above is the offline/mock path AND the safety net if the model call fails.
// `run(prompt)` is an injected one-shot LLM call (handle passes askOnce); tests inject a
// fake. Returns the same shape as classify() so handle()/shouldRecall() are unchanged.
export function makeLLMClassifier({ run, keepers = KEEPERS, fallback = classify } = {}) {
  const active = keepers.filter((k) => k.active);
  const menu = active.map((k) => `- ${k.id}: ${k.alias}${k.note ? ` — ${k.note}` : ''}`).join('\n');
  const ids = active.map((k) => k.id);
  const idRe = new RegExp(`\\b(${ids.join('|')})\\b`);
  return async function classifyLLM(prompt, opts = {}) {
    const cur = opts.currentKeeper;
    const instr =
      `Route the user's message to exactly ONE domain Keeper:\n${menu}\n\n` +
      (cur
        ? `The user is currently talking to "${cur}". If the message is a short follow-up that continues that same domain, keep it there; otherwise route by topic.\n`
        : '') +
      `Reply with ONLY the Keeper id (one lowercase word), nothing else.\n\nMessage: ${prompt}`;
    let raw = '';
    try {
      raw = await run(instr, opts);
    } catch {
      raw = '';
    }
    const m = String(raw).toLowerCase().match(idRe);
    if (m) {
      const k = active.find((x) => x.id === m[1]) || {};
      return { routed: m[1], alias: k.alias || m[1], top: m[1], topScore: null, margin: null, reason: 'llm', scores: {} };
    }
    return fallback(prompt, opts); // unreachable / unparseable model reply → keyword safety net
  };
}
