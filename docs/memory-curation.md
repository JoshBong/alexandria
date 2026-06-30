# Memory Curation — implementation plan

> Status: design (not built). The self-writing loop (g5) and the skill curator (g6)
> already keep the **skill** store from drowning. The **Keeper memory** store has
> neither gate — every recall-miss fact appends forever. This ports the same two
> halves to memory, and is explicit about what does *not* transfer.

## 1. The problem (precise)

`selfWrite` (`src/loop/selfwrite.js`) writes through `opts.skills`; the curator
(`src/memory/curator.js`) is wired only inside `skills.js#curate()`. Both operate on
the **skill** store.

The **memory** store — `createStore()` → folder/ark adapter, contract `search / write
/ get` — has **no write gate and no curator**. `folder.write()` only refuses empty
text (`folder.js:115`); `ark.write()` the same. There is no `list()` and no
`curate()`. So:

- Junk facts (transient errors, near-duplicates) are persisted at the source.
- Nothing ever ages a fact out. The folder grows unbounded.

Bloat is **future**, not present — the store is small today. So this is scoped to the
cheap deterministic half now, with the expensive LLM half designed but deferred.

## 2. Two levers, and most of the win is the cheap one

| Lever | What it does | Subagent? |
|-------|--------------|-----------|
| **Write gate** | Reject junk at the source (transient facts, near-dups). Most bloat never should have been written. | **No** — synchronous, deterministic. |
| **Deterministic GC** | `active → stale → archived` by recency/usage. Archive, never delete. | **No** — it's `curator.js`, pointed at memory records. |
| **Semantic consolidation** | Merge facts that say the same thing; drop facts a newer one contradicts; summarize stale clusters. Makes recall *better*, not just smaller. | **Yes** — the only part that justifies an LLM. |

Ship rows 1–2 now (free, deterministic, kill most bloat). Treat row 3 as the smart
layer on top, deferred until there is real volume to justify the token cost.

## 3. What ports from skills — and what does NOT

The reuse map is real but **not** "just port g5's rules." A skill must be class-level
and reusable; a **memory fact is allowed to be specific** (`Josh prefers X`, a path, a
keeper-scoped note). So the memory write-gate is a *narrower* screen than the skill
screen.

| From | Ports to memory? | Note |
|------|------------------|------|
| `curator.js` `classifySkill` / `touchSkill` / `curate` | **Yes, as-is** | Thresholds are unit-agnostic; it classifies on `{uses, last_activity, status}` — generic telemetry. Works on a memory record unchanged. |
| `selfwrite.js` Rule 1 — `POISON_PATTERNS` transient subset (`is broken`, `failed`, `timed out`, `error:`, `not found`) | **Yes** | A transient failure is junk in any durable store. |
| `selfwrite.js` Rule 1 — path / IP / instance patterns | **No** | A memory fact is *allowed* to carry a path or be specific. These would reject legitimate facts. |
| `selfwrite.js` Rule 2 — class-level naming | **No** | Memory facts have no name slug and need not be class-level. |
| `selfwrite.js` Rule 3 — Jaccard dedup (`chooseAction`) | **Adapted** | Reuse `plateau.js#jaccard`, but over **body tokens** (`pharos/classify.js#tokenize`), not name tokens. Near-dup → skip the write (or fold tags), don't append. |

So: extract a `memoryPoisonReason()` that is `selfwrite`'s transient screen **minus**
the path/IP/instance rules, and a `isDuplicate(text, existing)` that uses
`jaccard(tokenize(text), tokenize(prev))`.

## 4. The seam change

Extend the `MemoryStore` contract (`store.js`) from `search / write / get` to add:

```
list()                       -> Promise<Record[]>   // enumerate for GC (folder only)
curate({ now, policy })      -> Promise<{ summary, transitions }>
```

and gate `write()`:

```
write({ text, keeper, tags }):
  if !text.trim()                     -> throw (unchanged)
  if memoryPoisonReason(text)         -> skip, return { skipped, reason }   // log WHY
  if isDuplicate(text, recent)        -> skip (or fold tags into the match)
  else persist (unchanged)
```

**Folder adapter** implements `list()` (it already `walk()`s) and a real `curate()`
that mirrors `skills.js#curate()`: read all, `curateSkills(all, {now})`, rewrite
status frontmatter in place, archive (move to `archive/` or flag) — never unlink.

**Ark adapter delegates.** `ark.write()` *already* appends to the orchestrator inbox
and lets the ark's own consolidation own promotion into the graph (`ark.js:72`). So
for the ark backend, `curate()` is a no-op that defers to the ark's session-close
consolidation (the closeout loop, `project_ark_closeout_loop`). For a forker on the
folder adapter, `curate()` is the deterministic GC. Same seam, two truths.

Memory records need lifecycle telemetry for GC to mean anything — add `status` /
`last_activity` to the write frontmatter, and bump `last_activity` when a `search()`
surfaces a record (a recall is the memory analogue of a skill `use` — it climbs a
stale fact back to active).

## 5. Cadence — boundary checks, not a wall-clock timer

"Every 24h it's open" is awkward in a CLI/TUI (the process is not reliably
long-lived). Match how the loop already works (boundary checks):

- **On open:** run the deterministic GC during prewarm (the startup fan-out already
  exists) — free, instant.
- **Consolidation subagent (deferred):** gate on `writes-since-last-trim > N` **OR**
  `last-trim-age > 24h`, checked at startup/boundary, with a `lastTrim` stamp in the
  registry. Bloat is write-driven, so a write-count trigger is truer than a clock.

## 6. Forked safety (the g5 rule, non-negotiable)

If the consolidation subagent ever writes memory, it forks exactly like `selfWrite`:
sessionless `askOnce`, memory tools only, no access to the live conversation —
structurally cannot poison the active threads. Its output passes the same write gate.

## 7. Scope / sequencing

1. **Now (cheap, deterministic, ~g6-sized, no tokens):** `memoryPoisonReason` +
   `isDuplicate` write gate; `list()` + `curate()` on the folder adapter; record
   telemetry + recall-touch. Tests mirror `skills.test.js`.
2. **Design only:** the `curate()` seam shape above, so the consolidation subagent
   slots in without a contract change.
3. **Deferred until real volume:** the LLM consolidation subagent (the only token
   cost). Do not build the background trimmer before there is anything to trim.

Rejected: a background wall-clock LLM trimmer as the first move — it spends tokens to
solve a problem (bloat) that the free write-gate + GC already mostly eliminate, on a
store that is small today.
