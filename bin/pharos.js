#!/usr/bin/env node
// Alexandria front door — one prompt, Pharos routes it to the right warm Keeper.
//
//   node bin/pharos.js            # live (uses the claude CLI / subscription)
//   node bin/pharos.js --mock     # offline: routes + switches, no API calls
//
// Type a prompt and press enter. /exit to quit.

import readline from 'node:readline';
import { handle } from '../src/pharos.js';

const mock = process.argv.includes('--mock');

console.log('');
console.log('  Alexandria — Pharos routes · Keepers hold · Alexandria remembers');
console.log(`  ${mock ? 'MOCK mode (no API)' : 'live mode'} · Keepers: Ptah(code) Ra(personal) Anubis(intake) · /exit to quit`);
console.log('');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'alexandria› ' });
rl.prompt();

rl.on('line', async (line) => {
  const p = line.trim();
  if (!p) return rl.prompt();
  if (p === '/exit' || p === '/quit') return rl.close();

  const r = await handle(p, { mock });
  const arrow = r.switched ? '↪' : '·';
  const recall = r.recalled?.length ? ` · recalled ${r.recalled.length}` : '';
  const flush = r.redone ? (r.degraded ? ' · ⚠ degraded (redone)' : ' · reseeded') : '';
  console.log(`  ${arrow} ${r.routed} (${r.alias})  [${r.note}${r.fresh ? ' · new' : ''}${recall}${flush}]`);
  console.log(r.text);
  console.log('');
  rl.prompt();
});

rl.on('close', () => {
  console.log('— Alexandria out.');
  process.exit(0);
});
