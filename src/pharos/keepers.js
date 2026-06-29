// The Keeper registry — Alexandria's domains, named for Egyptian gods.
//
// Each Keeper maps a god (canonical `id`) to a plain-English domain (`alias`), a
// weighted keyword profile Pharos routes on (weights 3/2/1; multi-word keys are
// phrase-matched as substrings, +1 bonus), an `active` flag, a `persona` (its
// standing system prompt — short and stable so it caches), a `tools` allowlist
// (built-in tools passed to the boat via `--tools`), and a `clean` flag.
//
// SHIP NOTHING PERSONAL. Personas carry no identity — they use the `${name}` token,
// filled at load time from the gitignored operator profile (src/pharos/profile.js).
// Terms are domain-generic. An operator's own vocabulary + persona context layer in
// from a gitignored `.pharos/keepers.local.json` (see buildKeepers below), never the
// repo. So the public repo is clean and each operator's instance is their own.
//
// `tools` is sized to the domain: a reasoner Keeper that answers over injected
// context carries NONE (`''` → lean boat); only a Keeper that acts on the repo
// (Ptah) carries real built-ins. MCP connectors (Gmail, browser, calendar) are NOT
// built-in tools — they're deferred and shared across all Keepers on demand (see
// settings.sharedTools / settings.mcpConfig), so they never bloat a boat.
//
// `clean: true` spawns the boat with `--setting-sources local` — no project/user
// CLAUDE.md auto-discovery. Reasoner Keepers want this (a personal/career Keeper has
// no business inheriting the repo's dev-tooling CLAUDE.md). Ptah omits it: the code
// Keeper SHOULD see the repo's own developer context.
//
// Anubis is the generalist Keeper: NO routing profile by design — the cold-start
// fallback when nothing clears the FLOOR (a request that fits no specific domain).
// Stickiness keeps terse follow-ups in the current Keeper (see classify).

import { getProfile } from './profile.js';
import { loadOverrides } from './overrides.js';

// Base registry — generic, identity-free. `${name}` is interpolated per operator.
const BASE = [
  {
    id: 'ptah',
    alias: 'code',
    active: true,
    note: 'craftsman-creator god — building, engineering, the repo',
    // The one acting Keeper: it touches the repo, so it carries real tools and keeps
    // the repo's own CLAUDE.md context (no `clean`).
    tools: 'Read,Edit,Write,Bash,Grep,Glob',
    persona:
      "You are Ptah, Keeper of the code domain in Alexandria — ${name}'s engineering " +
      'and repository work. Be precise, terminal-first, and concise. When you act on the ' +
      'repo (write/edit files, run commands), REPORT what you did in a short summary — name ' +
      'the files you touched and the key changes. Do NOT paste full file contents, large code ' +
      'blocks, or tool-call syntax back into the reply unless explicitly asked. This is a ' +
      'persistent warm thread: assume continuity with earlier turns rather than re-asking.',
    terms: {
      code: 2, bug: 3, refactor: 3, function: 2, hook: 3, script: 2,
      classifier: 3, api: 2, endpoint: 3, deploy: 2, repo: 2, git: 2,
      commit: 2, mcp: 2, node: 2, python: 2, module: 2, error: 2,
      compile: 3, async: 2, implement: 2, build: 2, debug: 3, parser: 2,
      schema: 1, test: 2, 'stack trace': 3, lint: 2,
      website: 3, site: 3, 'landing page': 3, frontend: 3, html: 3,
      css: 2, ui: 2, react: 2, component: 3, page: 2, vercel: 2, design: 1,
    },
  },
  {
    id: 'ra',
    alias: 'personal',
    active: true,
    clean: true,
    note: 'the sun at the center — life, schedule, travel, family',
    tools: '', // reasons over injected context — no tools
    persona:
      "You are Ra, Keeper of ${name}'s personal domain in Alexandria — schedule, travel, " +
      'family, and day-to-day logistics. Be concise and practical. This is a persistent ' +
      'warm thread: assume continuity with earlier turns in this domain.',
    terms: {
      calendar: 3, schedule: 3, flight: 3, trip: 2, travel: 3, dinner: 2,
      gym: 2, family: 2, church: 3, journal: 3, weekend: 2, remind: 3,
      appointment: 3, personal: 2, packing: 2, visa: 2, booking: 2,
      hotel: 2, errand: 2, birthday: 2,
    },
  },
  {
    id: 'thoth',
    alias: 'classwork',
    active: true,
    clean: true,
    note: 'scribe of wisdom — study, courses, research, the curriculum',
    tools: '', // study/answer over injected context — no tools
    persona:
      "You are Thoth, Keeper of ${name}'s classwork and study domain in Alexandria — " +
      'courses, assignments, study, and self-directed learning. Be precise and pedagogical: ' +
      'show the work and the reasoning, do not just hand over answers. This is a persistent ' +
      'warm thread: assume continuity with earlier turns in this domain.',
    terms: {
      class: 3, homework: 3, pset: 3, 'problem set': 3, assignment: 3,
      'discussion post': 3, lecture: 3, exam: 3, study: 2, math: 2,
      'linear algebra': 3, optimization: 2, leetcode: 3, curriculum: 3,
      course: 3, courses: 3, professor: 2, backprop: 3, 'deep learning': 2,
      notes: 2, semester: 2, syllabus: 2, quiz: 2, grade: 2,
    },
  },
  {
    id: 'horus',
    alias: 'professional',
    active: true,
    clean: true,
    note: 'the far-seeing Eye — offers, recruiting, the professional track',
    tools: '', // strategy/answer over injected context — no tools
    persona:
      "You are Horus, Keeper of ${name}'s professional domain in Alexandria — job search, offers, " +
      'recruiting, interviews, and compensation. Be strategic, direct, and honest about ' +
      'tradeoffs. This is a persistent warm thread: assume continuity with earlier turns in ' +
      'this domain.',
    terms: {
      offer: 3, recruiter: 3, recruiting: 3, resume: 3, interview: 3,
      salary: 3, tc: 3, networking: 2, linkedin: 3, application: 2,
      career: 3, job: 3, negotiation: 3, counter: 2, comp: 2,
      referral: 2, onsite: 2, hiring: 2, 'cover letter': 2, 'offer letter': 3,
    },
  },
  {
    id: 'anubis',
    alias: 'general',
    active: true,
    clean: true,
    model: 'haiku', // the generalist runs on the cheapest model — save tokens on catch-all chat
    note: 'the generalist — anything outside the other domains (no routing profile by design)',
    tools: '', // general reasoning — no tools
    persona:
      'You are Anubis, the generalist Keeper of Alexandria. You take anything that does not ' +
      'belong to a specific domain (code, personal, classwork, professional). Be helpful, ' +
      'direct, and broadly useful. If one kind of request keeps coming up, mention it might ' +
      'deserve its own Keeper.',
    terms: {},
  },
];

// Build the live registry: interpolate the operator's name into each persona, append
// any per-Keeper personal context, and merge in the operator's own routing vocabulary
// — all from gitignored local files, never the repo. Pure (injectable) for tests.
export function buildKeepers({ profile = getProfile(), overrides = loadOverrides() } = {}) {
  const name = profile.name || 'the operator';
  // Identity preamble on EVERY persona (incl. Anubis, which has no ${name} of its own)
  // so a Keeper always knows who it serves — and never falls back to git config / env
  // for the operator's name. "my"/"I" in a prompt means this person.
  const identity =
    `The operator you serve is named ${name}. This is authoritative: refer to them as ${name}, ` +
    `and when they say "my", "me", or "I", that means ${name}. If they ask who they are, their ` +
    `name, or say "whoami", answer "${name}". Never substitute a name, email, account, or git/` +
    `system identity from the environment, and do not volunteer their email address. `;
  const about = profile.about ? `${profile.about.trim()} ` : '';
  return BASE.map((k) => {
    const ov = overrides[k.id] || {};
    return {
      ...k,
      // Per-Keeper model override wins; '' / absent falls back to the base default
      // (most Keepers have none → keeper.model stays undefined → keeper.js uses cfg.model).
      model: ov.model || k.model,
      persona: identity + about + k.persona.replace(/\$\{name\}/g, name) + (ov.personaContext ? ` ${ov.personaContext.trim()}` : ''),
      terms: { ...k.terms, ...(ov.terms || {}) },
    };
  });
}

// Resolved once at load. bin/pharos.js runs onboarding (which may write the profile)
// BEFORE dynamically importing the modules that pull this in, so the name is set by
// the time this builds.
export const KEEPERS = buildKeepers();

// Rebuild personas/terms in place from a (possibly just-changed) profile — so a live
// `/name` takes effect without a restart. Mutates the exported KEEPERS array's elements
// so every importer sees the update. Callers should also flush warm sessions, since a
// session's persona is baked at creation.
export function applyProfile({ profile = getProfile(), overrides = loadOverrides() } = {}) {
  const next = buildKeepers({ profile, overrides });
  KEEPERS.forEach((k, i) => { k.persona = next[i].persona; k.terms = next[i].terms; k.model = next[i].model; });
  return KEEPERS;
}

// Below FLOOR, no Keeper is confident. Cold-start → Anubis (intake); but if you
// are already in a Keeper, stickiness keeps you there (see classify).
export const FLOOR = 3;

// Hysteresis: a new candidate must beat the CURRENT Keeper by at least this much
// to trigger a switch. Prevents thrashing on near-ties.
export const SWITCH_MARGIN = 2;
