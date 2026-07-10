// The escalate-up advisor — Imhotep, the vizier. The inverse of routing's delegate-down:
// an advisor-enabled Keeper runs on a cheap driver model and "calls up" to a stronger
// model only at a genuinely hard decision point, instead of paying the frontier model
// on every turn.
//
// The economics only work if the fork is SCOPEABLE: the Keeper packages the decision as
// a self-contained brief (the advisor never sees the Keeper's thread), so the escalation
// pays opus prices on a small payload, not on the Keeper's accumulated context. That is
// also why the Keeper never flushes or reseeds around an escalation — it just pauses,
// gets the verdict appended, and continues on its own warm session. A domain whose hard
// calls need the whole thread (months of personal history) should NOT enable this; a
// domain whose hard calls localize (a bug, a design fork) should. Ptah ships enabled.
//
// Pool of ONE: the advisor is domain-agnostic (reasoning horsepower; the domain rides in
// on the brief), so a single warm session serves every Keeper. It lives in the registry
// like any Keeper session — lazily spawned on the first escalation, resumed (warm prefix
// prompt-cached) on every later one. Deliberately NOT prewarmed: escalations are rare.
//
// The trigger is IN-BAND — the Keeper itself emits an ADVISE: brief when it hits a fork.
// No pre-turn "is this hard?" classifier: that would tax every easy turn with an extra
// call to save cost on the rare hard one. One escalation per turn, hard cap.

import { stripCanary } from './canary.js';

// The advisor's spec — shaped like a Keeper (runTurn accepts it via opts.keeper) but
// never in KEEPERS: not routable, no terms, never prewarmed. Toolless + clean: it
// reasons over the brief alone, and must not inherit repo context the Keeper didn't
// put in the brief (that would hide underspecified briefs).
export const ADVISOR = {
  id: 'imhotep',
  alias: 'advisor',
  clean: true,
  tools: '',
  model: 'opus',
  persona:
    'You are Imhotep, the vizier of Alexandria — the shared escalation advisor. Domain ' +
    'Keepers running on faster models bring you their hardest decision points as ' +
    'self-contained briefs; you are the stronger reasoner they call up to. You have no ' +
    'access to their threads: the brief is everything you know. If it is underspecified, ' +
    'name what is missing — then still decide on the stated facts. Return a decisive ' +
    'verdict: the option you would take, why in a few sentences, the main risk of that ' +
    'choice, and concrete next steps. Be brief and directive — you are advising a ' +
    'capable agent, not writing an essay.',
};

// Appended (after the canary instruction) to an advisor-enabled Keeper's persona at
// session creation. Calibrated toward NOT escalating — a driver that escalates often
// has scoped the wrong forks and just made every turn slower and pricier.
export const ADVISE_INSTRUCTION =
  '\n\nESCALATION RULE: you run on a fast model, and a stronger advisor is available for ' +
  'the rare, genuinely hard decision — an architectural fork, an irreversible or ' +
  'high-risk choice, a tradeoff you are not confident calling. When (and ONLY when) you ' +
  'hit one, do not answer. Reply with a block whose first line starts with `ADVISE:`, ' +
  'followed by a self-contained brief: the decision to make, the options and their ' +
  'tradeoffs, the constraints, and minimal relevant excerpts. The advisor has NO access ' +
  'to this conversation — the brief must stand alone, and smaller briefs are cheaper. ' +
  'You will receive the verdict as your next message and then complete the task. Most ' +
  'turns must NOT escalate: if you can make the call yourself, make it.';

// A reply is an escalation iff a line starts with ADVISE: — the brief is everything
// from the marker on (the Keeper is told to reply with only the block, but a stray
// preamble line shouldn't kill the escalation). Returns null for a normal answer.
export function extractAdviceRequest(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/^\s*ADVISE:\s*/m);
  if (!m) return null;
  const brief = stripCanary(text.slice(m.index + m[0].length)).trim();
  return brief || null;
}

// The follow-up turn handed back to the SAME warm Keeper session after the advisor
// answers. Explicitly forbids a second ADVISE — one escalation per turn (handle()
// also enforces the cap; the instruction just keeps the model from wasting the reply).
export function advisedPrompt(plan) {
  return (
    '[Advisor verdict] Your ADVISE brief was reviewed by the stronger advisor model. ' +
    `Its verdict:\n\n${plan}\n\nProceed with the original task now, applying this ` +
    'verdict (note any conflict with something the advisor could not see, then still ' +
    'act). Do not emit another ADVISE block this turn.'
  );
}

// Relay one brief to the warm advisor session and return its verdict text ('' on any
// failure — the caller falls back to relaying the Keeper's raw reply, never breaks the
// turn). `run` is the same injectable turn runner as the Keeper's (runTurn live): the
// advisor session persists in reg.sessions[imhotep] via the exact same mechanism.
export async function advise(brief, { alias = 'a', reg, settings, run } = {}) {
  if (!run) return '';
  const prompt =
    `A Keeper (the ${alias} domain agent, running on a faster model) hit a hard ` +
    `decision point and escalated this brief:\n\n${brief}\n\nGive your verdict.`;
  try {
    const turn = await run(ADVISOR.id, prompt, { reg, settings, keeper: ADVISOR });
    if (!turn || turn.error) return '';
    return stripCanary(String(turn.text || '')).trim();
  } catch {
    return '';
  }
}
