// Unit proofs for the interactive /settings menu reducer (src/pharos/menu.js). The live
// terminal feel is checked in ghostty, but the navigation + intent emission — the part
// that decides what a keypress DOES — is pinned down here, offline, no box/TTY needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initMenu, menuKey, MODEL_CHOICES, SHARED_TOOL_CHOICES, SETTINGS_SCHEMA } from '../src/pharos/menu.js';

// A view matching the real schema: the two submenus (model, sharedTools) then flat values.
const VIEW = {
  main: [
    { key: 'model', kind: 'submenu', screen: 'model' },
    { key: 'metrics', kind: 'bool' },
    { key: 'contextWindow', kind: 'num' },
    { key: 'sharedTools', kind: 'submenu', screen: 'tools' },
  ],
  model: [
    { id: '*', label: 'all', model: '' },
    { id: 'ptah', label: 'code', model: 'sonnet' },
    { id: 'anubis', label: 'general', model: 'haiku' },
  ],
  tools: [
    { name: 'WebSearch', on: true },
    { name: 'Read', on: false },
    { name: 'Bash', on: false },
  ],
};
const press = (state, name, extra = {}) => menuKey(state, { name, ...extra }, VIEW);

test('schema leads with the model submenu and MODEL_CHOICES starts at the default', () => {
  assert.equal(SETTINGS_SCHEMA[0].key, 'model');
  assert.equal(SETTINGS_SCHEMA[0].kind, 'submenu');
  assert.equal(MODEL_CHOICES[0], ''); // '' = (default)
});

test('up/down move the cursor and wrap around the main list', () => {
  let s = initMenu();
  assert.equal(s.cursor, 0);
  s = press(s, 'down').state; assert.equal(s.cursor, 1);
  s = press(s, 'up').state; assert.equal(s.cursor, 0);
  s = press(s, 'up').state; assert.equal(s.cursor, VIEW.main.length - 1); // wraps to bottom
  s = press(s, 'down').state; assert.equal(s.cursor, 0); // wraps to top
});

test('Enter on a bool emits a toggle and stays on the row', () => {
  const s0 = initMenu(); // cursor 0 = model; move to metrics (bool)
  const s1 = press(s0, 'down').state;
  const r = press(s1, 'return');
  assert.deepEqual(r.intents, [{ type: 'toggle', key: 'metrics' }]);
  assert.equal(r.state.screen, 'main');
  assert.equal(r.state.cursor, 1);
  assert.equal(r.close, false);
});

test('Enter on the model row opens the per-Keeper submenu', () => {
  const r = press(initMenu(), 'return'); // cursor 0 = model submenu
  assert.equal(r.state.screen, 'model');
  assert.equal(r.state.cursor, 0);
  assert.deepEqual(r.intents, []);
});

test('Esc on main closes the menu', () => {
  const r = press(initMenu(), 'escape');
  assert.equal(r.close, true);
});

test('ctrl+c closes from anywhere', () => {
  const r = menuKey(initMenu(), { name: 'c', ctrl: true }, VIEW);
  assert.equal(r.close, true);
});

test('a num/str field opens a typed editor; typing builds the buffer', () => {
  let s = initMenu();
  s = press(s, 'down').state; // metrics
  s = press(s, 'down').state; // contextWindow (num)
  const open = press(s, 'return');
  assert.ok(open.state.edit, 'enters edit mode');
  assert.equal(open.state.edit.buf, '');
  s = open.state;
  s = menuKey(s, { name: '1', str: '1' }, VIEW).state;
  s = menuKey(s, { name: 'm', str: 'm' }, VIEW).state; // a 'k'/'m' style char is just text
  assert.equal(s.edit.buf, '1m');
});

test('backspace trims the edit buffer; Esc cancels without writing', () => {
  let s = { screen: 'main', cursor: 2, edit: { buf: '200' } }; // editing contextWindow
  s = menuKey(s, { name: 'backspace' }, VIEW).state;
  assert.equal(s.edit.buf, '20');
  const cancel = menuKey(s, { name: 'escape' }, VIEW);
  assert.equal(cancel.state.edit, null);
  assert.deepEqual(cancel.intents, []); // cancel writes nothing
});

test('Enter in a typed field emits a set intent with the buffer and the row kind', () => {
  const s = { screen: 'main', cursor: 2, edit: { buf: '1000000' } }; // contextWindow (num)
  const r = menuKey(s, { name: 'return' }, VIEW);
  assert.deepEqual(r.intents, [{ type: 'set', key: 'contextWindow', kind: 'num', value: '1000000' }]);
  assert.equal(r.state.edit, null);
});

test('in the model submenu, ←/→ cycles the highlighted row and emits setModel', () => {
  const s = { screen: 'model', cursor: 0, edit: null }; // '*' (global), model ''
  const right = menuKey(s, { name: 'right' }, VIEW);
  assert.deepEqual(right.intents, [{ type: 'setModel', id: '*', value: 'sonnet' }]); // '' → sonnet
  const left = menuKey(s, { name: 'left' }, VIEW);
  assert.deepEqual(left.intents, [{ type: 'setModel', id: '*', value: 'haiku' }]); // '' wraps back to last
});

test('cycling a Keeper row steps through MODEL_CHOICES from its current model', () => {
  const s = { screen: 'model', cursor: 1, edit: null }; // ptah, model 'sonnet'
  const r = menuKey(s, { name: 'right' }, VIEW);
  assert.deepEqual(r.intents, [{ type: 'setModel', id: 'ptah', value: 'opus' }]); // sonnet → opus
});

test('Enter or Esc in the model submenu returns to main settings', () => {
  const back1 = menuKey({ screen: 'model', cursor: 2, edit: null }, { name: 'return' }, VIEW);
  assert.equal(back1.state.screen, 'main');
  assert.equal(back1.state.cursor, 0);
  const back2 = menuKey({ screen: 'model', cursor: 2, edit: null }, { name: 'escape' }, VIEW);
  assert.equal(back2.state.screen, 'main');
});

test('up/down wrap within the model submenu', () => {
  let s = { screen: 'model', cursor: 0, edit: null };
  s = menuKey(s, { name: 'up' }, VIEW).state;
  assert.equal(s.cursor, VIEW.model.length - 1);
});

test('Enter on sharedTools opens the tools checklist screen', () => {
  const s = { screen: 'main', cursor: 3, edit: null }; // sharedTools row
  const r = menuKey(s, { name: 'return' }, VIEW);
  assert.equal(r.state.screen, 'tools');
  assert.equal(r.state.cursor, 0);
});

test('shared-tools list ships WebSearch/WebFetch and the powerful writers', () => {
  assert.ok(SHARED_TOOL_CHOICES.includes('WebSearch'));
  assert.ok(SHARED_TOOL_CHOICES.includes('WebFetch'));
  assert.ok(SHARED_TOOL_CHOICES.includes('Read'));
  assert.ok(SHARED_TOOL_CHOICES.includes('Bash')); // present but off by default
});

test('Enter or space in the tools screen toggles the highlighted tool', () => {
  const s = { screen: 'tools', cursor: 1, edit: null }; // Read
  const byEnter = menuKey(s, { name: 'return' }, VIEW);
  assert.deepEqual(byEnter.intents, [{ type: 'toggleTool', name: 'Read' }]);
  assert.equal(byEnter.state.screen, 'tools'); // stays so you can toggle several
  const bySpace = menuKey(s, { name: 'space' }, VIEW);
  assert.deepEqual(bySpace.intents, [{ type: 'toggleTool', name: 'Read' }]);
});

test('Esc in the tools screen returns to main settings', () => {
  const r = menuKey({ screen: 'tools', cursor: 2, edit: null }, { name: 'escape' }, VIEW);
  assert.equal(r.state.screen, 'main');
  assert.equal(r.state.cursor, 0);
});

test('up/down wrap within the tools screen', () => {
  let s = { screen: 'tools', cursor: 0, edit: null };
  s = menuKey(s, { name: 'up' }, VIEW).state;
  assert.equal(s.cursor, VIEW.tools.length - 1);
});
