// Phase 1 sim — proves the warm loop offline (mock, no API).
//
// Walks a realistic multi-turn conversation through Pharos and shows: cold start
// → intake, the stickiness fix keeping terse follow-ups in the right Keeper, a
// clean switch on a strong new-domain prompt, warm resume vs new session — and
// one HONEST limitation (a vocab-free prompt right after a switch sticks to the
// wrong Keeper). One in-memory registry, nothing persisted.

import { handle } from '../src/pharos.js';

const reg = { current: null, sessions: {} };

const convo = [
  ['fix the PreCompact hook so it writes the handoff', 'cold start → Ptah, new session'],
  ['does it pass now', 'WIN: vocab-free, sticks to Ptah (was intake when cold)'],
  ['the optimization isnot converging in my code', 'WIN: collision+sub-floor, stickiness holds Ptah'],
  ['what is on my calendar this weekend', 'clean switch → Ra (strong signal beats margin)'],
  ['remind me about the thing tomorrow', 'stays in Ra'],
  ['ship it', 'LIMITATION: meant code, but sticks to Ra (the stickiness tradeoff)'],
  ['refactor retrieval.cjs to seed from the ark index', 'switches back → Ptah, RESUMES its warm session'],
  ['does it pass now', 'now correctly sticks to Ptah again'],
];

console.log('\n  PHASE 1 SIM  (mock — no API)\n');
console.log('  ' + '-'.repeat(74));

for (const [i, [prompt, expectation]] of convo.entries()) {
  const r = await handle(prompt, { mock: true, reg, persist: false });
  const arrow = r.switched ? '↪' : '·';
  console.log(`  ${String(i + 1).padStart(2)}. "${prompt}"`);
  console.log(`      ${arrow} ${r.routed} (${r.alias})  ·  ${r.reason}${r.fresh ? ' · NEW' : ''}`);
  console.log(`      note: ${expectation}`);
  console.log('');
}

console.log('  ' + '-'.repeat(74));
console.log('  final registry:');
console.log('    current Keeper:', reg.current);
console.log('    sessions held :', Object.keys(reg.sessions).map((k) => `${k}=${reg.sessions[k].sessionId}`).join('  '));
console.log('');
