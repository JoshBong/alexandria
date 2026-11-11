// Unit proofs for the pure line-editing reducer (src/pharos/input.js). The live terminal
// feel is checked in a real TTY, but the editing/history/cancel logic and the kitty CSI-u
// decode — the parts that were missing or wrong — are pinned down here, offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initInput, reduceKey, parseCsiU } from '../src/pharos/input.js';

// Helper: feed a sequence of [key, str] events through the reducer, return final state.
const drive = (events, start = initInput()) => events.reduce((st, [key, str]) => reduceKey(st, key, str).state, start);
const type = (st, text) => [...text].reduce((s, ch) => reduceKey(s, {}, ch).state, st);

test('printable insert advances the caret', () => {
  const st = type(initInput(), 'hello');
  assert.equal(st.buf, 'hello');
  assert.equal(st.curIdx, 5);
});

test('backspace deletes the char before the caret', () => {
  let st = type(initInput(), 'hello');
  st = reduceKey(st, { name: 'backspace' }).state;
  assert.equal(st.buf, 'hell');
  assert.equal(st.curIdx, 4);
});

test('forward Delete removes the char under the caret', () => {
  let st = type(initInput(), 'hello');
  st = reduceKey(st, { name: 'home' }).state; // caret to start
  st = reduceKey(st, { name: 'delete' }).state;
  assert.equal(st.buf, 'ello');
  assert.equal(st.curIdx, 0);
});

test('Ctrl+W deletes the word before the caret', () => {
  let st = type(initInput(), 'fix the bug');
  st = reduceKey(st, { ctrl: true, name: 'w' }).state;
  assert.equal(st.buf, 'fix the ');
  assert.equal(st.curIdx, 8);
});

test('Alt+Backspace also deletes a word', () => {
  let st = type(initInput(), 'one two');
  st = reduceKey(st, { meta: true, name: 'backspace' }).state;
  assert.equal(st.buf, 'one ');
});

test('Ctrl+K kills to end, Ctrl+U kills to start', () => {
  let st = type(initInput(), 'abcdef');
  st = reduceKey(st, { name: 'left' }).state; // caret at 5
  st = reduceKey(st, { name: 'left' }).state; // caret at 4
  const k = reduceKey(st, { ctrl: true, name: 'k' }).state;
  assert.equal(k.buf, 'abcd');
  const u = reduceKey(st, { ctrl: true, name: 'u' }).state;
  assert.equal(u.buf, 'ef');
  assert.equal(u.curIdx, 0);
});

test('Alt+Left / Alt+Right jump by word', () => {
  let st = type(initInput(), 'alpha beta gamma');
  st = reduceKey(st, { meta: true, name: 'left' }).state; // start of "gamma"
  assert.equal(st.curIdx, 11);
  st = reduceKey(st, { meta: true, name: 'left' }).state; // start of "beta"
  assert.equal(st.curIdx, 6);
  st = reduceKey(st, { meta: true, name: 'right' }).state; // end of "beta"
  assert.equal(st.curIdx, 10);
});

test('Enter submits, resets the buffer, and records history', () => {
  let st = type(initInput(), 'first prompt');
  const r = reduceKey(st, { name: 'return' });
  assert.equal(r.action.type, 'submit');
  assert.equal(r.action.line, 'first prompt');
  assert.equal(r.state.buf, '');
  assert.equal(r.state.curIdx, 0);
  assert.deepEqual(r.state.history, ['first prompt']);
});

test('blank Enter submits without polluting history', () => {
  const r = reduceKey(initInput(), { name: 'return' });
  assert.equal(r.action.type, 'submit');
  assert.deepEqual(r.state.history, []);
});

test('Shift+Enter and Alt+Enter insert a newline, no submit', () => {
  let st = type(initInput(), 'line one');
  const shift = reduceKey(st, { name: 'return', shift: true });
  assert.equal(shift.action.type, 'redraw');
  assert.equal(shift.state.buf, 'line one\n');
  const alt = reduceKey(st, { name: 'return', meta: true });
  assert.equal(alt.state.buf, 'line one\n');
});

test('backslash + Enter becomes a continuation newline', () => {
  let st = type(initInput(), 'line one\\');
  const r = reduceKey(st, { name: 'return' });
  assert.equal(r.action.type, 'redraw'); // not a submit
  assert.equal(r.state.buf, 'line one\n');
});

test('Up/Down walk history with a stashed live draft', () => {
  let st = initInput();
  st = reduceKey(type(st, 'one'), { name: 'return' }).state;
  st = reduceKey(type(st, 'two'), { name: 'return' }).state;
  st = type(st, 'dra'); // an in-progress draft
  st = reduceKey(st, { name: 'up' }).state; // most recent
  assert.equal(st.buf, 'two');
  st = reduceKey(st, { name: 'up' }).state; // older
  assert.equal(st.buf, 'one');
  st = reduceKey(st, { name: 'up' }).state; // clamp at oldest
  assert.equal(st.buf, 'one');
  st = reduceKey(st, { name: 'down' }).state;
  assert.equal(st.buf, 'two');
  st = reduceKey(st, { name: 'down' }).state; // back to the live draft
  assert.equal(st.buf, 'dra');
  assert.equal(st.histIdx, null);
});

test('Down with no active recall does nothing', () => {
  const r = reduceKey(type(initInput(), 'x'), { name: 'down' });
  assert.equal(r.action.type, 'none');
});

test('Ctrl+C clears a non-empty line, then exits on the empty line (double-tap)', () => {
  let st = type(initInput(), 'half-typed');
  let r = reduceKey(st, { ctrl: true, name: 'c' }); // clears
  assert.equal(r.action.type, 'redraw');
  assert.equal(r.state.buf, '');
  r = reduceKey(r.state, { ctrl: true, name: 'c' }); // arms exit
  assert.equal(r.action.type, 'hint-exit');
  assert.equal(r.state.pendingExit, true);
  r = reduceKey(r.state, { ctrl: true, name: 'c' }); // exits
  assert.equal(r.action.type, 'exit');
});

test('any key disarms the pending-exit hint', () => {
  let r = reduceKey(initInput(), { ctrl: true, name: 'c' }); // arm
  assert.equal(r.state.pendingExit, true);
  r = reduceKey(r.state, {}, 'a'); // typing disarms
  assert.equal(r.state.pendingExit, false);
});

test('Esc clears the input', () => {
  let st = type(initInput(), 'scratch this');
  const r = reduceKey(st, { name: 'escape' });
  assert.equal(r.state.buf, '');
  assert.equal(r.state.curIdx, 0);
});

test('Ctrl+D exits on empty, forward-deletes otherwise', () => {
  assert.equal(reduceKey(initInput(), { ctrl: true, name: 'd' }).action.type, 'exit');
  let st = type(initInput(), 'ab');
  st = reduceKey(st, { name: 'home' }).state;
  const r = reduceKey(st, { ctrl: true, name: 'd' });
  assert.equal(r.state.buf, 'b');
});

// --- kitty keyboard protocol decode -------------------------------------------------
test('parseCsiU decodes Shift+Enter (ESC[13;2u) distinctly from plain Enter', () => {
  const shiftEnter = parseCsiU('\x1b[13;2u');
  assert.equal(shiftEnter.name, 'return');
  assert.equal(shiftEnter.shift, true);
  assert.equal(shiftEnter.ctrl, false);
  const plain = parseCsiU('\x1b[13u');
  assert.equal(plain.name, 'return');
  assert.equal(plain.shift, false);
});

test('parseCsiU reads the modifier bitmask (ctrl/alt/shift)', () => {
  assert.deepEqual(
    (({ shift, alt, ctrl }) => ({ shift, alt, ctrl }))(parseCsiU('\x1b[97;8u')), // mod 8-1=7 = shift+alt+ctrl
    { shift: true, alt: true, ctrl: true },
  );
  assert.equal(parseCsiU('\x1b[57414;2u').name, 'return'); // keypad Enter + shift
  assert.equal(parseCsiU('\x1b[27u').name, 'escape');
});

test('parseCsiU returns null for non-CSI-u input', () => {
  assert.equal(parseCsiU('\r'), null);
  assert.equal(parseCsiU('\x1b[A'), null); // arrow up (legacy CSI, not CSI-u)
  assert.equal(parseCsiU('abc'), null);
});

test('a CSI-u Shift+Enter fed through reduceKey inserts a newline', () => {
  // bin/pharos.js maps a parsed CSI-u into the same normalized key the reducer expects.
  const k = parseCsiU('\x1b[13;2u');
  let st = type(initInput(), 'hi');
  const r = reduceKey(st, { name: k.name, shift: k.shift, csiU: true });
  assert.equal(r.action.type, 'redraw');
  assert.equal(r.state.buf, 'hi\n');
});
