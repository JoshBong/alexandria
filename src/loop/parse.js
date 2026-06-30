// Shared model-output parsing for the live seams (planner, elaborator, reviewer,
// self-writer). LLMs wrap JSON in prose or ```fences; this digs the first JSON value
// out and parses it, returning null on anything unparseable so every caller can
// fail-soft to its deterministic default (never throw a live turn into the void).

// Extract + parse the first balanced JSON object or array in a blob of model text.
// Tolerates ```json fences, leading prose, and trailing chatter. Returns the parsed
// value, or null.
export function extractJson(text) {
  if (text == null) return null;
  const s = String(text);
  // Fast path: the whole thing is JSON.
  try {
    return JSON.parse(s.trim());
  } catch {
    /* fall through to scanning */
  }
  // Scan for the first { or [ and walk to its balanced close, ignoring braces inside
  // strings. First opener that yields a parseable slice wins.
  for (let i = 0; i < s.length; i += 1) {
    const open = s[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j += 1) {
      const c = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(i, j + 1));
          } catch {
            break; // this opener didn't yield valid JSON; try the next one
          }
        }
      }
    }
  }
  return null;
}
