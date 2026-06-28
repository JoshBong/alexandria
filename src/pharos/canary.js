// The canary — Alexandria's OWN freshness marker (no ark dependency, forkable).
//
// Each Keeper is instructed (via its persona) to end every reply with this marker.
// The stateless secretary then free-string-checks for it on the way back: present =
// the Keeper's context is still coherent; missing = instruction-following has
// dropped, which is the late-but-reliable signal that the warm thread is degraded
// and should be flushed + reseeded (see pharos.js handle()).
//
// Honest caveat (kept from the design): the canary is a LATE signal by nature —
// instruction-following fails near the cliff, not at the slow slide. It's the
// backstop; token-low is the intended EARLY trigger. We strip the marker before
// relaying so Josh never sees the plumbing.

export const CANARY = '⟡';

// Appended to every Keeper persona at session creation, so it persists across
// --resume turns (the system prompt is set once). Constant → stays cache-stable.
export const CANARY_INSTRUCTION =
  `\n\nAlways end every reply with this marker on its own final line: ${CANARY}`;

export function hasCanary(text) {
  return typeof text === 'string' && text.includes(CANARY);
}

// Remove the marker (and any now-empty trailing line) before relaying to the user.
export function stripCanary(text) {
  if (typeof text !== 'string') return text;
  return text.split(CANARY).join('').replace(/\s+$/g, '');
}
