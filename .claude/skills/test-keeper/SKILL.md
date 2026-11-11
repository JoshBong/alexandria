---
name: test-keeper
description: Write and run unit tests for a JavaScript/Node module using the built-in node:test runner (zero deps). Use when asked to write tests, add coverage, or verify a module behaves correctly. Ptah's tool — scoped to the code domain.
---

# test-keeper

The crystallized "write tests, run tests" workflow for Alexandria's code. This is
the first tool produced by Alexandria's crystallize-on-earn principle: a recurring
judgment task (writing good tests) captured as a reusable procedure so it's done
the same way every time instead of re-improvised.

Belongs to **Ptah** (the code Keeper). Lives in the repo, so it's available to any
agent working in the codebase.

## Procedure

1. **Read the module's exports.** Know the real signatures and return shapes before
   asserting anything — never test imagined behavior.
2. **Pick cases that matter**, in this order:
   - the happy path (the thing it's for),
   - each decision branch / edge (floor, stickiness, hysteresis, fallback…),
   - one regression guard per bug you've already fixed.
3. **Write `test/<module>.test.js`** using `node:test` + `node:assert/strict`. One
   `test(...)` per behavior, named as a sentence ("stickiness outranks the floor…").
4. **Keep tests deterministic and side-effect-free.** No network, no real API. For
   anything that writes (files, sessions), pass a temp path or use the module's
   `mock` path — and if the module isn't injectable, make it so (e.g. add an
   optional path param). Improving testability is part of the job.
5. **Run** `npm test` (`node --test test/*.test.js`). Report pass/fail counts and,
   on failure, the assertion + the actual value.

## Conventions

- Zero dependencies — `node:test` only (matches the devnexus convention).
- Test files are `test/*.test.js`; harness/sim scripts are NOT (so the runner skips
  them).
- `assert/strict`. Prefer `assert.equal` / `assert.deepEqual` / `assert.match`.
- A failing assert should say what was expected vs. actual (pass a message).

## First application (dogfood)

This tool was first used to test Alexandria itself: `classify.test.js`,
`registry.test.js`, `keeper.test.js`, `pharos.test.js` — covering routing,
stickiness, hysteresis, intake fallback, the registry round-trip, and warm-session
reuse. Writing them surfaced one real improvement: `registry.js` now takes an
optional path, so tests never clobber the live `.pharos/registry.json`.
