// /todo — read, add, and check off items in the operator's own TODO.md, from the TUI.
//
// The first consumer of the P2 storage rails: Alexandria owns NO todo list — it reads
// and edits the file the user already keeps (e.g. a TODO.md in their notes), located by the
// `todoPath` setting. Nothing here assumes a schema beyond GitHub-flavored task lines
// (`- [ ]` / `- [x]`, any indent); everything else in the file — headings, prose,
// frontmatter — passes through untouched. Edits are surgical: toggling a box rewrites
// exactly one line; adding an item appends under one well-known section.
//
// Pure functions over the file's text; the fs read/write lives in the two thin
// entrypoints at the bottom (injectable for tests).

import { readFileSync, writeFileSync } from 'node:fs';

const TASK_RE = /^(\s*)- \[( |x|X|~)\] (.*)$/;

// Every task line in the file, with the heading it sits under. `open` = an unchecked
// box; `n` numbers the OPEN items 1..N (what the user sees and refers to).
export function parseTodos(md = '') {
  const items = [];
  let section = '';
  let n = 0;
  String(md).split('\n').forEach((line, i) => {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { section = h[1].trim(); return; }
    const m = line.match(TASK_RE);
    if (!m) return;
    const open = m[2] === ' ';
    items.push({ line: i, text: m[3].trim(), open, section, n: open ? ++n : 0 });
  });
  return items;
}

// Check off the Nth OPEN item (1-based, the number parseTodos assigned). Returns
// { md, item } with exactly that line rewritten, or { error } when N is out of range.
export function checkOff(md = '', n = 0) {
  const item = parseTodos(md).find((t) => t.open && t.n === Number(n));
  if (!item) return { error: `no open item #${n}` };
  const lines = String(md).split('\n');
  lines[item.line] = lines[item.line].replace('- [ ]', '- [x]');
  return { md: lines.join('\n'), item };
}

// Append a new open item under the `## Inbox — alexandria` section (created before
// the first `##` heading if missing, so it surfaces at the top of the user's list
// rather than sinking to the bottom of a long file).
export const INBOX_HEADING = '## Inbox — alexandria';

export function addTodo(md = '', text = '', { date = '' } = {}) {
  const entry = `- [ ] ${String(text).trim()}${date ? ` (added ${date})` : ''}`;
  const lines = String(md).split('\n');
  const at = lines.findIndex((l) => l.trim() === INBOX_HEADING);
  if (at !== -1) {
    // Insert right after the heading (and any blank line following it).
    let i = at + 1;
    while (i < lines.length && !lines[i].trim()) i += 1;
    lines.splice(i, 0, entry);
    return lines.join('\n');
  }
  // No inbox yet — create it above the first `##` section (below any title/frontmatter).
  const firstSection = lines.findIndex((l) => /^##\s/.test(l));
  const block = [INBOX_HEADING, '', entry, ''];
  if (firstSection === -1) return [...lines, '', ...block].join('\n');
  lines.splice(firstSection, 0, ...block);
  return lines.join('\n');
}

// ---- thin fs entrypoints (bin wiring calls these; tests inject read/write) ----

export function loadTodos(path, { read = (p) => readFileSync(p, 'utf8') } = {}) {
  const md = read(path);
  return { md, items: parseTodos(md) };
}

export function saveTodos(path, md, { write = (p, s) => writeFileSync(p, s) } = {}) {
  write(path, md);
}
