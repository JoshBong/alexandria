#!/usr/bin/env node
// Alexandria run-log viewer — pretty-prints .pharos/events.jsonl.
//
//   node bin/events.js            # all turns + per-Keeper summary
//   node bin/events.js 20         # last 20 turns only
//   node bin/events.js --real     # exclude mock turns (live API turns only)
//
// The raw stream is JSON lines, so `jq` works too:
//   jq -c 'select(.routed=="ptah") | {ts, contextTokens, compacting}' .pharos/events.jsonl

import { readEvents } from '../src/pharos/events.js';

const args = process.argv.slice(2);
const realOnly = args.includes('--real');
const tail = Number(args.find((a) => /^\d+$/.test(a)));

let events = readEvents();
if (realOnly) events = events.filter((e) => !e.mock);
if (!events.length) {
  console.log('\n  No events yet. Run `node bin/pharos.js` and ask something, then re-run this.\n');
  process.exit(0);
}

const shown = Number.isFinite(tail) ? events.slice(-tail) : events;
const num = (n) => (Number.isFinite(n) ? n.toLocaleString() : '·');
const hhmmss = (ts) => (typeof ts === 'string' && ts.includes('T') ? ts.slice(11, 19) : String(ts ?? '·'));

const flags = (e) =>
  [
    e.switched ? '↪' : '',
    e.recalled ? `recall${e.recalled > 1 ? e.recalled : ''}` : '',
    e.reseeded ? '⊕reseed' : '',
    e.compacting ? '⟳compact' : '',
    e.redone ? '↺redo' : '',
    e.degraded ? '⚠degraded' : '',
    e.mock ? 'mock' : '',
  ]
    .filter(Boolean)
    .join(' ');

console.log(`\n  Alexandria run log — ${events.length} turn${events.length === 1 ? '' : 's'}${realOnly ? ' (live only)' : ''} · .pharos/events.jsonl\n`);
console.log('  time      keeper          new   ctx-tokens   flags');
console.log('  ' + '-'.repeat(64));
for (const e of shown) {
  const keeper = `${e.routed}(${e.alias})`.padEnd(15);
  const isNew = e.freshSession ? '●' : ' ';
  const ctx = num(e.contextTokens).padStart(10);
  console.log(`  ${hhmmss(e.ts)}  ${keeper} ${isNew}   ${ctx}   ${flags(e)}`);
}

// Per-Keeper rollup — the "how is it actually behaving" view.
const byKeeper = {};
for (const e of events) {
  const k = (byKeeper[e.routed] = byKeeper[e.routed] || {
    alias: e.alias,
    turns: 0,
    sessions: 0,
    maxCtx: 0,
    compactions: 0,
    degraded: 0,
  });
  k.turns++;
  if (e.freshSession) k.sessions++;
  if (Number.isFinite(e.contextTokens)) k.maxCtx = Math.max(k.maxCtx, e.contextTokens);
  if (e.compacting) k.compactions++;
  if (e.degraded) k.degraded++;
}

console.log('\n  per Keeper:');
for (const [id, k] of Object.entries(byKeeper)) {
  console.log(
    `    ${(id + ' (' + k.alias + ')').padEnd(16)} turns ${String(k.turns).padStart(3)}  sessions ${String(k.sessions).padStart(2)}  maxCtx ${num(k.maxCtx).padStart(9)}  compactions ${k.compactions}  degraded ${k.degraded}`,
  );
}
console.log('');
