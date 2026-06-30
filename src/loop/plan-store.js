// The plan store — read/write the living plan, plus the locking discipline.
//
// `plan.json` is the loop's single source of truth: the ordered step list, the
// done-condition, and the cursor. It is re-read at each boundary and rewritten
// after each step. Done steps form a LOCKED PREFIX — replan may reorder the
// unlocked tail but can never touch a locked step. Reopening a locked step is an
// explicit `unlockStep`, never silent (see docs/auto-loop.md §1, §6).
//
// Pure over a path/dir (opts.dir | opts.file), like registry.js — no hidden state.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loopPaths } from './paths.js';

// A fresh, empty plan for `goal`. The planner fills `steps` + `done` on its first call.
export function freshPlan(loopId, goal, opts = {}) {
  return {
    loopId,
    goal,
    done: opts.done || null, // checkable predicate; planner proposes if absent
    type: opts.type || 'bounded', // bounded | open-ended (rare)
    cursor: 0,
    inboxDrained: 0, // how many inbox lines have been folded into the plan
    steps: [],
  };
}

function fileFor(plan, opts) {
  if (opts.file) return opts.file;
  return loopPaths(plan.loopId ?? opts.loopId, opts).plan;
}

// Load the plan for a loop. Returns null if it doesn't exist yet (first run).
export function loadPlan(loopId, opts = {}) {
  const file = opts.file || loopPaths(loopId, opts).plan;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function savePlan(plan, opts = {}) {
  const file = fileFor(plan, opts);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(plan, null, 2) + '\n');
  return file;
}

// Mark a step done and lock it (the locked prefix grows). Idempotent.
export function lockStep(plan, stepId) {
  const s = plan.steps.find((x) => x.id === stepId);
  if (s) {
    s.status = 'done';
    s.locked = true;
  }
  return plan;
}

// Explicitly reopen a step for rework — the ONLY way a terminal step re-enters the
// tail. Two cases: a DONE step (locked) being redone, or a PARKED step (budget spent,
// status 'parked', never locked) being retried after the blocker clears. Both reset to
// pending. Surfaced by the caller, never applied silently (docs §6). Returns true if a
// step was actually reopened.
export function unlockStep(plan, stepId) {
  const s = plan.steps.find((x) => x.id === stepId);
  if (s && (s.locked || s.status === 'parked')) {
    s.locked = false;
    s.status = 'pending';
    return true;
  }
  return false;
}

// The frozen prefix vs. the mutable tail — replan operates only on the tail.
export const lockedPrefix = (plan) => plan.steps.filter((s) => s.locked);
export const unlockedTail = (plan) => plan.steps.filter((s) => !s.locked);
