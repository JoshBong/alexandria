// Slash-command autocomplete for the input box — PURE (no I/O), same split as input.js /
// menu.js: matching, ranking and the key handling live here; bin/pharos.js draws the rows.
//
// While the line is a bare `/word` (no space yet) the menu lists the commands matching what
// is typed. After `/cmd ` it lists that command's fixed argument choices (e.g. /model,
// /effort) filtered the same way. Ranking: prefix matches first, then substring matches,
// each in list order. Nothing matches → no menu, and the line behaves exactly as before.

export const MAX_ROWS = 6;

export const initSlash = () => ({ sel: 0, forBuf: null, dismissed: null });

// Prefix hits first, then the rest of the substring hits — both keep list order.
function rank(items, q, keyOf) {
  const k = q.toLowerCase();
  const pre = items.filter((it) => keyOf(it).toLowerCase().startsWith(k));
  const sub = items.filter((it) => !pre.includes(it) && keyOf(it).toLowerCase().includes(k));
  return [...pre, ...sub];
}

// commands: [{ name: '/todo', desc, args?: [{ value, desc?, current? }] }]
// → { kind: 'cmd' | 'arg', items: [{ label, desc, fill, opens }] } or null (no menu).
// fill = the line Tab/Enter writes. opens = the item has argument choices (Enter completes
// into them instead of submitting the bare command).
export function slashMatches(buf, commands) {
  const s = String(buf || '');
  const cm = /^\/(\S*)$/.exec(s);
  if (cm) {
    const items = rank(commands, cm[1], (c) => c.name.slice(1)).map((c) => ({
      label: c.name, desc: c.desc || '', fill: `${c.name} `, opens: !!(c.args && c.args.length),
    }));
    return items.length ? { kind: 'cmd', items } : null;
  }
  const am = /^(\/\S+) (\S*)$/.exec(s);
  if (am) {
    const cmd = commands.find((c) => c.name.toLowerCase() === am[1].toLowerCase());
    if (!cmd || !cmd.args || !cmd.args.length) return null;
    const items = rank(cmd.args, am[2], (a) => a.value).map((a) => ({
      label: a.value, desc: a.desc || '', fill: `${cmd.name} ${a.value}`, opens: false, current: !!a.current,
    }));
    return items.length ? { kind: 'arg', items, query: am[2] } : null;
  }
  return null;
}

// The menu for this buffer, honouring Esc-dismissal (hidden until the line changes) and
// holding the selection steady while the buffer is unchanged. A fresh buffer selects the
// `current` argument when nothing is typed after the space yet (so /model → Enter → Enter
// keeps the model); once you type part of an argument, the best match (row 0) wins.
export function slashView(sl, buf, commands) {
  if (sl.dismissed !== null && sl.dismissed === buf) return null;
  const m = slashMatches(buf, commands);
  if (!m) return null;
  const preferCurrent = m.kind === 'arg' && m.query === '';
  const sel = sl.forBuf === buf ? Math.min(sl.sel, m.items.length - 1)
    : preferCurrent ? Math.max(0, m.items.findIndex((it) => it.current)) : 0;
  return { ...m, sel };
}

// First visible row so the selection stays in a MAX_ROWS-tall window.
export function slashWindow(n, sel, max = MAX_ROWS) {
  if (n <= max) return 0;
  return Math.min(Math.max(0, sel - max + 1), n - max);
}

// One keypress while the menu is showing. Returns:
//   { sl, type: 'redraw' }              — selection moved / menu dismissed
//   { sl, type: 'fill', buf }           — replace the line with buf (Tab, or Enter on an item
//                                          that opens argument choices)
//   { sl, type: 'submit', line }        — run this line (Enter)
//   { sl, type: 'pass' }                — not a menu key; let the line editor handle it
export function slashKey(sl, key = {}, buf, view) {
  const name = key.name;
  const n = view.items.length;
  const cur = view.items[view.sel];
  const at = (sel) => ({ ...sl, sel, forBuf: buf });
  if (name === 'up') return { sl: at((view.sel - 1 + n) % n), type: 'redraw' };
  if (name === 'down') return { sl: at((view.sel + 1) % n), type: 'redraw' };
  if (name === 'tab') return { sl: initSlash(), type: 'fill', buf: cur.fill };
  if (name === 'escape') return { sl: { ...sl, dismissed: buf }, type: 'redraw' };
  if ((name === 'return' || name === 'enter') && !(key.shift || key.meta)) { // Shift/Alt+Enter = newline
    if (cur.opens) return { sl: initSlash(), type: 'fill', buf: cur.fill };
    return { sl: initSlash(), type: 'submit', line: cur.fill.trim() };
  }
  return { sl, type: 'pass' };
}
