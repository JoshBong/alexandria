// The Keeper registry — Alexandria's domains, named for Egyptian gods.
//
// Each Keeper maps a god (canonical `id`) to a plain-English domain (`alias`), a
// weighted keyword profile Pharos routes on (weights 3/2/1; multi-word keys are
// phrase-matched as substrings, +1 bonus), an `active` flag (does a live Keeper
// session exist yet?), a `persona` (its standing system prompt — kept short and
// stable so it caches), and a `tools` allowlist passed to the boat's `claude`
// spawn (`--tools`). Tools are sized to the domain: a reasoner Keeper that answers
// over injected context carries NONE (`''` → boat baseline ~6k, not ~26k); only a
// Keeper that actually acts on the repo (Ptah) carries real tools. The orchestrator
// holds the heavy toolbox one layer down; the boats stay lean.
//
// Anubis is the intake/lobby Keeper: NO routing profile by design. Pharos lands
// here as the cold-start fallback when nothing clears the FLOOR (a new/unrouted
// topic that hasn't earned its own Keeper). Once you're mid-conversation in a
// Keeper, stickiness keeps terse follow-ups in that Keeper instead (see classify).

export const KEEPERS = [
  {
    id: 'ptah',
    alias: 'code',
    active: true,
    note: 'craftsman-creator god — building, engineering, the repo',
    // The one acting Keeper: it touches the repo, so it carries real tools.
    tools: 'Read,Edit,Write,Bash,Grep,Glob',
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
    tools: '', // reasons over injected context — no tools
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
    active: true,
    note: 'scribe of wisdom — study, courses, research, the curriculum',
    tools: '', // study/answer over injected context — no tools
    persona:
      'You are Thoth, Keeper of Josh\'s classwork and study domain in Alexandria — NYU + ' +
      'Cornell Tech courses and the ML/research-engineering curriculum (linear algebra, ' +
      'optimization, deep learning, daily leetcode), psets, lectures, and discussion posts. ' +
      'Be precise and pedagogical: show the work and the reasoning, do not just give answers. ' +
      'This is a persistent warm thread: assume continuity with earlier turns in this domain.',
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
    active: true,
    note: 'the far-seeing Eye — offers, recruiting, the professional track',
    tools: '', // strategy/answer over injected context — no tools
    persona:
      'You are Horus, Keeper of Josh\'s career domain in Alexandria — offers (Juniper, ' +
      'Planisphere), recruiting, interviews, compensation and negotiation, Mercor, and the ' +
      'professional track toward Cornell Tech and beyond. Be strategic, direct, and honest ' +
      'about tradeoffs. This is a persistent warm thread: assume continuity with earlier ' +
      'turns in this domain.',
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
    tools: '', // general reasoning — no tools
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
