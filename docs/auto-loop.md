# Auto-Loop — implementation plan

> Status: design (not built). A loop is **a task with a done-condition.** Pharos
> already runs *one* turn against a warm Keeper (`handle()`); the auto-loop runs a
> *sequence* of turns toward a goal, replanning as the human injects ideas, until
> the goal's done-condition holds or a guard trips.

## 1. The model (settled)

- A loop is an **ordered list of steps** plus a **done-condition**. Steps are
  removed as completed; when the list satisfies the done-condition, the loop exits.
- **Each step runs an inner cycle:** `do → verify-against-ground-truth → adjust`,
  bounded by an attempt budget. Ground truth is domain-pluggable (Ptah: tests;
  Thoth: source/rubric; Ra: inbox/calendar).
- **Mid-step is sacred.** Inputs never interrupt a running step. They buffer.
- **The boundary is the only checkpoint.** After a step finishes, in order:
  1. freshness check → reseed if drifting (the canary, now machine-checked)
  2. drain the input buffer (batched) → elaborate → replan the unlocked tail
  3. pick the next ready step
  A quiet boundary (empty buffer, healthy context) just advances — near-zero cost.
- **One structure, not two.** No separate stack. A blocker is just an input
  inserted right after the cursor; depth-first handling falls out of insert-just-ahead.
- **Done steps are a locked prefix.** Replan only reorders the unlocked tail.
  Reopening a done step (rework / the "in the past" case) is an *explicit unlock* —
  rare, surfaced, never silent.

## 2. Where it sits

```
runLoop(goal)                         ← NEW: the loop driver (src/loop/run.js)
  └─ plan(goal) / replan(plan, inputs)   ← NEW: the planner (one fn, called repeatedly)
  └─ for each step:
       runStep(step)                     ← NEW: inner do→verify→adjust
         └─ handle(stepPrompt, opts)     ← REUSE: existing Pharos turn (src/pharos.js)
                                            (routing, warm session, canary/early gates,
                                             handoff/reseed, memory recall — all already built)
```

The loop is a thin orchestrator. It does **not** re-implement session management,
compaction, or memory — it calls `handle()` per step and reads the signals
`handle()` already returns (`compacting`, `redone`, `degraded`, `contextTokens`).

## 3. State (on disk, under `.pharos/loops/<loopId>/`)

Mirrors the existing `.pharos/` convention (gitignored, anchored to repoRoot).

- `plan.json` — the living plan. Re-read each boundary.
- `inbox.jsonl` — append-only input buffer (async injections land here).
- `log.jsonl` — per-step/per-boundary events (reuses `logEvent` shape from events.js).

```jsonc
// plan.json
{
  "loopId": "…",
  "goal": "make me an itinerary for next week",
  "done": "every day Jul 5–14 has lodging + transport confirmed",  // checkable predicate
  "type": "bounded",            // bounded | open-ended (rare)
  "cursor": 3,                  // index of the active step
  "steps": [
    { "id": "s1", "intent": "…", "deps": [], "touches": ["…"],
      "status": "done", "locked": true, "attempts": 1 },
    { "id": "s4", "intent": "…", "deps": ["s2"], "touches": ["…"],
      "status": "pending", "locked": false, "attempts": 0, "origin": "input:i2" }
  ]
}
```

```jsonc
// inbox.jsonl — one line per raw injection
{ "id": "i2", "raw": "add the safari lodges", "ts": "…", "elaborated": null }
```

## 4. Components to build

| # | Component | New file | Reuses |
|---|-----------|----------|--------|
| 1 | Loop driver | `src/loop/run.js` | `handle()`, events.js |
| 2 | Planner (`plan` + `replan`) | `src/loop/plan.js` | `opts.ask` LLM seam, memory `store.search` |
| 3 | Step runner (`do→verify→adjust`) | `src/loop/step.js` | `handle()`, per-Keeper verify |
| 4 | Input elaborator | `src/loop/elaborate.js` | `opts.ask` |
| 5 | Plan store (read/write/lock) | `src/loop/plan-store.js` | `.pharos/` path convention |
| 6 | Inbox (append/drain) | `src/loop/inbox.js` | append-only file like events.js |
| 7 | Guards (watchdog/budget/ceiling) | `src/loop/guards.js` | — |
| 8 | Domain verify table | extend `src/pharos/keepers.js` | adds `verify` per Keeper |

Mock-first, like the rest of the project: every LLM seam (`plan`, `elaborate`,
`verify`) is injectable so the loop's control flow is testable offline with no
`claude` spawn — same discipline as `opts.classify` / `opts.compose` / `opts.runTurn`.

## 5. The input elaborator (the "full potential" piece)

Raw input never hits the planner. It's elaborated into intent first — and the
output **exposes the seam** between what you said and what it's guessing, so *you*
set the elaboration depth at a glance instead of the model guessing a sweet spot.

Elaboration output (per input):
```
You said:    <verbatim>
Entailed:    <derived, confident — each point cites a source: file / goal / prior decision>
Assuming:    <inferred, you didn't say it — vetoable in one glance>
Fork:        <irreversible choice that can't be derived — the only thing worth asking about>
```

Rules:
- **Unpack freely, extrapolate never.** Entailed = consequences of your words +
  context. Assuming = anything justified only by "best practice / users usually want."
- **Sourcing gate:** an Entailed point must trace to evidence, or it demotes to Assuming.
- **Calibrate toward Assuming.** When unsure, bucket it as an assumption.
  Under-confidence is free (you glance + approve); over-confidence is silent drift.
- **Depth ∝ reversibility:** elaborate deep where wrong-is-cheap (a color), shallow
  where wrong-is-expensive (data model, API contract).
- An elaborated input may **decompose into several steps** — the planner weaves them
  all into the tail, not just one item.
- Run elaboration **on arrival, during the running step** (it doesn't touch the
  step), so the buffer holds ready-to-place intent by the boundary.

## 6. The planner (`plan` = first call, `replan` = every later call — same fn)

- Input: `goal`, `done`, current `plan` (locked prefix + tail), drained+elaborated inbox.
- Output: a revised tail ordering. Locked prefix is **frozen** — cannot be reordered.
- **Revise, don't regenerate.** Touch only what the new input affects; keep the rest
  stable (no gratuitous step-id churn, never move the in-flight step).
- To force rework of a done step, the planner must emit an explicit
  `unlock(stepId)` — surfaced to the human, not applied silently. Before redoing,
  re-ground: re-read what was actually built for that step (scoped, not full history).
- First call: empty prefix, full goal → produces the initial ordered list + the
  `done` predicate. If the goal has no checkable predicate ("design this"), the
  planner **proposes** acceptance criteria and asks once to confirm.

## 7. Boundary control flow (`src/loop/run.js`)

```
loadPlan()
while (true):
  step = nextReady(plan)                 // deps satisfied, status pending
  if (!step):                            // nothing ready
     if (doneConditionHolds(plan)) exit SUCCESS
     if (allRemainingBlocked(plan))  exit STUCK
  result = runStep(step)                 // do → verify → adjust (attempt budget + plateau, g1)
  if (result.done):
     verdict = reviewStep(step, result)   // independent reviewer gates the lock (g4)
     if (verdict.approved) lockStep()     // done + reviewed → locked prefix grows
     else park(step, verdict.notes)       // producer never self-ratifies
  else park(step)
  emitDrift(plan, result)                 // typed goal-drift alerts at the boundary (g2)
  if (opts.selfwrite) selfWrite(snapshot) // forked review authors/patches skills (g5)

  // ---- BOUNDARY ----
  if (freshnessLow())                     // contextTokens / canary signal from handle()
     reseed()                             // REUSE handoff.js + early-gate machinery
  inputs = drainInbox()                   // batched
  if (inputs.length):
     elaborated = inputs.map(elaborate)   // (already elaborated on arrival; finalize)
     plan = replan(plan, elaborated)      // reorder unlocked tail only
  if (guardsTrip(plan)) exit STUCK        // watchdog / ceiling
  savePlan(plan)
```

## 8. Guards / termination

Two exit categories: **done** (success) and **stuck** (surfaced failure).

| Guard | Scope | Fires when | Action |
|-------|-------|-----------|--------|
| Attempt budget (N) | one step | verify fails N times | park the step, move on |
| Progress watchdog (K) | the plan | K boundaries, no step → done/parked | **halt + surface** (the real infinite-loop guard) |
| Parked ceiling (X) | the plan | > X steps parked | halt + escalate |
| Hard ceiling | everything | total-step / wall-clock cap | halt (backstop, never expected to hit) |
| Human STOP | everything | injected stop | halt immediately (the one interrupt that preempts a step) |

The watchdog is non-negotiable: per-step budgets stop one step spinning; only the
watchdog stops the *plan* spinning (replan churn, park/unpark oscillation). Parking
counts as progress, so a genuinely hard step doesn't trip it — a loop going nowhere does.

## 9. Domain pluggability

Each Keeper gets a `verify` describing its ground truth (extend `keepers.js`):
- **Ptah (code):** run tests / compile. `do→test→fix`.
- **Thoth (classwork):** check output against syllabus/source/rubric.
- **Ra (personal):** check against inbox/calendar reality (the spec-vs-reality rule
  as an executable step — "is it *actually* booked").

Same `do → verify → adjust` shape everywhere; only the verify target differs. The
step runner is domain-agnostic; it calls `keeper.verify`.

## 10. Phased rollout

- **P0 — control flow, mock. ✅ BUILT.** `run.js` + `plan-store.js` + `inbox.js` with
  injected mock `plan`/`elaborate`/`verify`/`handle`. Proven: ordered run, remove-on-done,
  buffer→replan at boundary, locked prefix, all guards, done/stuck exits. No `claude`.
- **P1 — live planner + elaborator. ✅ BUILT.** `plan.js`/`elaborate.js` parse the model's
  JSON (via `loop/parse.js`) into steps + the seam (said/entailed/assuming/fork); fail-soft
  to the deterministic decomposition on junk. Live deps dropped (rely on emit order).
- **P2 — live step runner over Pharos. ✅ BUILT.** `loop/live.js` `makeLiveHandle` runs
  `runStep`'s `do` against `handle()` on a THREADED warm reg (Keeper sessions persist
  across steps); freshness reseed reads handle()'s signals.
- **P3 — domain verify + multi-Keeper. ✅ BUILT.** `makeDomainVerify` dispatches: a step
  check-command (Ptah runs tests) → a per-Keeper `verifiers[keeper]` → the frozen contract
  → structural. `makeLiveReview` routes g4 to a different Keeper's model.
- **P4 — async injection UX. ✅ file-transport BUILT.** `bin/loop.js` (`alexandria-loop`)
  + `loop/session.js` run a goal live with a progress printer; `--say` appends to
  `inbox.jsonl` so input lands mid-loop (drained at the next boundary). Non-blocking stdin
  inside the pinned-box TUI itself remains the one open UX refinement.

The live stack lives in `loop/live.js` (adapters), `loop/session.js` (`runLiveLoop` +
event formatter + `injectInput`), `memory/skills.js` (the skill store g5 writes / g6
prunes), and `bin/loop.js` (CLI). Every adapter takes its `claude`-spawning primitive as
an injectable, so the whole live stack is proven offline (`test/live.test.js`,
`test/session.test.js`) and `alexandria-loop --mock` runs the full pipeline with no boat.

## 12. Grafted mechanisms (hermes-agent + claude-code-harness)

Built **on top of** the canary + prewarmed warm Keepers — never replacing them (both
rival harnesses lack a canary; that's the moat). Each is a pure/injectable module proven
offline (no `claude` spawn in tests); live wiring rides the same P1–P4 seams.

| # | Module | What it adds | Seam | Source |
|---|--------|--------------|------|--------|
| g1 | `loop/plateau.js` | Jaccard over the targets each retry touches; sustained overlap parks a *thrashing* step early — a second kill-switch beside the attempt budget | wired in `step.js` (`reason:'plateau'`) | harness `detect-review-plateau.sh` |
| g2 | `loop/drift.js` | Five typed **goal-drift** alerts (scope-creep / time-overrun / repeated-failure / cost / high-risk-path) — complements the canary's *quality*-drift | emitted at the boundary in `run.js` | harness `progress-detect-drift.sh` |
| g3 | `loop/contract.js` | Freeze each step into `{ definition_of_done, checks[], max_iterations, risk_flags[] }` at plan time; completion is checked against the frozen contract, not free text | `plan.js` compiles, `step.js` verifies | harness `sprint_contract.go` |
| g4 | `loop/review.js` | A **different** warm Keeper gives an independent read-only verdict before a done step locks — the producer never self-ratifies | `opts.review` gate in `run.js` | harness `reviewer.md` |
| g5 | `loop/selfwrite.js` | A **forked** review authors/patches reusable *skills* through a memory+skill store ONLY — never the live plan. Three anti-poisoning rules enforced on output: no transient/env-specific claims, class-level naming, patch-before-create | `opts.selfwrite` at the boundary in `run.js` | hermes `background_review.py` |
| g6 | `memory/curator.js` | Usage telemetry → active→stale→archived skill lifecycle (archive, never delete) — self-writing without self-pruning drowns | pure (consumed by the skill store) | hermes `curator.py` |

Anti-poisoning (g5) is enforced on the fork's **output**, not by trusting its prompt: a
candidate skill whose name or body trips a poison pattern (a `/Users/...` path, an IP, "is
broken", "permission denied", "failed") is dropped with a logged reason. The fork is
whitelisted structurally — `selfWrite` is handed only the skills store and a read-only
snapshot, so it *cannot* reach the plan or transcript.

g7 (per-attempt worktree isolation) is **deferred to P2+** — it needs live code-writing
Keepers to be worth the git overhead.

## 11. Open decisions

1. **Who writes the done-condition** — planner proposes + you confirm, or you always
   state it up front?
2. **Async input transport** — typed into the same TUI (needs the non-blocking-stdin
   change, P4), or a separate `alexandria-input` writer to `inbox.jsonl`?
3. **Reseed vs replan order at a boundary** when both fire — current plan: reseed
   first (clean context), then replan into the fresh session.
