# Alexandria

A personal AI orchestration layer on top of Claude Code.

> **Pharos routes · Keepers hold · Alexandria remembers.**

One entry point (**Pharos**, a stateless router) sends each prompt to a persistent,
warm per-domain session (a **Keeper**) so context never dilutes. When a Keeper fills
or drifts, it flushes durable facts to the memory substrate, writes a pointer-handoff,
and reseeds — so quality and continuity survive compaction. Runs on a Claude Code
subscription via hooks + MCP; no per-token API, no web scraping.

## The Keepers (domains, named for Egyptian gods)

| Keeper | Domain | Why |
|--------|--------|-----|
| **Ptah** | `code` | craftsman-creator god — building, engineering, the repo |
| **Ra** | `personal` | the sun at the center — life, schedule, travel |
| **Thoth** | `classwork` | scribe of wisdom — study, courses, research |
| **Horus** | `career` | the far-seeing Eye — offers, recruiting, professional |
| **Anubis** | `intake` | threshold guardian — catch-all for new/unrouted topics |

## Status — Phase 0: Pharos's guesser

De-risking the one assumption everything rests on: *can a cheap, local, API-free
classifier route prompts to the right Keeper reliably enough to trust?*

```
npm run router-proof
```

Runs the classifier over a labeled set and reports accuracy, a confusion matrix,
and every misroute / low-confidence call. No dependencies, no network.
