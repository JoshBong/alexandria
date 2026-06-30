// The live-loop session — assembles the live adapters (live.js) and runs runLoop with a
// human progress reporter. bin/loop.js is a thin CLI over this; tests drive it with
// injected primitives (no claude spawn). This is the top of the P1–P4 stack: a goal in,
// a planned + executed + reviewed + self-writing loop out.

import { runLoop } from './run.js';
import { makeLiveLoopOpts } from './live.js';
import { appendInput } from './inbox.js';

// Format one loop event as a single progress line, or null to swallow it. Mirrors the
// boundary order so the CLI reads like the loop runs.
export function formatEvent(e = {}) {
  switch (e.event) {
    case 'plan':
      return `▸ planned ${e.steps} step${e.steps === 1 ? '' : 's'}`;
    case 'step':
      return `  ${e.status === 'done' ? '✓' : '⊘'} ${e.id} — ${e.status} (${e.attempts} attempt${e.attempts === 1 ? '' : 's'})`;
    case 'review':
      return `    ⚖ ${e.reviewer || 'reviewer'}: ${e.approved ? 'approved' : 'REJECTED'}`;
    case 'drift':
      return `    ⚠ drift: ${(e.alerts || []).map((a) => `${a.type}/${a.severity}`).join(', ')}`;
    case 'selfwrite':
      return (e.applied || []).length ? `    ✎ skills: ${e.applied.map((a) => `${a.action} ${a.name}`).join(', ')}` : null;
    case 'reseed':
      return '    ↻ reseed (freshness low)';
    case 'replan':
      return `▸ replanned (+${e.folded} folded → ${e.steps} steps)`;
    case 'stop':
      return '■ human STOP';
    case 'exit':
      return `${e.status === 'success' ? '✦' : '✗'} ${e.status}: ${e.reason} (${e.iterations} iterations)`;
    default:
      return null;
  }
}

// P4 — inject an async input into a (possibly running) loop's inbox via the file
// transport. The loop drains it at its next boundary; mid-step stays sacred.
export function injectInput(text, opts = {}) {
  return appendInput(text, { loopId: opts.loopId || 'default', dir: opts.dir });
}

// Run a goal as a live auto-loop. opts.print(line) receives each progress line (default
// stdout-free for tests). All live primitives are injectable through opts (handle,
// askOnce, verifiers, skills, …) so this is provable offline.
export async function runLiveLoop(goal, opts = {}) {
  const print = opts.print || (() => {});
  const liveOpts = makeLiveLoopOpts(opts);
  const onEvent = (e) => {
    const line = formatEvent(e);
    if (line) print(line);
  };
  return runLoop(goal, { ...liveOpts, onEvent, persist: opts.persist });
}
