#!/usr/bin/env node
// alexandria-research — the research fan-out as a standalone CLI (for scripts / cron).
// Same pipeline as the TUI `/research` command: decompose → parallel web workers →
// synthesis. Prints the synthesized report to stdout.
//
//   alexandria-research "<question>" [--idea|--broad] [--angles N] [--json]
//
//   --idea    startup-idea evaluation (fixed lenses → BUILD/PASS council verdict)
//   --broad   broad research (default; distinct sub-questions → cited report)
//   --angles  number of parallel workers (default 5)
//   --json    emit the full { question, mode, angles, findings, report } object

import { research, MODES } from '../src/research/fanout.js';

const argv = process.argv.slice(2);
let mode = 'broad';
let angles;
let json = false;
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--idea' || a === '--startup') mode = 'idea';
  else if (a === '--broad') mode = 'broad';
  else if (a === '--mode') mode = argv[++i] || mode;
  else if (a === '--angles') angles = Number(argv[++i]) || undefined;
  else if (a === '--json') json = true;
  else words.push(a);
}
const question = words.join(' ').trim();

if (!question) {
  process.stderr.write('usage: alexandria-research "<question>" [--idea|--broad] [--angles N] [--json]\n');
  process.exit(1);
}

const stamp = (s) => process.stderr.write(`  · ${s}\n`);
stamp(`${(MODES[mode] || MODES.broad).label} — decomposing…`);

try {
  const out = await research(question, {
    mode,
    angles,
    onStage: (s) => {
      if (s.stage === 'fanout') stamp(`fanning out → ${s.count} workers`);
      else if (s.stage === 'synthesize') stamp('synthesizing…');
    },
  });
  if (json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else process.stdout.write('\n' + out.report + '\n');
} catch (e) {
  process.stderr.write(`research failed: ${e.message}\n`);
  process.exit(1);
}
