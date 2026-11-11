// g5 — SELF-WRITING review (the headline). At a boundary, a FORKED review reflects on
// what just happened and authors or patches reusable SKILLS — inheriting the warm prompt
// cache but WITHOUT touching the live conversation or its plan/transcript. The fork is
// whitelisted to ONLY memory+skill capability: structurally, this module can do nothing
// but read existing skills and write/patch them through the injected `skills` store — it
// never receives the plan, so it cannot mutate the live loop.
//
// Mock-first + loop-decoupled: opts.ask is the injected fork call (a mock in tests; a
// forked warm-Keeper turn when P2 wires live handle()); opts.skills is the injected
// memory+skill store. No fork wired → no-op (control flow provable offline).
//
// THREE anti-poisoning rules, enforced on the fork's OUTPUT (never trust the model to
// self-police — the screen is the guarantee):
//   1. Never persist env-specific failures or "X is broken" / transient-error claims.
//   2. Class-level naming — a skill is a general capability, not an instance log.
//   3. Patch-existing-before-create — converge on one skill, don't spawn near-dupes.
//
// (← hermes-agent agent/background_review.py — forked review, memory+skill whitelist,
//  anti-self-poisoning prompt + class-level skills.)

import { jaccard } from './plateau.js';

// Rule 1 — the poison screen. Reject any candidate whose name OR body reads like a
// transient failure, an environment-specific detail, or a "broken" claim. These are the
// things a self-writing loop must NEVER bake into a durable skill.
const POISON_PATTERNS = [
  /\bis (?:broken|down|failing|stuck|hosed)\b/i,
  /\b(?:doesn'?t|don'?t|won'?t|can'?t|cannot) work\b/i,
  /\b(?:failed|failing|failure)\b/i,
  /\berror:/i,
  /\bpermission denied\b/i,
  /\b(?:not found|no such file|couldn'?t find|cannot find)\b/i,
  /\btimed out\b/i,
  /\b(?:on my machine|works for me)\b/i,
  /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/, // absolute filesystem paths
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, // IP addresses
];

// The first poison pattern a text trips, or null. Used for logging WHY a skill was
// dropped (so the loop is auditable, not silently lossy). Tests both the raw text and a
// separator-normalized form (hyphens/underscores → spaces) so a kebab-case skill NAME
// like "thing-is-broken" is screened the same as the prose "thing is broken". Slashes
// and dots are untouched, so the path/IP patterns still fire.
export function poisonReason(text = '') {
  const raw = String(text);
  const despaced = raw.replace(/[-_]+/g, ' ');
  for (const re of POISON_PATTERNS) if (re.test(raw) || re.test(despaced)) return re.source;
  return null;
}

export const isPoisoned = (text) => poisonReason(text) !== null;

// Rule 2 — class-level naming. A skill name is a generic, reusable slug: kebab-case,
// alnum only. (Patch-before-create handles the dedup; this just normalizes the key.)
export function normalizeSkillName(name = '') {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

// Screen one candidate against rule 1 + a name sanity check. { ok, reason }.
export function screenSkill(candidate = {}) {
  const name = normalizeSkillName(candidate.name);
  if (!name) return { ok: false, reason: 'empty/ungeneralizable name' };
  const hit = poisonReason(candidate.name) || poisonReason(candidate.body);
  if (hit) return { ok: false, reason: `anti-poison: matched /${hit}/` };
  return { ok: true, reason: null };
}

// Rule 3 — patch-existing-before-create. Exact normalized-name match → patch; else a
// near-duplicate by name-token overlap (Jaccard ≥ 0.6, reusing the plateau metric) →
// patch that one; else create.
export function chooseAction(candidate, existing = []) {
  const name = normalizeSkillName(candidate.name);
  const norm = (s) => normalizeSkillName(typeof s === 'string' ? s : s && s.name);
  const names = existing.map(norm);
  if (names.includes(name)) return { action: 'patch', name };
  const tokens = (s) => s.split('-').filter(Boolean);
  const near = names.find((n) => n && jaccard(tokens(name), tokens(n)) >= 0.6);
  if (near) return { action: 'patch', name: near };
  return { action: 'create', name };
}

function normalizeCandidates(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.skills) ? raw.skills : [raw];
  return arr
    .filter(Boolean)
    .map((c) => (typeof c === 'string' ? { name: c, body: '' } : { name: c.name || '', body: c.body || c.content || '' }))
    .filter((c) => c.name);
}

// The read-only snapshot the fork reflects over. Carries WHAT happened + the existing
// skill names + the standing anti-poisoning instruction — never the live plan object.
function forkPayload(boundary, existing) {
  return {
    goal: boundary.goal,
    lastStep: boundary.lastStep || null,
    existingSkills: existing.map((s) => (typeof s === 'string' ? s : s.name)),
    rules: [
      'Author skills as general, reusable capabilities (class-level), not instance logs.',
      'Patch an existing skill before creating a near-duplicate.',
      'Never persist transient failures, environment-specific paths, or "X is broken" claims.',
    ],
  };
}

// Run the self-writing review at a boundary. Returns a structured summary; applies skills
// ONLY through the injected store. Mutates nothing the live loop reads.
export async function selfWrite(boundary = {}, opts = {}) {
  const { ask, skills } = opts;
  if (!ask) return { ran: false, applied: [], skipped: [], reason: 'no fork wired (P0 no-op)' };
  const existing = skills && skills.list ? await skills.list() : [];
  const candidates = normalizeCandidates(await ask(forkPayload(boundary, existing)));

  const applied = [];
  const skipped = [];
  for (const c of candidates) {
    const screen = screenSkill(c);
    if (!screen.ok) {
      skipped.push({ name: c.name, reason: screen.reason });
      continue;
    }
    const { action, name } = chooseAction(c, existing);
    if (skills) {
      if (action === 'patch' && skills.patch) await skills.patch(name, { name, body: c.body });
      else if (skills.create) await skills.create({ name, body: c.body });
    }
    applied.push({ name, action });
  }
  return { ran: true, applied, skipped };
}
