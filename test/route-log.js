// Route log — raw inputs → classifier outputs, no answer key.
//
// Reads test/inputs.txt (one prompt per line; blank lines and lines starting
// with '#' ignored), routes each through the current classifier, and writes
// test/route-log.md. No expected labels, no verdicts — just what Pharos did.
//
// Commit route-log.md so that after each profile/floor tweak, `git diff` shows
// exactly which prompts changed routing. That's the tracking loop.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify } from '../src/pharos/classify.js';
import { FLOOR, SWITCH_MARGIN } from '../src/pharos/keepers.js';

const here = dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(join(here, 'inputs.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const rows = lines.map((prompt) => {
  const r = classify(prompt);
  const scores = Object.entries(r.scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, s]) => `${id}:${s}`)
    .join(' ') || '—';
  return { prompt, routed: r.routed, alias: r.alias, margin: r.margin, reason: r.reason, scores };
});

const esc = (s) => s.replace(/\|/g, '\\|');
const out = [];
out.push('# Pharos route log');
out.push('');
out.push(`config: FLOOR=${FLOOR} · SWITCH_MARGIN=${SWITCH_MARGIN} · ${rows.length} prompts`);
out.push('');
out.push('| # | input | → routed | domain | margin | reason | nonzero scores |');
out.push('|---|-------|----------|--------|--------|--------|----------------|');
rows.forEach((r, i) => {
  out.push(`| ${i + 1} | ${esc(r.prompt)} | **${r.routed}** | ${r.alias} | ${r.margin} | ${r.reason} | ${esc(r.scores)} |`);
});
out.push('');

writeFileSync(join(here, 'route-log.md'), out.join('\n'));
console.log(`wrote test/route-log.md — ${rows.length} prompts (FLOOR=${FLOOR}, SWITCH_MARGIN=${SWITCH_MARGIN})`);
