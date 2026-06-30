// g6 — Curator: the skill LIFECYCLE that keeps self-writing (g5) from drowning. A loop
// that authors skills must also prune them, or the store fills with one-off cruft. This
// is the pruning half — pure: usage telemetry → active → stale → archived, and it ARCHIVES,
// never deletes (every transition is reversible via restore()).
//
// Pure + deterministic: `now` is injected (no Date dependency), so classification is a
// function of telemetry alone. A skill's own activity is the source of truth — a `use`
// bumps last_activity, which naturally pulls a stale/archived skill back to active.
//
// (← hermes-agent agent/curator.py + tools/skill_usage.py — usage-driven lifecycle, GC
//  by archival not deletion.)

// Thresholds are unit-agnostic — `now` and `last_activity` just need the same unit
// (days, ticks, ms). Defaults read as days.
export const DEFAULT_CURATION = { staleAfter: 14, archiveAfter: 45, keepUses: 5 };

export const STATUS = { ACTIVE: 'active', STALE: 'stale', ARCHIVED: 'archived' };

// Bump a skill's telemetry on an event (use | view | patch) and stamp last_activity.
// Pure — returns a new skill. This is what makes a used skill climb back to active.
export function touchSkill(skill = {}, kind = 'use', now = 0) {
  const counters = { use: 'uses', view: 'views', patch: 'patches' };
  const key = counters[kind] || 'uses';
  return { ...skill, [key]: (skill[key] || 0) + 1, last_activity: now };
}

// Classify one skill from its telemetry. A skill with enough uses has earned its keep and
// stays active regardless of idle time; otherwise idle span decides. Missing last_activity
// is treated as `now` (a freshly authored skill isn't instantly archived).
export function classifySkill(skill = {}, opts = {}) {
  const { staleAfter, archiveAfter, keepUses } = { ...DEFAULT_CURATION, ...opts };
  const now = opts.now || 0;
  if ((skill.uses || 0) >= keepUses) return STATUS.ACTIVE;
  const last = skill.last_activity == null ? now : skill.last_activity;
  const idle = now - last;
  if (idle >= archiveAfter) return STATUS.ARCHIVED;
  if (idle >= staleAfter) return STATUS.STALE;
  return STATUS.ACTIVE;
}

// Curate a whole skill set. Returns { skills, summary, transitions } — a NEW list with
// each skill's status reclassified, a count by status, and the list of status changes
// (for an audit log). Never drops a skill: archived skills stay in the set, restorable.
export function curate(skills = [], opts = {}) {
  const transitions = [];
  const curated = skills.map((s) => {
    const status = classifySkill(s, opts);
    if (s.status && s.status !== status) transitions.push({ name: s.name, from: s.status, to: status });
    return { ...s, status };
  });
  const summary = { active: 0, stale: 0, archived: 0 };
  for (const s of curated) summary[s.status] += 1;
  return { skills: curated, summary, transitions };
}

// Restore an archived skill: stamp it active again (archive is reversible — that's the
// whole point of archive-not-delete). Pure.
export function restore(skill = {}, now = 0) {
  return { ...skill, status: STATUS.ACTIVE, last_activity: now };
}
