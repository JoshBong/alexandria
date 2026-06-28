// The Keeper registry — Alexandria's domains, named for Egyptian gods.
//
// Each Keeper maps a god (canonical `id`) to a plain-English domain (`alias`) and
// a weighted keyword profile Pharos uses to route a prompt. Weights: 3 = strong,
// 2 = medium, 1 = weak. Multi-word keys are matched as substrings (phrase, +1 bonus).
//
// Anubis is the intake/lobby Keeper and has NO profile on purpose: Pharos routes
// to it as the fallback when no other Keeper clears the confidence FLOOR — i.e. a
// new/unrouted topic that hasn't earned its own Keeper yet (crystallize-on-earn).
//
// v0 profiles are hand-seeded and grounded in Josh's actual work. Phase 2 reseeds
// these from the ark domain index and adds embeddings for the fuzzy cases. The
// god-name is the canonical label; Pharos routes on the `alias` (the domain).

export const KEEPERS = [
  {
    id: 'ptah',
    alias: 'code',
    note: 'craftsman-creator god — building, engineering, the repo',
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
    note: 'the sun at the center — life, schedule, travel, family',
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
    note: 'threshold guardian — catch-all for new/unrouted topics (no profile by design)',
    terms: {},
  },
];

// Below FLOOR, no Keeper is confident → route to Anubis (intake).
export const FLOOR = 3;

// Hysteresis: when already in a Keeper, the top candidate must beat the current
// Keeper by at least this much to trigger a switch. Prevents thrashing.
export const SWITCH_MARGIN = 2;
