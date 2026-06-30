// The skill store — the memory+skill capability g5's self-writing fork writes through,
// and the surface g6's curator prunes. A skill is one `.md` file: frontmatter carries
// the lifecycle telemetry (uses / views / patches / last_activity / status), the body is
// the reusable capability. Same flat-file philosophy as the folder memory adapter — open
// it, grep it, sync it; no index, no service, no deps.
//
// Interface (what selfWrite + the curator call):
//   list()                       -> [{ name, body, uses, views, patches, last_activity, status }]
//   get(name)                    -> one record | null
//   create({ name, body })       -> write a new skill (status active, stamped now)
//   patch(name, { body })        -> update body, bump patches + last_activity
//   touch(name, kind)            -> bump use/view/patch telemetry (curator.touchSkill)
//   curate()                     -> reclassify active→stale→archived in place (never deletes)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { touchSkill, curate as curateSkills } from './curator.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../');
const defaultRoot = join(repoRoot, '.pharos', 'skills');

// Class-level slug — generic, reusable key (kept local so memory/ never imports loop/).
const slug = (name) =>
  String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');

// A skill file = frontmatter (flat key: value) + body. Tiny serializer/parser — no YAML
// dep, mirroring the folder adapter's minimal-frontmatter convention.
function serialize(rec) {
  const fm = [
    '---',
    `name: ${rec.name}`,
    `status: ${rec.status || 'active'}`,
    `uses: ${rec.uses || 0}`,
    `views: ${rec.views || 0}`,
    `patches: ${rec.patches || 0}`,
    `last_activity: ${rec.last_activity || 0}`,
    '---',
    '',
  ];
  return fm.join('\n') + (rec.body || '').trim() + '\n';
}

function parse(content, name) {
  const rec = { name, body: content, status: 'active', uses: 0, views: 0, patches: 0, last_activity: 0 };
  if (!content.startsWith('---')) return rec;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return rec;
  const head = content.slice(3, end);
  for (const line of head.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'name' || k === 'status') rec[k] = v.trim();
    else if (k in rec) rec[k] = Number(v) || 0;
  }
  rec.body = content.slice(content.indexOf('\n', end + 1) + 1).trim();
  return rec;
}

export function createSkillStore(opts = {}) {
  const root = resolve(opts.dir || process.env.ALEXANDRIA_SKILLS_DIR || defaultRoot);
  // `now` is injectable for deterministic curation/telemetry in tests; live uses the clock.
  const clock = opts.now || (() => Date.now());

  const fileOf = (name) => join(root, `${slug(name)}.md`);
  const readRec = (name) => {
    const f = fileOf(name);
    if (!existsSync(f)) return null;
    try {
      return parse(readFileSync(f, 'utf8'), slug(name));
    } catch {
      return null;
    }
  };
  const writeRec = (rec) => {
    mkdirSync(root, { recursive: true });
    writeFileSync(fileOf(rec.name), serialize({ ...rec, name: slug(rec.name) }));
  };

  return {
    source: 'skills',
    root,

    async list() {
      if (!existsSync(root)) return [];
      const out = [];
      for (const f of readdirSync(root)) {
        if (!f.endsWith('.md')) continue;
        const rec = readRec(f.replace(/\.md$/, ''));
        if (rec) out.push(rec);
      }
      return out;
    },

    async get(name) {
      return readRec(name);
    },

    async create({ name, body } = {}) {
      const rec = { name: slug(name), body, status: 'active', uses: 0, views: 0, patches: 1, last_activity: clock() };
      writeRec(rec);
      return { name: rec.name, action: 'create' };
    },

    // Patch an existing skill (or create it if it's gone) — bump patches + last_activity.
    async patch(name, { body } = {}) {
      const existing = readRec(name) || { name: slug(name), uses: 0, views: 0, patches: 0 };
      const rec = { ...existing, name: slug(name), body: body ?? existing.body, status: 'active', patches: (existing.patches || 0) + 1, last_activity: clock() };
      writeRec(rec);
      return { name: rec.name, action: 'patch' };
    },

    // Record usage telemetry — a `use` is what climbs a stale skill back to active.
    async touch(name, kind = 'use') {
      const existing = readRec(name);
      if (!existing) return null;
      writeRec(touchSkill(existing, kind, clock()));
      return { name: slug(name), kind };
    },

    // Run the curator over the whole set and persist the new statuses IN PLACE — archived
    // skills keep their file (restorable), they're just marked. Returns the summary.
    async curate(curOpts = {}) {
      const all = await this.list();
      const { skills, summary, transitions } = curateSkills(all, { now: clock(), ...curOpts });
      for (const s of skills) writeRec(s);
      return { summary, transitions };
    },
  };
}
