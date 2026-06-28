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
