// Adversarial blind-route — NOT an accuracy score.
//
// These prompts were written to BREAK the keyword router, not pass it. There's
// no honest accuracy number here (the profiles' author wrote the prompts). The
// value is the failure taxonomy: routes each prompt blind and flags where the
// keyword approach structurally cracks — sub-floor singles, no-vocabulary
// semantics, collisions, and context-dependent prompts. That tells us what
// Phase 2 (embeddings + the current-Keeper prior) actually has to fix.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify } from '../src/pharos/classify.js';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, 'prompts.adversarial.json'), 'utf8'));
const pad = (s, n) => String(s).padEnd(n);

let clean = 0;
let cracked = 0;
let needsContext = 0;
const byMode = {};

console.log(`\n  ADVERSARIAL BLIND-ROUTE  —  ${cases.length} prompts written to break it\n`);
console.log('  ' + pad('verdict', 9) + pad('routed', 9) + pad('sc/mgn', 8) + 'prompt');
console.log('  ' + '-'.repeat(72));

for (const c of cases) {
  const r = classify(c.prompt);
  const accept = new Set(c.intent.split('/'));
  let verdict;
  if (c.intent === '(current)') { verdict = 'CONTEXT'; needsContext += 1; }
  else if (accept.has(r.routed)) { verdict = 'ok'; clean += 1; }
  else if (r.routed === 'anubis') { verdict = 'FALSE-INTAKE'; cracked += 1; }
  else { verdict = 'MISROUTE'; cracked += 1; }

  if (verdict !== 'ok') (byMode[c.mode] ??= []).push(c.prompt);

  const mark = verdict === 'ok' ? '·' : verdict === 'CONTEXT' ? '?' : '✗';
  console.log(
    `  ${mark} ${pad(verdict, 7)}${pad(r.routed, 9)}${pad(`${r.topScore}/${r.margin}`, 8)}"${c.prompt}"`
  );
  if (verdict !== 'ok') console.log(`  ${' '.repeat(24)}↳ ${c.mode}  (wanted: ${c.intent})`);
}

console.log('\n  ' + '-'.repeat(72));
console.log(`  clean: ${clean}   cracked: ${cracked}   needs-thread-context: ${needsContext}   of ${cases.length}`);
console.log('\n  crack modes surfaced:');
for (const [mode, ps] of Object.entries(byMode)) {
  console.log(`    • ${mode}  (${ps.length})`);
}
console.log('');
