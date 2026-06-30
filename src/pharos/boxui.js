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

// Display width of a single code point in terminal CELLS. CJK / fullwidth / most emoji
// occupy TWO cells; combining marks and zero-width chars occupy none; everything else is
// one. A dependency-free wcwidth (covers the East-Asian + emoji blocks that matter for a
// Taiwanese user typing Chinese) — counting these as one cell is what drifts the cursor.
export function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0; // C0/C1 control
  if (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacriticals
    (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff || // zero-width / BOM
    (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f)
  ) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi, symbols
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility
    (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f) || // vertical / compat forms
    (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || // fullwidth forms
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji, symbols & pictographs
    (cp >= 0x20000 && cp <= 0x3fffd)    // CJK Ext B and beyond
  ) return 2;
  return 1;
}

// Visible width of a string in terminal CELLS (ANSI stripped, wide chars = 2). This is
// the number the box layout cares about — NOT the code-point count.
export const strWidth = (s) => {
  let w = 0;
  for (const ch of stripAnsi(String(s))) w += charWidth(ch.codePointAt(0));
  return w;
};
export const visLen = strWidth;

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
  let consumed = 0; // buf UTF-16 units before the current logical line (each \n counts as one)
  for (let li = 0; li < logical.length; li += 1) {
    const line = logical[li];
    const lineStart = rows.length; // global visual-row index where this logical line begins
    // Wrap this logical line by DISPLAY WIDTH (a wide char counts as 2 cells), tracking each
    // visual row's UTF-16 start offset (u0) and width (w). Only the very first row of the whole
    // buffer offsets by the prompt; continuations + later logical lines sit at the gutter.
    const lineRows = []; // { text, u0, w }
    if (line.length === 0) lineRows.push({ text: '', u0: 0, w: 0 });
    else {
      const chars = [...line]; // iterate by code point (surrogate-pair safe)
      let u = 0; // UTF-16 offset within the line
      let ci = 0;
      while (ci < chars.length) {
        const first = li === 0 && lineRows.length === 0;
        const cap = first ? firstCap : contCap;
        let text = ''; let w = 0; const u0 = u;
        while (ci < chars.length) {
          const cw = charWidth(chars[ci].codePointAt(0));
          if (text.length && w + cw > cap) break; // row full — wrap (always emit ≥1 char)
          text += chars[ci]; w += cw; u += chars[ci].length; ci += 1;
        }
        lineRows.push({ text, u0, w });
      }
    }
    // Place the cursor if it falls within this logical line (inclusive of its trailing edge).
    if (cursorRow === -1 && curIdx >= consumed && curIdx <= consumed + line.length) {
      const local = curIdx - consumed; // UTF-16 offset within this logical line
      for (let vi = 0; vi < lineRows.length; vi += 1) {
        const { text, u0, w } = lineRows[vi];
        const cap = li === 0 && vi === 0 ? firstCap : contCap;
        const indent = li === 0 && vi === 0 ? prefixWidth : contIndent;
        const rowEnd = u0 + text.length; // UTF-16 end offset of this row's text
        if (local <= rowEnd) {
          const colOff = strWidth(text.slice(0, local - u0)); // display cells from row start to caret
          // At a FULL row's trailing edge the caret wraps: to the next visual row if one
          // exists, else (end of buffer only) to a fresh row. Before a \n it stays put.
          if (local === rowEnd && w === cap && (vi < lineRows.length - 1 || li === logical.length - 1)) {
            if (vi < lineRows.length - 1) continue; // the next row's u0 === rowEnd → placed there at the gutter
            cursorRow = lineStart + vi + 1; cursorCol = contIndent;
          } else {
            cursorRow = lineStart + vi; cursorCol = indent + colOff;
          }
          break;
        }
      }
    }
    for (const r of lineRows) rows.push(r.text);
    consumed += line.length + 1; // skip the \n separator
  }
  if (cursorRow === -1) { cursorRow = 0; cursorCol = prefixWidth; } // empty buffer
  while (rows.length <= cursorRow) rows.push(''); // a row to hold the cursor at a wrap boundary
  return { rows, cursorRow, cursorCol };
}
