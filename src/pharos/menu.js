// Interactive /settings menu — the PURE state machine (no I/O, no rendering), so the
// whole keyboard flow is unit-testable offline. bin/pharos.js owns rendering + applies
// the emitted intents (saveSettings / saveOverride / flush). Same mock-first discipline
// as boxui.js: logic here, terminal there.
//
// Screens:
//   main   — the settings list. ↑/↓ move · Enter acts · Esc closes.
//              bool    → Enter toggles in place
//              num/str → Enter opens a typed field (type + Enter saves · Esc cancels)
//              submenu → Enter opens the per-Keeper model screen
//   model  — per-Keeper model. ↑/↓ pick a row · ←/→ cycle that row's model ·
//              Enter or Esc returns to main. Row '*' = the global default (cfg.model).
//
// menuKey(state, key, view) is the reducer: given the current state, a keypress, and a
// VIEW snapshot (row counts/kinds/current values that bin computes from cfg+keepers), it
// returns { state, intents, close }. bin applies intents, re-snapshots the view, redraws.

// '' = "(default)": on the global row it means the CLI default; on a Keeper row it means
// "follow the global model setting". The cycle wraps through the real aliases.
export const MODEL_CHOICES = ['', 'sonnet', 'opus', 'haiku'];

// The shared built-in tools every Keeper can load on demand (a togglable subset of the
// claude CLI's tools). Read-only/research tools are safe for every Keeper; the file/shell
// writers (Bash/Write/Edit) are powerful — listed so you CAN share them, off by default.
export const SHARED_TOOL_CHOICES = [
  'WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob', 'TodoWrite', 'Bash', 'Write', 'Edit',
];

// The settings list, top to bottom. `model` and `sharedTools` are submenus (the `screen`
// they open); the rest are flat values. kind drives what Enter does. (Labels/help live in
// bin alongside the other UI copy.)
export const SETTINGS_SCHEMA = [
  { key: 'model', kind: 'submenu', screen: 'model' },
  { key: 'sharedTools', kind: 'submenu', screen: 'tools' },
  { key: 'metrics', kind: 'bool' },
  { key: 'contextWindow', kind: 'num' },
  { key: 'mcpConfig', kind: 'str' },
  { key: 'reframe', kind: 'bool' },
  { key: 'revoice', kind: 'bool' },
  { key: 'skipPerms', kind: 'bool' },
  { key: 'prewarm', kind: 'bool' },
];

export function initMenu() {
  return { screen: 'main', cursor: 0, edit: null };
}

function cycle(arr, cur, dir) {
  const i = arr.indexOf(cur);
  const base = i < 0 ? 0 : i;
  return arr[(base + dir + arr.length) % arr.length];
}

const wrap = (i, n) => ((i % n) + n) % n;

export function menuKey(state, key, view) {
  const k = key || {};
  const name = k.name;
  const intents = [];
  const out = (st, close = false) => ({ state: st, intents, close });

  // Always-available hard exit.
  if (k.ctrl && name === 'c') return out(state, true);

  // --- editing a typed field (num/str) on the main screen ---
  if (state.edit) {
    if (name === 'escape') return out({ ...state, edit: null }); // cancel, no write
    if (name === 'return' || name === 'enter') {
      const row = view.main[state.cursor];
      intents.push({ type: 'set', key: row.key, kind: row.kind, value: state.edit.buf });
      return out({ ...state, edit: null });
    }
    if (name === 'backspace') return out({ ...state, edit: { buf: state.edit.buf.slice(0, -1) } });
    const ch = k.str;
    if (ch && !k.ctrl && !k.meta && ch >= ' ') return out({ ...state, edit: { buf: state.edit.buf + ch } });
    return out(state);
  }

  // --- main screen ---
  if (state.screen === 'main') {
    const n = view.main.length;
    if (name === 'up') return out({ ...state, cursor: wrap(state.cursor - 1, n) });
    if (name === 'down') return out({ ...state, cursor: wrap(state.cursor + 1, n) });
    if (name === 'escape') return out(state, true);
    if (name === 'return' || name === 'enter') {
      const row = view.main[state.cursor];
      if (row.kind === 'bool') { intents.push({ type: 'toggle', key: row.key }); return out(state); }
      if (row.kind === 'submenu') return out({ ...state, screen: row.screen, cursor: 0 });
      return out({ ...state, edit: { buf: '' } }); // num/str → empty field, type the new value
    }
    return out(state);
  }

  // --- shared-tools screen: a checklist. Enter/space toggles the row, Esc returns ---
  if (state.screen === 'tools') {
    const n = view.tools.length;
    if (name === 'up') return out({ ...state, cursor: wrap(state.cursor - 1, n) });
    if (name === 'down') return out({ ...state, cursor: wrap(state.cursor + 1, n) });
    if (name === 'escape' || name === 'left') return out({ ...state, screen: 'main', cursor: 0 });
    if (name === 'return' || name === 'enter' || name === 'space' || k.str === ' ') {
      intents.push({ type: 'toggleTool', name: view.tools[state.cursor].name });
      return out(state);
    }
    return out(state);
  }

  // --- per-Keeper model screen ---
  if (state.screen === 'model') {
    const n = view.model.length;
    if (name === 'up') return out({ ...state, cursor: wrap(state.cursor - 1, n) });
    if (name === 'down') return out({ ...state, cursor: wrap(state.cursor + 1, n) });
    if (name === 'left' || name === 'right') {
      const row = view.model[state.cursor];
      const next = cycle(MODEL_CHOICES, row.model || '', name === 'right' ? 1 : -1);
      intents.push({ type: 'setModel', id: row.id, value: next });
      return out(state);
    }
    if (name === 'return' || name === 'enter' || name === 'escape') return out({ ...state, screen: 'main', cursor: 0 });
    return out(state);
  }

  return out(state);
}
