// Pure line-editing reducer for the pinned input box (bin/pharos.js drives the I/O).
//
// Same split as menu.js: ALL the editing/navigation/history/cancel logic lives here as a
// pure function of (state, key) → { state, action }, so the tricky parts (word boundaries,
// history recall with a stashed draft, Ctrl+C double-tap, the kitty Shift+Enter decode) are
// unit-testable offline. bin/pharos.js keeps the things that are inseparable from I/O —
// bracketed paste, the /settings menu, and scrollback paging — and delegates everything else
// here, then applies the returned action (redraw / submit / newline / exit / clear / hint).
//
// curIdx is a UTF-16 index into buf (so it composes with buf.slice everywhere); the box's
// width-aware wrapping (boxui.wrapInput) turns that into the right on-screen column.

export const initInput = () => ({
  buf: '',
  curIdx: 0,
  history: [], // submitted prompt lines, oldest→newest
  histIdx: null, // null = editing the live draft; else an index into history
  draft: null, // the live draft stashed while paging through history
  pendingExit: false, // armed by Ctrl+C on an empty line; a 2nd Ctrl+C exits
});

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n';

// Start of the word at/under idx (skip trailing spaces, then the word) — for Ctrl+W / Alt+←.
function wordStart(buf, idx) {
  let i = idx;
  while (i > 0 && isSpace(buf[i - 1])) i -= 1;
  while (i > 0 && !isSpace(buf[i - 1])) i -= 1;
  return i;
}
// End of the word ahead of idx — for Alt+→ / Alt+D / forward word delete.
function wordEnd(buf, idx) {
  let i = idx;
  while (i < buf.length && isSpace(buf[i])) i += 1;
  while (i < buf.length && !isSpace(buf[i])) i += 1;
  return i;
}

const ins = (s, at, text) => s.slice(0, at) + text + s.slice(at);
const cut = (s, from, to) => s.slice(0, from) + s.slice(to);

// Load a history entry (or the stashed draft) into the editable buffer, caret at end.
const load = (st, text) => ({ ...st, buf: text, curIdx: text.length });

// Decode a kitty keyboard-protocol CSI-u sequence: ESC [ <codepoint> [; <modifiers>] u.
// modifiers field is 1 + bitmask(shift=1, alt=2, ctrl=4, …). Returns null for anything else.
// This is the one piece that lets Shift+Enter be told apart from plain Enter — a plain
// terminal sends a bare \r for both; with the protocol on, Shift+Enter is ESC[13;2u.
const CSI_U = /^\x1b\[(\d+)(?:;(\d+))?u$/;
const KEYCODES = { 13: 'return', 27: 'escape', 9: 'tab', 127: 'backspace', 57414: 'return' /* keypad enter */ };
export function parseCsiU(seq) {
  const m = CSI_U.exec(String(seq || ''));
  if (!m) return null;
  const cp = Number(m[1]);
  const modField = m[2] ? Number(m[2]) : 1;
  const mod = Math.max(0, modField - 1);
  return {
    codepoint: cp,
    name: KEYCODES[cp] || null,
    shift: !!(mod & 1),
    alt: !!(mod & 2),
    ctrl: !!(mod & 4),
    csiU: true,
  };
}

// The reducer. `key` is a normalized descriptor { name, ctrl, meta, shift, csiU }, `str` is
// the literal character for printable input. Returns the next state plus a single action the
// I/O shell carries out. Pure — no terminal writes, no history mutation beyond `state`.
export function reduceKey(state, key, str) {
  const st = { ...state };
  key = key || {};
  const name = key.name;
  const redraw = (s) => ({ state: s, action: { type: 'redraw' } });
  const exit = (s) => ({ state: s, action: { type: 'exit' } });
  // Any key other than a fresh Ctrl+C disarms the pending-exit hint.
  const clearPending = !(key.ctrl && name === 'c');
  if (clearPending && st.pendingExit) st.pendingExit = false;

  // --- submit / newline ---------------------------------------------------------------
  if (name === 'return' || name === 'enter') {
    // Shift/Alt+Enter (or kitty CSI-u Shift+Enter) → hard line break, stay in the box.
    if (key.meta || key.shift) { const s = { ...st, buf: ins(st.buf, st.curIdx, '\n'), curIdx: st.curIdx + 1 }; return redraw(s); }
    // Backslash-continuation: a lone trailing "\" before Enter becomes a newline (the
    // portable multi-line idiom that works in every terminal, kitty or not).
    if (st.curIdx > 0 && st.buf[st.curIdx - 1] === '\\') {
      const s = { ...st, buf: st.buf.slice(0, st.curIdx - 1) + '\n' + st.buf.slice(st.curIdx) };
      return redraw(s);
    }
    const line = st.buf;
    const trimmed = line.trim();
    const history = trimmed && st.history[st.history.length - 1] !== line ? [...st.history, line] : st.history;
    return { state: { ...st, buf: '', curIdx: 0, history, histIdx: null, draft: null }, action: { type: 'submit', line } };
  }

  // --- cancel / clear -----------------------------------------------------------------
  if (key.ctrl && name === 'c') {
    if (st.buf.length) return redraw({ ...st, buf: '', curIdx: 0, pendingExit: false }); // clear first
    if (st.pendingExit) return exit(st); // second Ctrl+C on an empty line
    return { state: { ...st, pendingExit: true }, action: { type: 'hint-exit' } };
  }
  if (key.ctrl && name === 'd') {
    if (!st.buf.length) return exit(st); // EOF on an empty line
    if (st.curIdx < st.buf.length) return redraw({ ...st, buf: cut(st.buf, st.curIdx, st.curIdx + 1) }); // forward-delete
    return { state: st, action: { type: 'none' } };
  }
  if (name === 'escape') return st.buf.length ? redraw({ ...st, buf: '', curIdx: 0 }) : { state: st, action: { type: 'none' } };

  // --- history recall -----------------------------------------------------------------
  if (name === 'up') {
    if (!st.history.length) return { state: st, action: { type: 'none' } };
    if (st.histIdx === null) return redraw(load({ ...st, draft: st.buf, histIdx: st.history.length - 1 }, st.history[st.history.length - 1]));
    if (st.histIdx > 0) return redraw(load({ ...st, histIdx: st.histIdx - 1 }, st.history[st.histIdx - 1]));
    return { state: st, action: { type: 'none' } }; // already at the oldest
  }
  if (name === 'down') {
    if (st.histIdx === null) return { state: st, action: { type: 'none' } };
    if (st.histIdx < st.history.length - 1) return redraw(load({ ...st, histIdx: st.histIdx + 1 }, st.history[st.histIdx + 1]));
    return redraw(load({ ...st, histIdx: null, draft: null }, st.draft ?? '')); // back to the live draft
  }

  // --- deletion -----------------------------------------------------------------------
  if (name === 'backspace') {
    if (key.meta || key.ctrl) { const w = wordStart(st.buf, st.curIdx); return redraw({ ...st, buf: cut(st.buf, w, st.curIdx), curIdx: w }); } // Alt/Ctrl+Backspace = word
    if (st.curIdx > 0) return redraw({ ...st, buf: cut(st.buf, st.curIdx - 1, st.curIdx), curIdx: st.curIdx - 1 });
    return { state: st, action: { type: 'none' } };
  }
  if (name === 'delete') { // forward delete
    if (st.curIdx < st.buf.length) return redraw({ ...st, buf: cut(st.buf, st.curIdx, st.curIdx + 1) });
    return { state: st, action: { type: 'none' } };
  }
  if (key.ctrl && name === 'w') { const w = wordStart(st.buf, st.curIdx); return redraw({ ...st, buf: cut(st.buf, w, st.curIdx), curIdx: w }); }
  if (key.meta && name === 'd') { const e = wordEnd(st.buf, st.curIdx); return redraw({ ...st, buf: cut(st.buf, st.curIdx, e) }); }
  if (key.ctrl && name === 'u') return redraw({ ...st, buf: st.buf.slice(st.curIdx), curIdx: 0 }); // kill to start
  if (key.ctrl && name === 'k') return redraw({ ...st, buf: st.buf.slice(0, st.curIdx) }); // kill to end

  // --- navigation ---------------------------------------------------------------------
  if (name === 'left') { if (key.meta || key.ctrl) return redraw({ ...st, curIdx: wordStart(st.buf, st.curIdx) }); return redraw({ ...st, curIdx: Math.max(0, st.curIdx - 1) }); }
  if (name === 'right') { if (key.meta || key.ctrl) return redraw({ ...st, curIdx: wordEnd(st.buf, st.curIdx) }); return redraw({ ...st, curIdx: Math.min(st.buf.length, st.curIdx + 1) }); }
  if (key.ctrl && name === 'a') return redraw({ ...st, curIdx: 0 });
  if (key.ctrl && name === 'e') return redraw({ ...st, curIdx: st.buf.length });
  if (name === 'home') return redraw({ ...st, curIdx: 0 });
  if (name === 'end') return redraw({ ...st, curIdx: st.buf.length });

  // --- printable ----------------------------------------------------------------------
  if (str && !key.ctrl && !key.meta && str >= ' ') return redraw({ ...st, buf: ins(st.buf, st.curIdx, str), curIdx: st.curIdx + str.length });

  return { state: st, action: { type: 'none' } };
}
