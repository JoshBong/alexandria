// The live-loop session + the P4 inbox injection. Driven by injected primitives — the
// whole pipeline (plan → run → review → self-write → exit) provable offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { runLiveLoop, injectInput, formatEvent } from '../src/loop/session.js';
import { readInbox } from '../src/loop/inbox.js';
import { createSkillStore } from '../src/memory/skills.js';

const tmp = (n) => mkdtempSync(join(tmpdir(), `alex-sess-${n}-`));

test('formatEvent: shapes each event type, swallows empty self-write', () => {
  assert.match(formatEvent({ event: 'plan', steps: 2 }), /planned 2 steps/);
  assert.match(formatEvent({ event: 'step', id: 'g1', status: 'done', attempts: 1 }), /✓ g1 — done/);
  assert.match(formatEvent({ event: 'review', reviewer: 'thoth', approved: false }), /REJECTED/);
  assert.match(formatEvent({ event: 'exit', status: 'success', reason: 'd', iterations: 3 }), /✦ success/);
  assert.equal(formatEvent({ event: 'selfwrite', applied: [] }), null);
});

test('injectInput: appends to the loop inbox (P4 async transport)', () => {
  const dir = tmp('say');
  injectInput('do the thing', { loopId: 'L', dir });
  const inbox = readInbox({ dir });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].raw, 'do the thing');
  rmSync(dir, { recursive: true, force: true });
});

test('runLiveLoop: end-to-end on injected primitives, prints progress, writes a skill', async () => {
  const dir = tmp('e2e');
  const skills = createSkillStore({ dir: join(dir, 'sk'), now: () => 1 });
  const lines = [];
  const askOnce = async (prompt) => {
    if (/Decompose this goal/.test(prompt)) return '{"done":"d","steps":[{"intent":"do step one"}]}';
    if (/INDEPENDENT reviewer/.test(prompt)) return '{"approved":true,"notes":"ok"}';
    if (/FORKED reviewer/.test(prompt)) return '{"skills":[{"name":"step-one-pattern","body":"how"}]}';
    return '';
  };
  const res = await runLiveLoop('do step one', {
    loopId: 'sess-e2e', dir, persist: false, reg: { sessions: {} },
    askOnce, handle: async () => ({ routed: 'ptah', text: 'ok', contextTokens: 0 }),
    skills, roster: ['ptah', 'thoth'], verifiers: { ptah: async () => ({ pass: true }) },
    print: (l) => lines.push(l),
  });
  assert.equal(res.status, 'success');
  assert.ok(lines.some((l) => /planned 1 step/.test(l)));
  assert.ok(lines.some((l) => /approved/.test(l)));
  assert.ok(lines.some((l) => /✦ success/.test(l)));
  assert.equal((await skills.get('step-one-pattern')).body, 'how');
  rmSync(dir, { recursive: true, force: true });
});
