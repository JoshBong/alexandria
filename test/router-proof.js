// Phase 0 — Pharos's guesser, proof harness.
//
// Runs the classifier over a labeled set and reports whether a cheap, local,
// API-free router is trustworthy enough to build the front door on. Prints
// accuracy, a confusion matrix, every misroute, and every low-confidence call.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify } from '../src/pharos/classify.js';
import { KEEPERS, SWITCH_MARGIN } from '../src/pharos/keepers.js';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, 'prompts.labeled.json'), 'utf8'));

const ids = KEEPERS.map((k) => k.id);
const confusion = Object.fromEntries(ids.map((e) => [e, Object.fromEntries(ids.map((r) => [r, 0]))]));

let correct = 0;
const misroutes = [];
const lowconf = [];

for (const c of cases) {
  const res = classify(c.prompt);
  confusion[c.expected][res.routed] += 1;
  if (res.routed === c.expected) correct += 1;
  else misroutes.push({ ...c, got: res.routed, topScore: res.topScore, margin: res.margin, reason: res.reason });
  if (res.reason === 'argmax' && res.margin < SWITCH_MARGIN) {
    lowconf.push({ ...c, got: res.routed, margin: res.margin });
  }
}

const pct = ((correct / cases.length) * 100).toFixed(1);
const pad = (s, n) => String(s).padEnd(n);

console.log(`\n  PHAROS ROUTER-PROOF  —  ${correct}/${cases.length} correct  (${pct}%)\n`);

// Confusion matrix: rows = expected (god), cols = routed (god).
console.log('  confusion matrix  (row = expected, col = routed)\n');
console.log('  ' + pad('exp\\got', 10) + ids.map((i) => pad(i, 8)).join(''));
for (const e of ids) {
  const row = ids.map((r) => pad(confusion[e][r] || '.', 8)).join('');
  console.log('  ' + pad(e, 10) + row);
}

if (misroutes.length) {
  console.log(`\n  misroutes (${misroutes.length}):`);
  for (const m of misroutes) {
    console.log(`    ✗ [${pad(m.expected, 6)}→ ${pad(m.got, 7)}] score=${m.topScore} margin=${m.margin} ${m.reason}`);
    console.log(`        "${m.prompt}"`);
  }
} else {
  console.log('\n  misroutes: none ✓');
}

if (lowconf.length) {
  console.log(`\n  low-confidence (margin < ${SWITCH_MARGIN}, routed but shaky):`);
  for (const l of lowconf) {
    const flag = l.got === l.expected ? '~' : '✗';
    console.log(`    ${flag} [${pad(l.expected, 6)}→ ${pad(l.got, 7)}] margin=${l.margin}  "${l.prompt}"`);
  }
} else {
  console.log(`\n  low-confidence calls: none ✓`);
}

console.log('');
