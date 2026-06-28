// Folder memory adapter — the open-ended, zero-setup default.
//
// Point it at ANY directory and it works: a notes folder, an Obsidian vault, a repo
// of markdown, a flat dump of text files, nested or not. It makes NO assumptions
// about structure or schema — every file is just searchable text, every path is an
// id. That's the whole idea: everyone's filesystem is shaped differently, so the
// default store adapts to the folder instead of demanding a format.
//
// search() = local term-overlap over file contents (reusing Pharos's tokenizer, so
// memory and routing agree on what a "term" is). get(id) reads a file by its
// relative path. write() drops a new note file into the folder, so written facts
// become first-class files too. No deps, no index, no service.
//
// Scale note: it walks + reads the tree on each search. Fine for a personal folder;
// a large corpus (e.g. the whole ark) should use the ark adapter (real BM25 index)
// behind the same interface — that's what the seam is for.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { tokenize } from '../../pharos/classify.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../');
const defaultRoot = join(repoRoot, '.pharos', 'memory');

const DEFAULT_EXTS = ['.md', '.markdown', '.txt', '.text', '.json', '.jsonl'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.devnexus', '.gitnexus']);

function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.isDirectory()) continue;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), exts, out);
    } else if (exts.some((x) => e.name.toLowerCase().endsWith(x))) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  return end === -1 ? content : content.slice(content.indexOf('\n', end + 1) + 1);
}

function excerptOf(content) {
  const body = stripFrontmatter(content);
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l && l !== '---');
  return (firstLine || body.trim()).slice(0, 200);
}

export function createFolderStore(opts = {}) {
  const root = resolve(opts.root || process.env.ALEXANDRIA_MEMORY_DIR || defaultRoot);
  const exts = opts.extensions || DEFAULT_EXTS;
  const writeDir = resolve(opts.writeDir || root);
  let counter = 0;

  // Resolve an id (relative path) to an absolute path, refusing escapes from root.
  const pathOf = (id) => {
    const abs = resolve(root, id);
    if (abs !== root && !abs.startsWith(root + sep)) return null;
    return abs;
  };

  return {
    source: 'folder',
    root,

    // Rank files by query-token overlap in their content. Structure-agnostic: a
    // jsonl line, a markdown note, a plain dump — all just text here.
    async search(query, { limit = 5 } = {}) {
      const qTokens = new Set(tokenize(query || ''));
      if (!qTokens.size) return [];
      const scored = [];
      for (const file of walk(root, exts)) {
        let content;
        try {
          content = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        const cTokens = new Set(tokenize(content));
        let score = 0;
        for (const t of qTokens) if (cTokens.has(t)) score += 1;
        if (score > 0) {
          scored.push({ id: relative(root, file), text: excerptOf(content), path: file, score, source: 'folder' });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    },

    async get(id) {
      const abs = pathOf(id);
      if (!abs) return null;
      try {
        const content = readFileSync(abs, 'utf8');
        return { id, text: content, path: abs, source: 'folder' };
      } catch {
        return null;
      }
    },

    // Persist a durable fact AS A FILE — keeps the store a plain folder you can open,
    // grep, or sync. Minimal frontmatter so it round-trips; body is the fact.
    async write({ text, keeper = null, tags = [] } = {}) {
      if (!text || !text.trim()) throw new Error('write requires non-empty text');
      const stamp = `${Date.now().toString(36)}-${(counter++).toString(36)}`;
      const id = `mem-${stamp}.md`;
      const fm = ['---', `ts: ${new Date().toISOString()}`];
      if (keeper) fm.push(`keeper: ${keeper}`);
      if (tags.length) fm.push(`tags: [${tags.join(', ')}]`);
      fm.push('---', '');
      mkdirSync(writeDir, { recursive: true });
      writeFileSync(join(writeDir, id), fm.join('\n') + text.trim() + '\n');
      return { id };
    },
  };
}
