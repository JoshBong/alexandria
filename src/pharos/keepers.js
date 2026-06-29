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
// Anubis is the intake/lobby Keeper: NO routing profile by design — the cold-start
// fallback when nothing clears the FLOOR. Stickiness keeps terse follow-ups in the
// current Keeper (see classify).

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
      'and repository work. Be precise, terminal-first, and concise. This is a persistent ' +
      'warm thread: assume continuity with earlier turns in this domain rather than ' +
      're-asking for context.',
    terms: {
      code: 2, bug: 3, refactor: 3, function: 2, hook: 3, script: 2,
      classifier: 3, api: 2, endpoint: 3, deploy: 2, repo: 2, git: 2,
      commit: 2, mcp: 2, node: 2, python: 2, module: 2, error: 2,
      compile: 3, async: 2, implement: 2, build: 1, debug: 3, parser: 2,
      schema: 1, test: 2, 'stack trace': 3, lint: 2,
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
    alias: 'career',
    active: true,
    clean: true,
    note: 'the far-seeing Eye — offers, recruiting, the professional track',
    tools: '', // strategy/answer over injected context — no tools
    persona:
      "You are Horus, Keeper of ${name}'s career domain in Alexandria — job search, offers, " +
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
    alias: 'intake',
    active: true,
    clean: true,
    note: 'threshold guardian — catch-all for new/unrouted topics (no routing profile by design)',
    tools: '', // general reasoning — no tools
    persona:
      'You are Anubis, the intake Keeper of Alexandria — you field new or unclassified ' +
      'requests that have no dedicated Keeper yet. Be helpful and general. If a topic ' +
      'clearly recurs, note that it may deserve its own Keeper.',
    terms: {},
  },
];

// Build the live registry: interpolate the operator's name into each persona, append
// any per-Keeper personal context, and merge in the operator's own routing vocabulary
// — all from gitignored local files, never the repo. Pure (injectable) for tests.
export function buildKeepers({ profile = getProfile(), overrides = loadOverrides() } = {}) {
  const name = profile.name || 'the operator';
  return BASE.map((k) => {
    const ov = overrides[k.id] || {};
    return {
      ...k,
      persona: k.persona.replace(/\$\{name\}/g, name) + (ov.personaContext ? ` ${ov.personaContext.trim()}` : ''),
      terms: { ...k.terms, ...(ov.terms || {}) },
    };
  });
}

// Resolved once at load. bin/pharos.js runs onboarding (which may write the profile)
// BEFORE dynamically importing the modules that pull this in, so the name is set by
// the time this builds.
export const KEEPERS = buildKeepers();

// Below FLOOR, no Keeper is confident. Cold-start → Anubis (intake); but if you
// are already in a Keeper, stickiness keeps you there (see classify).
export const FLOOR = 3;

// Hysteresis: a new candidate must beat the CURRENT Keeper by at least this much
// to trigger a switch. Prevents thrashing on near-ties.
export const SWITCH_MARGIN = 2;
