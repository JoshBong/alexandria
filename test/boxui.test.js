// Unit proofs for the pinned-box cursor math (src/pharos/boxui.js). The live terminal
// feel must be checked in a real TTY, but the math that broke the last attempt — visible
// width with ANSI, the bottom-anchored row layout, the horizontal input window — is
// pinned down here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi, visLen, charWidth, strWidth, layout, inputWindow, visualRows, wrapInput } from '../src/pharos/boxui.js';

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

test('wrapInput: a hard newline splits into logical rows, cursor follows', () => {
  const r = wrapInput('ab\ncd', 3, 6, 2, 80); // curIdx 3 = just after the \n, before 'c'
  assert.deepEqual(r.rows, ['ab', 'cd']);
  assert.equal(r.cursorRow, 1); // second logical line
  assert.equal(r.cursorCol, 2); // at the gutter, before 'c'
  const before = wrapInput('ab\ncd', 2, 6, 2, 80); // curIdx 2 = end of first line, before \n
  assert.equal(before.cursorRow, 0);
  assert.equal(before.cursorCol, 8); // 6 (prefix) + 2
});

test('wrapInput: a trailing newline gives an empty continuation row for the cursor', () => {
  const r = wrapInput('ab\n', 3, 6, 2, 80);
  assert.deepEqual(r.rows, ['ab', '']);
  assert.equal(r.cursorRow, 1);
  assert.equal(r.cursorCol, 2);
});

test('charWidth: CJK and emoji are two cells, combining is zero, ASCII is one', () => {
  assert.equal(charWidth('a'.codePointAt(0)), 1);
  assert.equal(charWidth('你'.codePointAt(0)), 2); // CJK Unified
  assert.equal(charWidth('好'.codePointAt(0)), 2);
  assert.equal(charWidth('가'.codePointAt(0)), 2); // Hangul syllable
  assert.equal(charWidth('😀'.codePointAt(0)), 2); // emoji (astral)
  assert.equal(charWidth(0x0301), 0); // combining acute accent
  assert.equal(charWidth('⟡'.codePointAt(0)), 1); // the Alexandria marker stays one cell
});

test('strWidth/visLen count display cells, not code points', () => {
  assert.equal(strWidth('你好'), 4); // two wide chars → four cells
  assert.equal(strWidth('hi你'), 4); // 1 + 1 + 2
  assert.equal(visLen('\x1b[38;5;220m你\x1b[0m'), 2); // ANSI stripped, wide char = 2
  assert.equal(strWidth('😀'), 2);
});

test('wrapInput: CJK cursor uses display width, not char count (the drift fix)', () => {
  // "你好" at end: 2 code points, but 4 display cells. Caret must sit at prefix+4, not prefix+2.
  const r = wrapInput('你好', 2, 6, 2, 20);
  assert.deepEqual(r.rows, ['你好']);
  assert.equal(r.cursorRow, 0);
  assert.equal(r.cursorCol, 10); // 6 (prefix) + 4 (two wide chars)
  // caret between the two chars → prefix + 2
  const mid = wrapInput('你好', 1, 6, 2, 20);
  assert.equal(mid.cursorCol, 8);
});

test('wrapInput: an emoji (surrogate pair) is one caret step, two cells wide', () => {
  const r = wrapInput('😀', 2, 6, 2, 20); // curIdx 2 = past the surrogate pair (one glyph)
  assert.deepEqual(r.rows, ['😀']);
  assert.equal(r.cursorCol, 8); // 6 + 2
});

test('wrapInput: wide chars wrap by cells — a row never overflows its cell budget', () => {
  const buf = '字'.repeat(10); // each 2 cells
  const r = wrapInput(buf, 0, 6, 2, 20); // firstCap 14 cells → 7 chars, contCap 18 → 9 chars
  assert.equal([...r.rows[0]].length, 7); // 7 wide chars = 14 cells, fits firstCap exactly
  assert.equal(strWidth(r.rows[0]) <= 14, true);
  assert.equal(strWidth(r.rows[1]) <= 18, true);
});

test('visualRows counts wrap', () => {
  assert.equal(visualRows('', 80), 1);
  assert.equal(visualRows('x'.repeat(80), 80), 1);
  assert.equal(visualRows('x'.repeat(81), 80), 2);
  assert.equal(visualRows('\x1b[2m' + 'x'.repeat(40) + '\x1b[0m', 80), 1); // colour doesn't add rows
});
