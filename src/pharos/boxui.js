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
  const rows = [];
  let cursorRow = -1;
  let cursorCol = -1;
  const logical = buf.split('\n'); // hard line breaks (Shift+Enter) split into logical lines
  let consumed = 0; // buf chars before the current logical line (each \n counts as one)
  for (let li = 0; li < logical.length; li += 1) {
    const line = logical[li];
    const lineStart = rows.length; // global visual-row index where this logical line begins
    // Char-wrap this logical line; only the very first row of the whole buffer offsets by
    // the prompt — every other row (continuations + later logical lines) sits at the gutter.
    const lineRows = [];
    if (line.length === 0) lineRows.push('');
    else for (let pos = 0; pos < line.length; pos += (li === 0 && pos === 0 ? firstCap : contCap)) {
      lineRows.push(line.slice(pos, pos + (li === 0 && pos === 0 ? firstCap : contCap)));
    }
    // Place the cursor if it falls within this logical line (inclusive of its trailing edge).
    if (cursorRow === -1 && curIdx >= consumed && curIdx <= consumed + line.length) {
      let acc = 0;
      for (let vi = 0; vi < lineRows.length; vi += 1) {
        const rlen = lineRows[vi].length;
        const cap = li === 0 && vi === 0 ? firstCap : contCap;
        const indent = li === 0 && vi === 0 ? prefixWidth : contIndent;
        const off = curIdx - consumed;
        if (off <= acc + rlen) {
          const colOff = off - acc;
          // At a FULL row's trailing edge the caret wraps: to the next visual row if one
          // exists, else (end of buffer only) to a fresh row. Before a \n it stays put.
          if (colOff === rlen && rlen === cap && (vi < lineRows.length - 1 || li === logical.length - 1)) {
            if (vi < lineRows.length - 1) { acc += rlen; continue; }
            cursorRow = lineStart + vi + 1; cursorCol = contIndent;
          } else {
            cursorRow = lineStart + vi; cursorCol = indent + colOff;
          }
          break;
        }
        acc += rlen;
      }
    }
    for (const r of lineRows) rows.push(r);
    consumed += line.length + 1; // skip the \n separator
  }
  if (cursorRow === -1) { cursorRow = 0; cursorCol = prefixWidth; } // empty buffer
  while (rows.length <= cursorRow) rows.push(''); // a row to hold the cursor at a wrap boundary
  return { rows, cursorRow, cursorCol };
}
