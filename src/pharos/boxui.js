// Pure layout + measurement helpers for the pinned input box (bin/pharos.js).
//
// No I/O lives here — only the cursor math — so the tricky parts are unit-testable
// offline. The earlier hand-rolled box was reverted because its cursor math (absolute
// ESC 7/8 save/restore across a scroll) was wrong and untestable; pulling the math out
// here is the fix. bin/pharos.js does the actual terminal writes around these.
//
// The box pins to the bottom BOX_H rows using a terminal scroll region (DECSTBM):
// answers scroll in rows 1..scrollBottom, the box stays put below. Output is written
// with the bottom-anchored scroll idiom (write at scrollBottom, LF to scroll, reprint),
// so nothing the box does depends on a saved absolute position — no staircase.

// Strip our SGR colour sequences to measure VISIBLE width. The ⟡ marker and the
// colour codes must not count as input width — that exact miscount is what made plain
// readline mis-wrap and the cursor drift.
export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
export const visLen = (s) => [...stripAnsi(s)].length;

// 1-based row numbers for a terminal `rows` tall with the box occupying the bottom
// BOX_H rows. scrollBottom is the last row of the scrolling output region.
export function layout(rows, boxH = 3) {
  const r = Math.max(boxH + 1, Math.floor(rows) || 24);
  return {
    rows: r,
    boxH,
    scrollBottom: r - boxH, // last scrolling row (region is 1..scrollBottom)
    topRuleRow: r - boxH + 1,
    inputRow: r - boxH + 2,
    botRuleRow: r,
  };
}

// Horizontal window for the single-line input. Given the editable width `avail`,
// return the visible slice of `buf` that keeps the cursor (curIdx) on screen, plus the
// cursor's offset within that slice. Keeps the end + cursor in view when buf overflows.
export function inputWindow(buf, curIdx, avail) {
  buf = String(buf);
  curIdx = Math.max(0, Math.min(curIdx, buf.length));
  if (avail <= 0) return { shown: '', start: 0, offset: 0 };
  if (buf.length <= avail) return { shown: buf, start: 0, offset: curIdx };
  let start = curIdx > avail - 1 ? curIdx - (avail - 1) : 0;
  start = Math.max(0, Math.min(start, buf.length - avail));
  return { shown: buf.slice(start, start + avail), start, offset: curIdx - start };
}

// How many visual rows a logical line occupies when wrapped at `cols` (used to reason
// about output that may wrap; the live writer relies on the terminal to wrap, this is
// for tests/decisions).
export function visualRows(line, cols) {
  if (!cols || cols <= 0) return 1;
  return Math.max(1, Math.ceil(visLen(line) / cols));
}

// Wrap the input buffer across as many visual rows as it needs, so long input flows to
// the NEXT LINE instead of scrolling sideways. The first row leaves room for the prompt
// (`prefixWidth` cols); continuation rows are flush-left at `contIndent` (so wrapped text
// sits under the marker, NOT pushed past it). Returns the row strings plus the cursor's
// (row, col) for curIdx. char-wrap (predictable) — not word-wrap.
export function wrapInput(buf, curIdx, prefixWidth, contIndent, cols) {
  buf = String(buf);
  curIdx = Math.max(0, Math.min(curIdx, buf.length));
  const firstCap = Math.max(1, cols - prefixWidth);
  const contCap = Math.max(1, cols - contIndent);
  const rows = [buf.slice(0, firstCap)];
  for (let i = firstCap; i < buf.length; i += contCap) rows.push(buf.slice(i, i + contCap));
  let cursorRow;
  let cursorCol;
  if (curIdx < firstCap) {
    cursorRow = 0;
    cursorCol = prefixWidth + curIdx;
  } else {
    const rem = curIdx - firstCap;
    cursorRow = 1 + Math.floor(rem / contCap);
    cursorCol = contIndent + (rem % contCap);
  }
  while (rows.length <= cursorRow) rows.push(''); // a row to hold the cursor at a wrap boundary
  return { rows, cursorRow, cursorCol };
}
