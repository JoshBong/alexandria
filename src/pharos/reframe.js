// The Keeper's optional LLM seams — both off by default, each costs +1 `claude` call
// per turn (run on the Keeper's own model — see pharos.js keeperAsk), both fail SOFT
// (any failure → return the original text, never break the turn).
//
//   reframe  (forward) — rewrite the user's terse prompt into one clean, self-
//            contained question, resolving shorthand using recalled memory, before the
//            Keeper answers. "States the question properly" first.
//   revoice  (return)  — re-deliver the Keeper's raw answer in one consistent
//            voice, preserving every fact/number exactly.
//
// Both take an injectable `run(system, user) -> string|null` so tests run with a
// mock and no subprocess. The default `askClaude` is a minimal, tool-less,
// headless `claude -p` call (boat-flagged so the ark hooks self-suppress).

import { spawnSync } from 'node:child_process';

function askClaude(system, user) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.ALEXANDRIA_BOAT = '1';
  const args = [
    '-p', '--tools', '', '--dangerously-skip-permissions',
    '--append-system-prompt', system, '--output-format', 'json', user,
  ];
  const res = spawnSync('claude', args, { env, encoding: 'utf8', maxBuffer: 1e8 });
  if (res.error || res.status !== 0) return null;
  try {
    const v = JSON.parse(res.stdout).result;
    return typeof v === 'string' ? v.trim() : null;
  } catch {
    return null;
  }
}

// Returns an async composer with the SAME shape as composeTurn (so it slots into
// the opts.compose seam): ({ prompt, recalled, alias }) -> string.
export function makeReframeComposer({ run = askClaude } = {}) {
  return async ({ prompt, recalled = [], alias = '' } = {}) => {
    const ctx = recalled.length
      ? 'Relevant memory (may help resolve shorthand — do not treat as fact):\n' +
        recalled.map((r) => `- ${(r.text || '').split('\n')[0].slice(0, 200)}`).join('\n') +
        '\n\n'
      : '';
    const system =
      `You are the ${alias || 'specialist'} Keeper of Alexandria. Rewrite the user's request ` +
      `into ONE clear, self-contained question you will then answer. Resolve pronouns and ` +
      `shorthand using the context if present, keep the user's intent and scope exactly, ` +
      `add no new facts or assumptions, and output ONLY the rewritten question.`;
    const out = await run(system, `${ctx}User request: ${prompt}`);
    return out && out.trim() ? out.trim() : prompt; // fail-soft: original prompt
  };
}

export async function revoiceAnswer({ answer, prompt } = {}, { run = askClaude } = {}) {
  if (!answer || !answer.trim()) return answer;
  const system =
    `You are a Keeper of Alexandria delivering your answer to the user in one consistent ` +
    `voice — concise, direct, helpful. Preserve every fact, number, and recommendation ` +
    `exactly; add nothing new; only smooth the voice. Output ONLY the answer.`;
  const out = await run(system, `User asked: ${prompt}\n\nSpecialist's answer:\n${answer}`);
  return out && out.trim() ? out.trim() : answer; // fail-soft: original answer
}
