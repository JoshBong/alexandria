// Answer rendering — collapse long fenced code blocks before they hit the transcript.
//
// A Keeper's answer arrives as one finished markdown blob (boats run `--output-format
// json`, no streaming yet), so the box used to dump the WHOLE thing — an 80-line code
// block buried the actual reply and scrolled the prose off the top. Claude Code / ghostty
// don't show you every byte they write; they show a compact summary you can choose to
// open. Same idea here: prose passes through untouched, but a code block longer than the
// threshold renders as a header + short preview + a "folded" marker.
//
// Pure + ANSI-free by construction (the box applies its own gutter/colour at the call
// site), with an injectable `style` so the live UI can dim the markers while tests read
// plain text. No interaction yet — preview-and-fold, not expand-on-key (that needs the
// box to track block ranges + a keybind; tracked as a follow-up). This is the shippable
// first cut: you stop drowning in code, you still see what language + how much was written.

const IDENT = (s) => s; // default style: no decoration (tests read plain text)

const SENTINEL = ''; // private-use char to fence off code spans during inline passes

// Render the common inline markdown a Keeper's answer arrives in (it's raw markdown, and a
// terminal shows `**bold**`/`[t](url)` literally otherwise). Fence-aware: lines inside a
// ``` block are left untouched (code is not prose). Pure + ANSI-free by construction — the
// caller injects decorators via `style`, so tests read plain text (identity = markers
// stripped). Handles: # headings, - * + bullets, **bold**/__bold__, *italic*/_italic_,
// `code`, and [text](url). Anything fancier (tables, nested lists) passes through verbatim.
export function mdRender(text, style = {}) {
  const b = style.bold || IDENT;
  const it = style.italic || IDENT;
  const codeSpan = style.code || IDENT;
  const link = style.link || ((t, u) => `${t} ${u}`);
  const bullet = style.bullet || IDENT;
  const heading = style.heading || IDENT;
  const inline = (str) => {
    const spans = [];
    str = str.replace(/`([^`]+)`/g, (_, c) => { spans.push(c); return `${SENTINEL}${spans.length - 1}${SENTINEL}`; }); // protect code spans
    str = str.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => link(t, u));
    str = str.replace(/\*\*([^*]+)\*\*/g, (_, t) => b(t));
    str = str.replace(/__([^_]+)__/g, (_, t) => b(t));
    str = str.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, (_, pre, t) => `${pre}${it(t)}`);
    str = str.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, (_, pre, t) => `${pre}${it(t)}`);
    return str.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_, k) => codeSpan(spans[+k]));
  };
  let inFence = false;
  return String(text ?? '').split('\n').map((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) return heading(inline(h[2]));
    const bm = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bm) return `${bm[1]}${bullet('•')} ${inline(bm[2])}`;
    return inline(line);
  }).join('\n');
}

// Collapse fenced ``` code blocks in `text` whose body exceeds `maxLines`. Short blocks
// and all prose are returned verbatim. opts:
//   maxLines — body line count above which a block folds (default 14)
//   preview  — how many leading body lines to keep visible before the fold (default 6)
//   style    — { summary, code } decorators (default identity); summary marks the
//              header/fold lines, code marks kept preview lines.
// Returns the rewritten string. Fence lines themselves (```lang / ```) are dropped from a
// folded block — the header carries the language — so the collapsed form reads as one
// clean unit, not an empty pair of fences around a gap.
export function collapseCode(text, opts = {}) {
  const maxLines = opts.maxLines ?? 14;
  const preview = opts.preview ?? 6;
  const style = opts.style || {};
  const sum = style.summary || IDENT;
  const code = style.code || IDENT;
  const src = String(text ?? '');
  if (!src.includes('```')) return src; // fast path: no fences, nothing to do

  const lines = src.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const open = /^(\s*)```(.*)$/.exec(line);
    if (!open) { out.push(line); i += 1; continue; }

    // Found an opening fence — scan to the matching closing fence.
    const indent = open[1];
    const lang = open[2].trim();
    const body = [];
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      if (/^\s*```\s*$/.test(lines[j])) { closed = true; break; }
      body.push(lines[j]);
      j += 1;
    }

    // Unterminated fence (no closing ```): leave the whole tail untouched rather than
    // guess where it ends — collapsing a half-block would be worse than showing it.
    if (!closed) { out.push(line); i += 1; continue; }

    if (body.length <= maxLines) {
      // Short enough — keep the block exactly as written.
      for (let k = i; k <= j; k += 1) out.push(lines[k]);
    } else {
      const label = lang || 'code';
      const hidden = body.length - preview;
      out.push(indent + sum(`⟢ ${label} · ${body.length} lines ${preview ? `(showing ${preview})` : '(collapsed)'}`));
      for (let k = 0; k < preview; k += 1) out.push(indent + code(body[k]));
      out.push(indent + sum(`⟢ … ${hidden} more line${hidden === 1 ? '' : 's'} folded`));
    }
    i = j + 1; // resume after the closing fence
  }
  return out.join('\n');
}
