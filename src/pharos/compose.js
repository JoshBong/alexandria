// Pharos's prompt-writer — Pharos composes the turn it sends to a Keeper
// instead of relaying the raw user prompt.
//
// "Pharos routes AND writes." Routing alone passes the user's words straight
// through; composing lets stateless Pharos add value on every turn: attach
// relevant memory as labelled context, and frame the request — without ever
// distorting what the user actually said (their words go through verbatim, wrapped,
// never rewritten by the local composer).
//
// This is a SEAM. The default below is local, deterministic, and free. A future
// LLM-backed composer (rewrite/expand/clarify) can replace it via opts.compose in
// pharos.js — the rest of the head doesn't change. Kept terse so the standing
// persona prefix still caches well.

// The Keeper-facing memory block: recalled records as labelled bullets, ended with a
// blank line so it prepends cleanly to a request. Returns '' when there's no recall.
// Shared so BOTH the local composer (composeTurn) AND the reframe composer attach the
// SAME context — recall must reach the Keeper regardless of whether reframe is on.
export function memoryContext(recalled = []) {
  if (!recalled || !recalled.length) return '';
  const bullets = recalled.map((r) => {
    const head = (r.text || '').split('\n')[0].slice(0, 200);
    const where = r.id ? ` (${r.id})` : '';
    return `- ${head}${where}`;
  });
  return [
    'Context that may be relevant, pulled from memory — verify before relying on it:',
    ...bullets,
  ].join('\n') + '\n\n';
}

// Build the final turn text from the user's prompt + recalled memory + turn flags.
// recalled: Record[] (may be []). Returns a string; with no recall it's the prompt
// unchanged (so the mock path and warm-hit path are untouched).
export function composeTurn({ prompt, recalled = [] } = {}) {
  const ctx = memoryContext(recalled);
  return ctx ? `${ctx}Request: ${prompt}` : prompt;
}
