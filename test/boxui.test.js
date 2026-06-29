// Unit proofs for the pinned-box cursor math (src/pharos/boxui.js). The live terminal
// feel must be checked in a real TTY, but the math that broke the last attempt — visible
// width with ANSI, the bottom-anchored row layout, the horizontal input window — is
// pinned down here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi, visLen, layout, inputWindow, visualRows, wrapInput } from '../src/pharos/boxui.js';

test('visLen ignores SGR colour codes and counts the marker as one cell', () => {
  assert.equal(visLen('\x1b[38;5;220m⟡\x1b[0m'), 1);
  assert.equal(visLen('  \x1b[38;5;220m⟡\x1b[0m \x1b[38;5;178m›\x1b[0m '), 6); // "  ⟡ › "
  assert.equal(stripAnsi('\x1b[2mhi\x1b[0m'), 'hi');
});

test('layout pins the box to the bottom BOX_H rows', () => {
  const L = layout(24, 3);
  assert.equal(L.scrollBottom, 21);
  assert.equal(L.topRuleRow, 22);
  assert.equal(L.inputRow, 23);
  assert.equal(L.botRuleRow, 24);
  // region (1..scrollBottom) + box (topRule..botRule) exactly tile the screen
  assert.equal(L.botRuleRow, L.rows);
  assert.equal(L.topRuleRow, L.scrollBottom + 1);
});

test('layout never returns nonsense on a tiny / unknown terminal', () => {
  const L = layout(undefined, 3);
  assert.equal(L.rows, 24); // default
  const tiny = layout(2, 3);
  assert.ok(tiny.scrollBottom >= 1);
});

test('inputWindow shows the whole buffer when it fits', () => {
  const r = inputWindow('hello', 5, 20);
  assert.equal(r.shown, 'hello');
  assert.equal(r.offset, 5);
  assert.equal(r.start, 0);
});

test('inputWindow keeps the cursor in view when the buffer overflows', () => {
  const buf = 'abcdefghijklmnopqrstuvwxyz'; // 26 chars
  const r = inputWindow(buf, 26, 10); // cursor at end, width 10
  assert.equal(r.shown.length, 10);
  assert.ok(r.offset <= 10 && r.offset >= 0);
  // the cursor's character is within the shown window
  assert.equal(buf[r.start + r.offset] ?? '', ''); // at end → just past last char
  assert.equal(r.shown, buf.slice(16, 26));
});

test('inputWindow windows around a mid-buffer cursor', () => {
  const buf = '0123456789ABCDEF';
  const r = inputWindow(buf, 4, 6);
  assert.equal(r.shown.length, 6);
  assert.equal(buf[r.start + r.offset], '4'); // cursor still points at the same char
});

test('wrapInput: short input is one row, cursor after the prompt', () => {
  const r = wrapInput('hi', 2, 6, 2, 80); // prefix 6 cols, gutter 2
  assert.deepEqual(r.rows, ['hi']);
  assert.equal(r.cursorRow, 0);
  assert.equal(r.cursorCol, 8); // 6 (prefix) + 2 (curIdx)
});

test('wrapInput: long input wraps to continuation rows at the gutter', () => {
  const buf = 'x'.repeat(100);
  const r = wrapInput(buf, 100, 6, 2, 20); // firstCap 14, contCap 18
  assert.equal(r.rows[0].length, 14); // first row leaves room for the prompt
  assert.equal(r.rows[1].length, 18); // continuation uses full width minus gutter
  // cursor at end maps onto a continuation row, column within [gutter, cols]
  assert.ok(r.cursorRow >= 1);
  assert.ok(r.cursorCol >= 2 && r.cursorCol <= 20);
});

test('wrapInput: cursor gets a fresh row exactly at a wrap boundary', () => {
  const buf = 'x'.repeat(14); // exactly fills row 0 (firstCap 14)
  const r = wrapInput(buf, 14, 6, 2, 20);
  assert.equal(r.cursorRow, 1); // next char would go to the continuation row
  assert.equal(r.cursorCol, 2); // at the gutter
  assert.ok(r.rows.length >= 2); // a row exists for the cursor
});

test('visualRows counts wrap', () => {
  assert.equal(visualRows('', 80), 1);
  assert.equal(visualRows('x'.repeat(80), 80), 1);
  assert.equal(visualRows('x'.repeat(81), 80), 2);
  assert.equal(visualRows('\x1b[2m' + 'x'.repeat(40) + '\x1b[0m', 80), 1); // colour doesn't add rows
});
