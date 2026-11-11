// Learn-over-time — the memory WRITE driver (the piece that was dormant: the P2 rails
// existed, nothing drove them). After a turn answers, a FORKED sessionless pass reads the
// exchange and proposes 0–2 durable facts about the operator or their work; each is run
// through the store's gate (memory/gate.js) and persisted with provenance.
//
// Forked like g5 self-write (loop/selfwrite.js): the extractor is a one-shot askOnce, NOT
// the warm Keeper — a separate process that structurally can't touch the live thread or
// its cache. Runs on the cheap/local tier (the `bulk` role), so learning is nearly free
// and, under discount/offline, never leaves the machine.
//
// The GATE does the quality control (transient/near-dup rejected); this just aims the
// extractor at durable facts and lets the gate refuse the rest. Prefer none over noise.

import { extractJson } from '../loop/parse.js';

function instruction(prompt, answer, keeper) {
  return (
    `You extract durable memory from an assistant exchange. From the exchange below between ` +
    `the operator and their ${keeper} assistant, extract 0–2 DURABLE facts about the OPERATOR ` +
    `or their ongoing work — worth recalling in a FUTURE, unrelated session. A durable fact is ` +
    `stable and reusable: a preference, a role, a project, a constraint, a relationship, a goal. ` +
    `Do NOT extract: anything transient or specific to this one task, the answer's own content, ` +
    `general knowledge, or a guess. Be strict — prefer returning none over noise.\n\n` +
    `Operator said: ${JSON.stringify(prompt)}\n` +
    `Assistant answered: ${JSON.stringify(answer)}\n\n` +
    `Return ONLY JSON: {"facts":["<one durable fact per string, self-contained>"]}. ` +
    `Return {"facts":[]} if nothing qualifies.`
  );
}

// Ask the forked extractor for durable facts. `ask` is a one-shot runner (askOnce shape);
// onWrittenBy captures which provider/model produced them, for provenance. Fail-soft: no
// runner, empty exchange, or an unparseable reply → no facts (a turn never breaks on this).
export async function extractFacts({ prompt, answer, keeper = 'assistant' } = {}, { ask } = {}) {
  if (typeof ask !== 'function' || !prompt || !answer) return { facts: [], writtenBy: null };
  let writtenBy = null;
  let out;
  try {
    out = await ask(instruction(prompt, answer, keeper), { onWrittenBy: (w) => { writtenBy = w; } });
  } catch {
    return { facts: [], writtenBy: null };
  }
  const parsed = extractJson(out);
  const facts = parsed && Array.isArray(parsed.facts)
    ? parsed.facts.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim())
    : [];
  return { facts, writtenBy };
}

// Extract then persist. Each fact passes through store.write, which GATES it (transient /
// near-dup → skipped with a reason) and stamps written_by. Returns what landed vs what the
// gate refused — the audit trail, never silently lossy.
export async function learnFromTurn(turn = {}, { ask, store } = {}) {
  if (!store) return { written: [], skipped: [] };
  const { facts, writtenBy } = await extractFacts(turn, { ask });
  const written = [];
  const skipped = [];
  for (const text of facts) {
    let r;
    try {
      r = await store.write({ text, keeper: turn.keeper || null, writtenBy });
    } catch {
      continue; // a single bad write never sinks the batch
    }
    if (r && r.skipped) skipped.push({ text, reason: r.reason });
    else if (r && r.id) written.push(r.id);
  }
  return { written, skipped };
}
