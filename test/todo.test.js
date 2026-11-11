// /todo — pure markdown surgery over the operator's own TODO.md. Parsing, check-off,
// and inbox insertion; everything not a task line must pass through byte-identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTodos, checkOff, addTodo, INBOX_HEADING } from '../src/pharos/todo.js';

const MD = `---
title: TODO
---

# TODO

## School — deadlines

- [ ] submit enrollment form
- [x] upload ID photo
- [ ] send transcripts

Some prose that mentions - [ ] but not at line start is kept as prose.

## Travel

  - [ ] book the hotel
- [~] half-done thing
`;

test('parseTodos: finds task lines with section context; numbers OPEN items only', () => {
  const items = parseTodos(MD);
  assert.equal(items.length, 5);
  const open = items.filter((t) => t.open);
  assert.deepEqual(open.map((t) => t.n), [1, 2, 3]);
  assert.deepEqual(open.map((t) => t.text), ['submit enrollment form', 'send transcripts', 'book the hotel']);
  assert.equal(open[2].section, 'Travel'); // indented task still parses, right section
  const done = items.find((t) => t.text === 'upload ID photo');
  assert.equal(done.open, false);
  assert.equal(done.n, 0);
});

test('checkOff: flips exactly the Nth open box, leaves every other byte alone', () => {
  const { md, item } = checkOff(MD, 2);
  assert.equal(item.text, 'send transcripts');
  assert.match(md, /- \[x\] send transcripts/);
  assert.match(md, /- \[ \] submit enrollment form/); // neighbors untouched
  assert.equal(md.split('\n').length, MD.split('\n').length, 'no lines added or lost');
  assert.ok(md.includes('Some prose that mentions'));
});

test('checkOff: out-of-range N returns an error, not a corrupted file', () => {
  assert.match(checkOff(MD, 9).error, /no open item #9/);
  assert.match(checkOff(MD, 0).error, /no open item/);
});

test('addTodo: creates the alexandria inbox above the first section on first use', () => {
  const md = addTodo(MD, 'buy fallon present', { date: '2026-07-16' });
  const lines = md.split('\n');
  const at = lines.indexOf(INBOX_HEADING);
  assert.ok(at !== -1 && at < lines.indexOf('## School — deadlines'), 'inbox sits above existing sections');
  assert.match(md, /- \[ \] buy fallon present \(added 2026-07-16\)/);
});

test('addTodo: appends into an existing inbox without duplicating the heading', () => {
  const once = addTodo(MD, 'first');
  const twice = addTodo(once, 'second');
  assert.equal(twice.split(INBOX_HEADING).length, 2, 'heading appears exactly once');
  const items = parseTodos(twice).filter((t) => t.section === INBOX_HEADING.replace(/^##\s*/, ''));
  assert.deepEqual(items.map((t) => t.text), ['second', 'first']);
});
