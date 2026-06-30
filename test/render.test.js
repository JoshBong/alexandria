import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseCode } from '../src/pharos/render.js';

test('render: prose with no fences passes through untouched', () => {
  const t = 'just a plain answer\nwith two lines';
  assert.equal(collapseCode(t), t);
});

test('render: a short code block stays verbatim', () => {
  const t = 'here:\n```js\nconst a = 1;\nconst b = 2;\n```\ndone';
  assert.equal(collapseCode(t, { maxLines: 14 }), t);
});

test('render: a long code block folds to header + preview + marker', () => {
  const body = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);
  const t = 'intro\n```python\n' + body.join('\n') + '\n```\noutro';
  const out = collapseCode(t, { maxLines: 14, preview: 6 });
  // prose preserved
  assert.match(out, /^intro/);
  assert.match(out, /outro$/);
  // header announces language + total length
  assert.match(out, /⟢ python · 30 lines \(showing 6\)/);
  // exactly the first 6 body lines are kept
  assert.match(out, /line1\nline2\nline3\nline4\nline5\nline6/);
  assert.ok(!out.includes('line7'), 'line 7 should be folded away');
  // fold marker counts the hidden remainder
  assert.match(out, /⟢ … 24 more lines folded/);
  // the raw fences are gone from the folded block (header carries the language)
  assert.ok(!out.includes('```'), 'folded block drops its fences');
});

test('render: block exactly at the threshold does NOT fold', () => {
  const body = Array.from({ length: 14 }, (_, i) => `l${i}`);
  const t = '```\n' + body.join('\n') + '\n```';
  assert.equal(collapseCode(t, { maxLines: 14 }), t);
});

test('render: unterminated fence is left untouched (no half-fold guess)', () => {
  const t = 'oops\n```js\nconst a = 1;\nnever closed';
  assert.equal(collapseCode(t), t);
});

test('render: language defaults to "code" when the fence has no info string', () => {
  const body = Array.from({ length: 20 }, (_, i) => `x${i}`);
  const t = '```\n' + body.join('\n') + '\n```';
  assert.match(collapseCode(t, { maxLines: 5, preview: 2 }), /⟢ code · 20 lines/);
});

test('render: two long blocks both fold; prose between is kept', () => {
  const a = Array.from({ length: 20 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 20 }, (_, i) => `b${i}`).join('\n');
  const t = '```js\n' + a + '\n```\nmiddle\n```py\n' + b + '\n```';
  const out = collapseCode(t, { maxLines: 5, preview: 2 });
  assert.match(out, /⟢ js · 20 lines/);
  assert.match(out, /middle/);
  assert.match(out, /⟢ py · 20 lines/);
});

test('render: style decorators are applied to markers and preview only', () => {
  const body = Array.from({ length: 20 }, (_, i) => `c${i}`).join('\n');
  const t = '```ts\n' + body + '\n```';
  const out = collapseCode(t, {
    maxLines: 5, preview: 2,
    style: { summary: (s) => `<S>${s}</S>`, code: (s) => `<C>${s}</C>` },
  });
  assert.match(out, /<S>⟢ ts · 20 lines/);
  assert.match(out, /<C>c0<\/C>/);
});

test('render: singular "1 more line folded" grammar', () => {
  const body = Array.from({ length: 8 }, (_, i) => `n${i}`).join('\n');
  const t = '```\n' + body + '\n```';
  const out = collapseCode(t, { maxLines: 5, preview: 7 });
  assert.match(out, /1 more line folded/);
});
