// Slash-command autocomplete (src/pharos/slash.js) — pure matching, ranking, windowing and
// key handling, offline. bin/pharos.js only draws what these return.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initSlash, slashMatches, slashView, slashWindow, slashKey, MAX_ROWS } from '../src/pharos/slash.js';

const CMDS = [
  { name: '/todo', desc: 'your TODO.md' },
  { name: '/research', desc: 'fan-out research' },
  { name: '/restart', desc: 'relaunch' },
  { name: '/settings', desc: 'view & toggle settings' },
  { name: '/reset', desc: 'wipe state' },
  { name: '/model', desc: 'change model', args: [{ value: 'default' }, { value: 'sonnet', current: true }, { value: 'opus' }] },
  { name: '/help', desc: 'this list' },
];
const labels = (m) => m.items.map((it) => it.label);

test('a bare "/" lists every command in order', () => {
  assert.deepEqual(labels(slashMatches('/', CMDS)), CMDS.map((c) => c.name));
});

test('typing filters: prefix matches first, then substring matches', () => {
  assert.deepEqual(labels(slashMatches('/re', CMDS)), ['/research', '/restart', '/reset']);
  // "set" is a prefix of /settings and inside /reset
  assert.deepEqual(labels(slashMatches('/set', CMDS)), ['/settings', '/reset']);
  assert.deepEqual(labels(slashMatches('/RE', CMDS)), ['/research', '/restart', '/reset'], 'case-insensitive');
});

test('no match, plain text, or a space after an arg-less command → no menu', () => {
  assert.equal(slashMatches('/zzz', CMDS), null);
  assert.equal(slashMatches('hello', CMDS), null);
  assert.equal(slashMatches('', CMDS), null);
  assert.equal(slashMatches('/todo add milk', CMDS), null);
  assert.equal(slashMatches('/todo ', CMDS), null, '/todo has no argument choices');
});

test('after "/model " the menu lists its argument choices, filtered', () => {
  const m = slashMatches('/model ', CMDS);
  assert.equal(m.kind, 'arg');
  assert.deepEqual(labels(m), ['default', 'sonnet', 'opus']);
  assert.deepEqual(labels(slashMatches('/model op', CMDS)), ['opus']);
  assert.equal(slashMatches('/model op', CMDS).items[0].fill, '/model opus');
  assert.equal(slashMatches('/model zz', CMDS), null);
});

test('a fresh view pre-selects the current argument, else row 0', () => {
  assert.equal(slashView(initSlash(), '/model ', CMDS).sel, 1, 'sonnet is current');
  assert.equal(slashView(initSlash(), '/re', CMDS).sel, 0);
});

test('up/down wrap the selection; the selection sticks while the line is unchanged', () => {
  let sl = initSlash();
  const v = slashView(sl, '/re', CMDS);
  let r = slashKey(sl, { name: 'up' }, '/re', v);
  assert.equal(r.type, 'redraw');
  assert.equal(slashView(r.sl, '/re', CMDS).sel, 2, 'up from row 0 wraps to the last row');
  sl = r.sl;
  r = slashKey(sl, { name: 'down' }, '/re', slashView(sl, '/re', CMDS));
  assert.equal(slashView(r.sl, '/re', CMDS).sel, 0);
  assert.equal(slashView(r.sl, '/res', CMDS).sel, 0, 'a changed line resets the selection');
});

test('Tab completes the selected command (with a trailing space)', () => {
  const v = slashView(initSlash(), '/to', CMDS);
  const r = slashKey(initSlash(), { name: 'tab' }, '/to', v);
  assert.deepEqual([r.type, r.buf], ['fill', '/todo ']);
});

test('Enter runs the selected command; on a command with choices it opens them instead', () => {
  let r = slashKey(initSlash(), { name: 'return' }, '/he', slashView(initSlash(), '/he', CMDS));
  assert.deepEqual([r.type, r.line], ['submit', '/help']);
  r = slashKey(initSlash(), { name: 'return' }, '/mo', slashView(initSlash(), '/mo', CMDS));
  assert.deepEqual([r.type, r.buf], ['fill', '/model ']);
  r = slashKey(initSlash(), { name: 'return' }, '/model ', slashView(initSlash(), '/model ', CMDS));
  assert.deepEqual([r.type, r.line], ['submit', '/model sonnet'], 'Enter on the pre-selected current value keeps it');
});

test('Shift/Alt+Enter and ordinary keys pass through to the line editor', () => {
  const v = slashView(initSlash(), '/re', CMDS);
  assert.equal(slashKey(initSlash(), { name: 'return', shift: true }, '/re', v).type, 'pass');
  assert.equal(slashKey(initSlash(), { name: 'return', meta: true }, '/re', v).type, 'pass');
  assert.equal(slashKey(initSlash(), { name: 's' }, '/re', v).type, 'pass');
  assert.equal(slashKey(initSlash(), { name: 'backspace' }, '/re', v).type, 'pass');
});

test('Esc hides the menu until the line changes', () => {
  const r = slashKey(initSlash(), { name: 'escape' }, '/re', slashView(initSlash(), '/re', CMDS));
  assert.equal(slashView(r.sl, '/re', CMDS), null);
  assert.ok(slashView(r.sl, '/res', CMDS), 'typing brings it back');
});

test('slashWindow keeps the selection inside a MAX_ROWS window', () => {
  assert.equal(slashWindow(4, 3), 0, 'short lists never scroll');
  assert.equal(slashWindow(14, 0), 0);
  assert.equal(slashWindow(14, MAX_ROWS - 1), 0);
  assert.equal(slashWindow(14, MAX_ROWS), 1);
  assert.equal(slashWindow(14, 13), 14 - MAX_ROWS, 'clamped at the end');
  for (let sel = 0; sel < 14; sel += 1) {
    const s = slashWindow(14, sel);
    assert.ok(sel >= s && sel < s + MAX_ROWS, `sel ${sel} visible in [${s}, ${s + MAX_ROWS})`);
  }
});

test('typing part of an argument selects the best match, not the current value', () => {
  // current = sonnet, but "o" means opus — the typed text wins (reviewer regression)
  const v = slashView(initSlash(), '/model o', CMDS);
  assert.equal(v.items[v.sel].label, 'opus');
  const r = slashKey(initSlash(), { name: 'return' }, '/model o', v);
  assert.equal(r.line, '/model opus');
});
