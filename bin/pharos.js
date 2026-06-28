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

// Serialize turns and track the in-flight one so a stdin close (EOF / piped input)
// waits for it instead of dropping it. Pause input while a turn runs so prompts
// don't interleave with a slow live answer.
let pending = Promise.resolve();
let closed = false;
rl.on('line', (line) => {
  const p = line.trim();
  if (!p) return rl.prompt();
  if (p === '/exit' || p === '/quit') return rl.close();

  rl.pause();
  pending = (async () => {
    const r = await handle(p, { mock });
    const arrow = r.switched ? '↪' : '·';
    const recall = r.recalled?.length ? ` · recalled ${r.recalled.length}` : '';
    const flush = r.redone ? (r.degraded ? ' · ⚠ degraded (redone)' : ' · reseeded') : '';
    const early = r.compacting ? ' · ⟳ pre-compacted (next turn reseeds)' : '';
    console.log(`  ${arrow} ${r.routed} (${r.alias})  [${r.note}${r.fresh ? ' · new' : ''}${recall}${flush}${early}]`);
    console.log(r.text);
    console.log('');
    if (closed) return; // EOF arrived mid-turn — don't touch a closed interface
    rl.resume();
    rl.prompt();
  })();
});

rl.on('close', async () => {
  closed = true;
  await pending; // don't drop a turn that's still flushing/logging
  console.log('— Alexandria out.');
  process.exit(0);
});
