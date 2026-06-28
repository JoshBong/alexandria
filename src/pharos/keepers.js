// The Keeper registry — Alexandria's domains, named for Egyptian gods.
//
// Each Keeper maps a god (canonical `id`) to a plain-English domain (`alias`), a
// weighted keyword profile Pharos routes on (weights 3/2/1; multi-word keys are
// phrase-matched as substrings, +1 bonus), an `active` flag (does a live Keeper
// session exist yet?), and a `persona` (its standing system prompt — kept short
// and stable so it caches).
//
// Anubis is the intake/lobby Keeper: NO routing profile by design. Pharos lands
// here as the cold-start fallback when nothing clears the FLOOR (a new/unrouted
// topic that hasn't earned its own Keeper). Once you're mid-conversation in a
// Keeper, stickiness keeps terse follow-ups in that Keeper instead (see classify).
//
// Phase 1 stands up Ptah, Ra, and Anubis. Thoth and Horus are defined for routing
// but inactive until later phases (Pharos falls them back to intake for now).

export const KEEPERS = [
  {
    id: 'ptah',
    alias: 'code',
    active: true,
    note: 'craftsman-creator god — building, engineering, the repo',
    persona:
      'You are Ptah, Keeper of the code domain in Alexandria — Josh\'s engineering work ' +
      '(the Alexandria orchestrator itself, the ark hooks, devnexus). Be precise, ' +
      'terminal-first, and concise. This is a persistent warm thread: assume continuity ' +
      'with earlier turns in this domain rather than re-asking for context.',
    terms: {
      code: 2, bug: 3, refactor: 3, function: 2, hook: 3, script: 2,
      classifier: 3, api: 2, endpoint: 3, deploy: 2, repo: 2, git: 2,
      gitnexus: 3, devnexus: 2, mcp: 2, pharos: 2, node: 2, python: 2,
      fastapi: 3, supabase: 2, error: 2, compile: 3, async: 2, implement: 2,
      build: 1, reindex: 3, retrieval: 2, scoring: 2, 'stack trace': 3,
      'vault encoder': 2, debug: 3, parser: 2, schema: 1,
    },
  },
  {
    id: 'ra',
    alias: 'personal',
    active: true,
    note: 'the sun at the center — life, schedule, travel, family',
    persona:
      'You are Ra, Keeper of Josh\'s personal domain in Alexandria — schedule, travel, ' +
      'family, church, and life logistics. Be concise and practical. This is a persistent ' +
      'warm thread: assume continuity with earlier turns in this domain.',
    terms: {
      calendar: 3, schedule: 3, flight: 3, trip: 2, travel: 3, korea: 3,
      taiwan: 3, 'sri lanka': 3, malaysia: 3, dinner: 2, gym: 2,
      taekwondo: 3, faye: 3, family: 2, church: 3, journal: 3, weekend: 2,
      remind: 3, appointment: 3, personal: 2, 'kuala lumpur': 2, packing: 2,
      eta: 2, visa: 2,
    },
  },
  {
    id: 'thoth',
    alias: 'classwork',
    active: false,
    note: 'scribe of wisdom — study, courses, research, the curriculum',
    terms: {
      class: 3, homework: 3, pset: 3, assignment: 3, 'discussion post': 3,
      lecture: 3, exam: 3, study: 2, math: 2, 'linear algebra': 3,
      optimization: 2, leetcode: 3, curriculum: 3, course: 3, courses: 3,
      professor: 2, backprop: 3, 'deep learning': 2, notes: 2, nyu: 2,
      cornell: 2, semester: 2, syllabus: 2, quiz: 2,
    },
  },
  {
    id: 'horus',
    alias: 'career',
    active: false,
    note: 'the far-seeing Eye — offers, recruiting, the professional track',
    terms: {
      juniper: 3, planisphere: 3, offer: 3, recruiter: 3, resume: 3,
      interview: 3, salary: 3, tc: 3, mercor: 3, networking: 2, linkedin: 3,
      application: 2, career: 3, job: 3, hector: 2, negotiation: 3,
      counter: 2, gig: 2, comp: 2, referral: 2, onsite: 2,
    },
  },
  {
    id: 'anubis',
    alias: 'intake',
    active: true,
    note: 'threshold guardian — catch-all for new/unrouted topics (no routing profile by design)',
    persona:
      'You are Anubis, the intake Keeper of Alexandria — you field new or unclassified ' +
      'requests that have no dedicated Keeper yet. Be helpful and general. If a topic ' +
      'clearly recurs, note that it may deserve its own Keeper.',
    terms: {},
  },
];

// Below FLOOR, no Keeper is confident. Cold-start → Anubis (intake); but if you
// are already in a Keeper, stickiness keeps you there (see classify).
export const FLOOR = 3;

// Hysteresis: a new candidate must beat the CURRENT Keeper by at least this much
// to trigger a switch. Prevents thrashing on near-ties.
export const SWITCH_MARGIN = 2;
