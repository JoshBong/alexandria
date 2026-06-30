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
import { memoryContext } from './compose.js';

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

// Reframing is for TASKS — it gives the Keeper cleaner instructions. A terse line
// (greeting, casual remark, gibberish) is not a task: reframing it wastes a call and
// risks distorting what the user actually said. Gate on a word floor so those skip
// the runner entirely.
const TASK_FLOOR = 4; // words; below this, pass the message straight through

// Returns an async composer with the SAME shape as composeTurn (so it slots into
// the opts.compose seam): ({ prompt, recalled, alias }) -> string. KEY RULE: it
// AUGMENTS, never replaces — the Keeper always receives (and answers) the user's
// original words; a reframe is attached as guidance, never substituted for them.
export function makeReframeComposer({ run = askClaude } = {}) {
  return async ({ prompt, recalled = [], alias = '' } = {}) => {
    // The Keeper-facing memory block — the SAME context composeTurn attaches. Recall must
    // reach the Keeper whether or not reframe runs; previously reframe fed memory only to the
    // reframe model and dropped it from the turn, so turning reframe on silently lost recall.
    const keeperCtx = memoryContext(recalled);
    const withCtx = (body) => (keeperCtx ? `${keeperCtx}${body}` : body);

    const words = String(prompt || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < TASK_FLOOR) return withCtx(prompt); // not a task → no reframe call, but recall still reaches the Keeper

    const ctx = recalled.length
      ? 'Relevant memory (may help resolve shorthand — do not treat as fact):\n' +
        recalled.map((r) => `- ${(r.text || '').split('\n')[0].slice(0, 200)}`).join('\n') +
        '\n\n'
      : '';
    const system =
      `You are the ${alias || 'specialist'} Keeper of Alexandria. If the user's message is a ` +
      `task or request, restate it as ONE clear, self-contained instruction — resolve pronouns ` +
      `and shorthand using the context if present, keep their intent and scope exactly, add no ` +
      `new facts or assumptions. If it is NOT a task (a greeting, casual remark, or gibberish), ` +
      `reply with exactly: SKIP. Output only the restated task, or SKIP.`;
    const out = (await run(system, `${ctx}User message: ${prompt}`) || '').trim();
    // Fail-soft + gate: empty, an explicit SKIP, or an echo of the prompt → send the user's
    // words untouched (still with recall). Otherwise AUGMENT: original message first, reframe
    // attached as guidance — both on top of the recalled memory block.
    if (!out || out === 'SKIP' || out === prompt.trim()) return withCtx(prompt);
    return withCtx(`${prompt}\n\n[Clarified task: ${out}]`);
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
