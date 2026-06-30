#!/usr/bin/env node
// Alexandria auto-loop CLI — run a goal as a live, self-driving Keeper loop, or inject an
// async input into a running one.
//
//   alexandria-loop "<goal>" [--loop <id>] [--mock] [--risk <path,path>]
//   alexandria-loop --say "<input>" [--loop <id>]     # async injection while a loop runs
//
// The loop plans → runs each step against a warm Keeper → an independent Keeper reviews
// before it locks → drift is flagged → a forked review authors reusable skills → repeat
// until the done-condition holds or a guard trips. State lives in .pharos/loops/<id>/.

import { runLiveLoop, injectInput } from '../src/loop/session.js';

function parseArgs(argv) {
  const a = { loopId: 'default', mock: false, say: null, risk: [], rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--loop') a.loopId = argv[++i];
    else if (t === '--say') a.say = argv[++i];
    else if (t === '--mock') a.mock = true;
    else if (t === '--risk') a.risk = (argv[++i] || '').split(',').filter(Boolean);
    else a.rest.push(t);
  }
  a.goal = a.rest.join(' ').trim();
  return a;
}

// A no-claude smoke harness: deterministic planner-less single step + a mock turn, so
// `--mock` exercises the whole pipeline (plan → run → review → self-write → exit) offline.
function mockPrimitives() {
  return {
    handle: async (p) => ({ routed: 'ptah', text: `(mock) ${p}`, contextTokens: 0 }),
    askOnce: async () => '', // empty → planner falls back to a single goal step, review/self-write fail-soft
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.say != null) {
    const rec = injectInput(args.say, { loopId: args.loopId });
    console.log(`↪ injected into loop '${args.loopId}' inbox as ${rec.id}`);
    return;
  }

  if (!args.goal) {
    console.error('usage: alexandria-loop "<goal>" [--loop <id>] [--mock] [--risk a,b]\n       alexandria-loop --say "<input>" [--loop <id>]');
    process.exit(1);
  }

  console.log(`✦ Alexandria loop '${args.loopId}'${args.mock ? ' (mock)' : ''} — ${args.goal}\n`);
  const opts = {
    loopId: args.loopId,
    riskPaths: args.risk,
    print: (line) => console.log(line),
    ...(args.mock ? mockPrimitives() : {}),
  };
  const res = await runLiveLoop(args.goal, opts);
  console.log(`\n${res.status === 'success' ? '✦ done' : '✗ stuck'} — ${res.reason}`);
  process.exit(res.status === 'success' ? 0 : 2);
}

main().catch((e) => {
  console.error('loop crashed:', e && e.message);
  process.exit(1);
});
