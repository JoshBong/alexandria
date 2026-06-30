// P1 — live planner + elaborator. Model output → parsed steps, with fail-soft. The
// `ask` runner is mocked (no claude spawn). Also covers the shared JSON extractor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../src/loop/parse.js';
import { plan as planFn, replan as replanFn } from '../src/loop/plan.js';
import { makeElaborator } from '../src/loop/elaborate.js';
import { freshPlan, lockStep } from '../src/loop/plan-store.js';

// ---- extractJson ----

test('extractJson: bare JSON, fenced JSON, and JSON buried in prose', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('sure! here:\n{"a":[1,2]} hope that helps'), { a: [1, 2] });
});

test('extractJson: ignores braces inside strings, returns null on junk', () => {
  assert.deepEqual(extractJson('{"k":"a } b"}'), { k: 'a } b' });
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson(''), null);
  assert.equal(extractJson(null), null);
});

// ---- live planner ----

test('plan: live ask → parsed ordered steps + done + contracts', async () => {
  const p = freshPlan('t', 'ship the feature');
  const ask = async () => '```json\n{"done":"tests green","steps":[{"intent":"write code","touches":["a.js"]},{"intent":"add tests","checks":["suite green"]}]}\n```';
  await planFn(p, { ask });
  assert.deepEqual(p.steps.map((s) => s.intent), ['write code', 'add tests']);
  assert.equal(p.done, 'tests green');
  assert.deepEqual(p.steps[0].touches, ['a.js']);
  assert.ok(p.steps[1].contract); // every step still gets a frozen contract
  assert.deepEqual(p.steps[1].contract.checks.map((c) => c.description), ['suite green']);
});

test('plan: live ask returns junk → fail-soft to a single goal step', async () => {
  const p = freshPlan('t', 'do the thing');
  await planFn(p, { ask: async () => 'I cannot help with that' });
  assert.equal(p.steps.length, 1);
  assert.equal(p.steps[0].intent, 'do the thing');
});

test('plan: live planner drops model deps (rely on order, never deadlock)', async () => {
  const p = freshPlan('t', 'g');
  const ask = async () => '{"steps":[{"intent":"a","deps":["b"]},{"intent":"b","deps":[7]}]}';
  await planFn(p, { ask });
  for (const s of p.steps) assert.deepEqual(s.deps, []); // no unresolvable deps survive
});

// ---- live replan ----

test('replan: live ask appends new steps, prefix order preserved', async () => {
  const p = freshPlan('t', 'g');
  await planFn(p, { steps: ['s1', 's2'] }); // deterministic seed
  lockStep(p, p.steps[0].id);
  const ask = async () => '{"steps":[{"intent":"folded-in"}]}';
  await replanFn(p, [{ id: 'i1', said: 'also do X' }], { ask });
  assert.deepEqual(p.steps.map((s) => s.intent), ['s1', 's2', 'folded-in']);
});

test('replan: live ask junk → folds the elaborated intents deterministically (no lost input)', async () => {
  const p = freshPlan('t', 'g');
  await planFn(p, { steps: ['s1'] });
  await replanFn(p, [{ id: 'i1', said: 'urgent thing', steps: [{ intent: 'urgent thing' }] }], { ask: async () => 'nope' });
  assert.deepEqual(p.steps.map((s) => s.intent), ['s1', 'urgent thing']);
});

// ---- live elaborator ----

test('elaborate: live ask → parsed seam (said/entailed/assuming/fork/steps)', async () => {
  const ask = async () => '{"said":"fix it","entailed":["touches parser.js"],"assuming":["keep the API"],"fork":null,"steps":[{"intent":"fix the parser"}]}';
  const elaborate = makeElaborator({ ask });
  const out = await elaborate({ id: 'i1', raw: 'fix it' }, { goal: 'g' });
  assert.equal(out.said, 'fix it');
  assert.deepEqual(out.entailed, ['touches parser.js']);
  assert.deepEqual(out.steps, [{ intent: 'fix the parser' }]);
});

test('elaborate: live ask junk → fail-soft keeps verbatim said + one step', async () => {
  const elaborate = makeElaborator({ ask: async () => 'garbage' });
  const out = await elaborate({ id: 'i1', raw: 'do X' }, {});
  assert.equal(out.said, 'do X');
  assert.deepEqual(out.steps, [{ intent: 'do X' }]);
});

test('elaborate: no ask → deterministic local elaborator (offline, unchanged)', async () => {
  const elaborate = makeElaborator({});
  const out = await elaborate({ id: 'i1', raw: 'do X' }, {});
  assert.deepEqual(out.steps, [{ intent: 'do X' }]);
  assert.deepEqual(out.entailed, []);
});
