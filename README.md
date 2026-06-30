# Alexandria

A personal AI orchestration layer on top of Claude Code.

> **Pharos routes · Keepers hold · Alexandria remembers.**

One entry point (**Pharos**, a stateless router) sends each prompt to a persistent,
warm per-domain session (a **Keeper**) so context never dilutes. When a Keeper fills
or drifts, it flushes durable facts to a memory substrate, writes a pointer-handoff,
and reseeds — so quality and continuity survive compaction. Runs on a Claude Code
subscription via hooks + MCP; no per-token API, no web scraping.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/JoshBong/alexandria/main/install.sh | bash
```

Or straight from npm + GitHub:

```bash
npm i -g github:JoshBong/alexandria
```

**Prerequisites:** Node 18+ and the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
(`claude`) installed and logged in. Alexandria spawns Keepers as `claude` sessions, so a working,
authenticated `claude` on your `PATH` is all the model access it needs.

Then:

```bash
alexandria          # start the router — type, and the right Keeper answers
```

## The Keepers (domains, named for Egyptian gods)

| Keeper | Domain | Why |
|--------|--------|-----|
| **Ptah** | `code` | craftsman-creator god — building, engineering, the repo |
| **Ra** | `personal` | the sun at the center — life, schedule, travel |
| **Thoth** | `classwork` | scribe of wisdom — study, courses, research |
| **Horus** | `career` | the far-seeing Eye — offers, recruiting, professional |
| **Anubis** | `intake` | threshold guardian — catch-all for new/unrouted topics |

Pharos classifies each prompt with a cheap model and hands it to the matching Keeper. Keepers
are prewarmed at startup, so the first real question lands on a session that's already loaded its
persona and context.

## What makes it different

- **Warm Keepers, not one diluting thread.** Each domain keeps its own persistent session.
  Switching topics doesn't poison context, and a code question never replays your travel history.
- **A canary against silent drift.** Every Keeper turn carries a canary; when it stops appearing,
  the session has drifted past the point where the answer can be trusted — Alexandria catches it
  and reseeds before quality slides into auto-compaction. (The rival open-source harnesses don't
  have this.)
- **A self-driving auto-loop.** `alexandria-loop "<goal>"` plans a goal into steps, runs each
  against a warm Keeper, and only locks a step once an *independent* Keeper reviews it. It detects
  thrash (Jaccard plateau), typed goal-drift, and a frozen done-condition — and a **forked** review
  authors reusable skills from what it learned, without ever touching the live conversation.
- **Memory substrate.** Durable facts flush out of a filling Keeper and reseed the next session,
  so continuity survives compaction.

## Usage

```bash
alexandria                       # interactive router (TUI)
alexandria --mock                # offline: routing + switching, no model calls
alexandria --no-prewarm          # skip the startup Keeper warmup

alexandria-loop "<goal>"         # run a goal as a live, self-driving Keeper loop
alexandria-loop "<goal>" --mock  # offline smoke: full pipeline, no model calls
alexandria-loop --say "<input>"  # inject an async input into a running loop

alexandria-events                # tail the run log (one durable event per turn)
```

In the router, `/settings` opens an arrow-key menu (per-Keeper model, shared tools, context
window, canary/reframe/revoice toggles). Loop state lives in `.pharos/loops/<id>/`.

## How it works

```
prompt ─▶ Pharos (stateless classifier)
              │  picks a Keeper by domain
              ▼
        Keeper (warm claude session, persona-scoped)
              │  canary on every turn
              ├─ canary missing → flush + reseed (drift caught)
              └─ context high   → handoff + reseed for next turn
```

The auto-loop wraps the same primitive: plan → run each step on a warm Keeper → independent Keeper
reviews → drift/plateau guards → forked skill-authoring → repeat until the done-condition holds or a
guard trips. See `docs/auto-loop.md` for the full schema and the graft table.

## Status

The router, warm Keepers, memory/reseed seam, and the auto-loop harness (plan → run → independent
review → drift/plateau guards → forked skill-authoring) are built and validated — a live
`alexandria-loop` run completes end to end and the forked review has authored a real reusable skill.
Known thin spots are tracked honestly in `docs/auto-loop.md` (e.g. the plateau/scope-creep detectors
stay quiet on the live path until per-turn tool-use is surfaced).

`npm test` — full suite. Pure-function and mock-first throughout: every model-spawning seam is
injectable, so the whole control flow runs offline with no `claude` call.

## License

MIT
