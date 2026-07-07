// Research fan-out — the parallel-agent research pipeline, native to Alexandria.
//
// Three stages, all riding the one-shot `askOnce` spawn primitive (a headless `claude -p`):
//   1. decompose  — split the question into N angles (the lenses depend on `mode`)
//   2. fan out    — N parallel worker turns, each researching ONE angle with web tools on
//   3. synthesize — merge the workers' findings under the mode's synthesis rubric
//
// Mock-first + injectable, like loop/ and pharos/: `opts.ask` defaults to a live
// tool-enabled askOnce but tests swap a mock, so the whole control flow — decompose →
// parallel fan-out → synthesize — runs offline with zero `claude` spawns.
//
// `mode` carries the ONLY behavioural difference between broad research and startup-idea
// evaluation: different decompose lenses + a different synthesis rubric. Same machinery.
// (← the /deep-research and /idea-research skills, ported into the harness.)

import { askOnce } from '../pharos/ask.js';

// Models per stage — cheap to decompose, capable to research, strongest to synthesize.
// All overridable via opts; '' anywhere falls back to the CLI default model.
export const DECOMPOSE_MODEL = 'haiku';
export const WORKER_MODEL = 'sonnet';
export const SYNTH_MODEL = 'opus';
const WEB_TOOLS = 'WebSearch,WebFetch';

// The live default ask: a tool-enabled, permission-skipping one-shot (workers need to
// actually search; skipPerms keeps a headless call from hanging on a prompt).
const liveAsk = (prompt, opts = {}) => askOnce(prompt, { skipPerms: true, ...opts });

// A worker's marching orders, shared shape across modes — investigate ONE angle, cite.
const WORKER_RULES =
  'Investigate ONLY this one angle, rigorously, using web search + fetch. Return concrete ' +
  'findings with source URLs inline. State what you could NOT verify. Be terse — no preamble.';

export const MODES = {
  broad: {
    label: 'broad research',
    angles: 5,
    decompose: (q, n) =>
      `Break this research question into ${n} DISTINCT, non-overlapping sub-questions that ` +
      `together cover it — different facets, not rephrasings. Return ONLY a numbered list, ` +
      `one sub-question per line, nothing else.\n\nQUESTION: ${q}`,
    workerSystem: `You are a research worker. ${WORKER_RULES}`,
    worker: (q, angle) => `Overall question: ${q}\n\nYour angle to research: ${angle}`,
    synthSystem:
      'You are a research synthesist. Merge worker findings into ONE coherent, cited report. ' +
      'Corroborate claims across workers; flag any that appear in only one place or conflict. ' +
      'Structure: a short answer up top, then the supporting detail with sources.',
    synthesize: (q, blocks) =>
      `Research question: ${q}\n\nWorker findings follow. Synthesize a single cited report; ` +
      `note contradictions and single-source claims explicitly.\n\n${blocks}`,
  },
  idea: {
    label: 'startup-idea evaluation',
    angles: 5,
    // Fixed lenses — the idea-evaluation criteria, one worker each.
    lenses: [
      'Market: who has this pain, how many, how acute, is the timing right?',
      'Wedge / edge: the specific insight or unfair advantage — why THIS, why now, why you?',
      'Competition: incumbents + alternatives (including "do nothing"); how crowded, how defensible?',
      'Founder-fit & GTM: can a solo/small founder actually reach the buyer and ship this?',
      'Kill-risks: the top ways this dies — regulatory, distribution, unit economics, moat.',
    ],
    decompose: null, // idea mode uses the fixed lenses; no LLM decompose call
    workerSystem:
      `You are a skeptical startup analyst evaluating ONE idea along ONE lens. ${WORKER_RULES} ` +
      `Argue the honest case, not the flattering one.`,
    worker: (q, angle) => `Startup idea: ${q}\n\nEvaluate ONLY this lens: ${angle}`,
    synthSystem:
      'You are the chairman of an idea-review council. Weigh the lens findings adversarially ' +
      'and render a verdict: BUILD, PASS, or NEEDS-WORK. Give the reasoning, the single ' +
      'flip-fact (the one thing that would reverse the verdict), and one concrete next assignment.',
    synthesize: (q, blocks) =>
      `Startup idea: ${q}\n\nLens findings from the council follow. Render the verdict ` +
      `(BUILD / PASS / NEEDS-WORK), the flip-fact, and one next step.\n\n${blocks}`,
  },
};

// Parse a decompose response into up to N angle strings. Accepts a numbered list, a
// dash/bullet list, or plain lines; strips markers and blanks. Falls back to the whole
// question as a single angle if nothing parses (so the pipeline still runs).
export function parseAngles(text, n, fallback) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);
  const angles = lines.slice(0, n);
  return angles.length ? angles : [fallback].filter(Boolean);
}

// Assemble the workers' findings into a single labelled block for the synthesist.
function findingsBlock(findings) {
  return findings
    .map((f, i) => `### Angle ${i + 1}: ${f.angle}\n${f.error ? '(worker failed — no findings)' : f.text}`)
    .join('\n\n');
}

// Run the full fan-out. Returns { question, mode, angles, findings, report }. `onStage`
// is an optional progress hook (stage-name + counts) so a UI can show ⟢ decomposing / etc.
export async function research(question, opts = {}) {
  const q = String(question || '').trim();
  if (!q) throw new Error('research: empty question');
  const {
    ask = liveAsk,
    mode = 'broad',
    angles,
    decomposeModel = DECOMPOSE_MODEL,
    workerModel = WORKER_MODEL,
    synthModel = SYNTH_MODEL,
    onStage = () => {},
  } = opts;
  const m = MODES[mode] || MODES.broad;
  const n = angles || m.angles;

  // Stage 1 — decompose (LLM for broad; fixed lenses for idea).
  onStage({ stage: 'decompose', mode });
  let subs;
  if (m.lenses) {
    subs = m.lenses.slice(0, n);
  } else {
    const raw = await ask(m.decompose(q, n), { model: decomposeModel });
    subs = parseAngles(raw, n, q);
  }

  // Stage 2 — fan out. N parallel workers; a failed worker degrades to an empty finding
  // rather than sinking the whole run.
  onStage({ stage: 'fanout', count: subs.length });
  const findings = await Promise.all(
    subs.map((angle) =>
      ask(m.worker(q, angle), { model: workerModel, system: m.workerSystem, tools: WEB_TOOLS })
        .then((text) => ({ angle, text: String(text || '').trim(), error: !String(text || '').trim() }))
        .catch(() => ({ angle, text: '', error: true })),
    ),
  );

  // Stage 3 — synthesize.
  onStage({ stage: 'synthesize' });
  const report = await ask(m.synthesize(q, findingsBlock(findings)), { model: synthModel, system: m.synthSystem });

  return { question: q, mode, angles: subs, findings, report: String(report || '').trim() };
}
