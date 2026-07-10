// Research fan-out — control flow proved fully offline (no claude spawn). The injected
// `ask` mock records every call, so we assert the three stages fire in order, the fan-out
// is parallel over the decomposed angles, mode picks the lenses, and a failed worker
// degrades instead of sinking the run.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { research, parseAngles, MODES } from '../src/research/fanout.js';

// A mock ask that classifies each call by which stage it is (decompose / worker / synth)
// from the prompt text, and returns canned output. Records calls for assertions.
function makeAsk(overrides = {}) {
  const calls = [];
  const ask = async (prompt, opts = {}) => {
    calls.push({ prompt, opts });
    if (/numbered list/i.test(prompt)) return overrides.decompose ?? '1. alpha\n2. beta\n3. gamma';
    if (/Worker findings|Lens findings/i.test(prompt)) return overrides.synth ?? 'SYNTHESIZED REPORT';
    return overrides.worker ?? `findings for: ${prompt.slice(0, 20)}`;
  };
  return { ask, calls };
}

test('broad mode: decompose → fan out → synthesize, in order', async () => {
  const { ask, calls } = makeAsk();
  const out = await research('why is the sky blue', { ask, mode: 'broad' });

  assert.equal(out.mode, 'broad');
  assert.deepEqual(out.angles, ['alpha', 'beta', 'gamma']); // parsed from decompose
  assert.equal(out.findings.length, 3);
  assert.equal(out.report, 'SYNTHESIZED REPORT');

  // First call is decompose, last is synth, the middle N are the workers.
  assert.match(calls[0].prompt, /numbered list/i);
  assert.match(calls.at(-1).prompt, /Worker findings/i);
  assert.equal(calls.length, 1 + 3 + 1);
});

test('workers run with web tools + the mode worker-system prompt', async () => {
  const { ask, calls } = makeAsk();
  await research('q', { ask, mode: 'broad' });
  const workers = calls.filter((c) => c.opts.tools);
  assert.equal(workers.length, 3);
  for (const w of workers) {
    assert.equal(w.opts.tools, 'WebSearch,WebFetch');
    assert.equal(w.opts.system, MODES.broad.workerSystem);
  }
});

test('non-worker stages are sandboxed (tools:"") and every stage carries a timeout', async () => {
  const { ask, calls } = makeAsk();
  await research('q', { ask, mode: 'broad', timeoutMs: 123 });
  // decompose (first) + synth (last) get NO tools — '' disables all built-ins, so the
  // web-derived synth prompt can't reach Bash even under skipPerms.
  assert.equal(calls[0].opts.tools, '');
  assert.equal(calls.at(-1).opts.tools, '');
  for (const c of calls) assert.equal(c.opts.timeoutMs, 123);
});

test('idea mode: uses the fixed lenses, NO decompose call, council verdict', async () => {
  const { ask, calls } = makeAsk();
  const out = await research('a group-dinner booking app', { ask, mode: 'idea' });

  assert.equal(out.mode, 'idea');
  assert.deepEqual(out.angles, MODES.idea.lenses); // fixed, not LLM-decomposed
  // No call should be the decompose prompt (idea mode skips it).
  assert.equal(calls.filter((c) => /numbered list/i.test(c.prompt)).length, 0);
  // Workers = one per lens; synth uses the idea rubric.
  assert.equal(out.findings.length, MODES.idea.lenses.length);
  assert.match(calls.at(-1).prompt, /Lens findings/i);
});

test('angles override caps the worker count', async () => {
  const { ask, calls } = makeAsk({ decompose: '1. a\n2. b\n3. c\n4. d\n5. e' });
  const out = await research('q', { ask, mode: 'broad', angles: 2 });
  assert.equal(out.angles.length, 2);
  assert.equal(calls.filter((c) => c.opts.tools).length, 2);
});

test('a failed worker degrades to an empty finding, run still synthesizes', async () => {
  const calls = [];
  const ask = async (prompt, opts = {}) => {
    calls.push({ prompt, opts });
    if (/numbered list/i.test(prompt)) return '1. a\n2. b';
    if (/Worker findings/i.test(prompt)) return 'REPORT';
    if (opts.tools && /a$/.test(prompt.trim())) throw new Error('worker boom'); // angle "a" fails
    return 'ok';
  };
  const out = await research('q', { ask, mode: 'broad' });
  const failed = out.findings.filter((f) => f.error);
  assert.equal(failed.length, 1);
  assert.equal(out.report, 'REPORT'); // synthesis still ran
});

test('empty question throws', async () => {
  const { ask } = makeAsk();
  await assert.rejects(() => research('   ', { ask }), /empty question/);
});

test('onStage fires decompose → fanout → synthesize', async () => {
  const { ask } = makeAsk();
  const stages = [];
  await research('q', { ask, mode: 'broad', onStage: (s) => stages.push(s.stage) });
  assert.deepEqual(stages, ['decompose', 'fanout', 'synthesize']);
});

test('parseAngles: strips numbered / bullet markers, caps at n, falls back', () => {
  assert.deepEqual(parseAngles('1. one\n2) two\n- three', 5), ['one', 'two', 'three']);
  assert.deepEqual(parseAngles('a\nb\nc\nd', 2), ['a', 'b']);
  assert.deepEqual(parseAngles('', 5, 'FALLBACK'), ['FALLBACK']);
  assert.deepEqual(parseAngles('   \n  ', 5, 'FB'), ['FB']);
});
