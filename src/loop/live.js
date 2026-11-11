// Live wiring — the ONE place that bridges the auto-loop's injectable seams to the real
// Pharos head. The loop modules (run/step/plan/review/selfwrite) stay domain-agnostic —
// everything is injected — so P1–P4 are a wiring change here, not a rewrite there. Every
// adapter takes its underlying primitive (handle / askOnce / a shell runner) as an
// injectable, so tests exercise the wiring without spawning `claude`.
//
// What each adapter realizes:
//   makeLiveAsk      → the one-shot runner (planner/elaborator/reviewer/self-writer)   [P1]
//   makeLiveHandle   → runStep's `do` calls handle() on a THREADED warm reg            [P2]
//   makeDomainVerify → per-Keeper ground truth (Ptah runs a check command, …)          [P3]
//   makeLiveReview   → g4: route the verdict to a DIFFERENT Keeper's model
//   makeLiveSelfwrite→ g5: a forked one-shot (sessionless → can't touch the live cache)
//   makeLiveLoopOpts → assemble the whole bundle for runLoop

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { handle } from '../pharos.js';
import { askOnce } from '../pharos/ask.js';
import { loadRegistry, saveRegistry } from '../pharos/registry.js';
import { KEEPERS } from '../pharos/keepers.js';
import { createSkillStore } from '../memory/skills.js';
import { verifyAgainstContract } from './contract.js';
import { extractJson } from './parse.js';

const modelOf = (id) => (KEEPERS.find((k) => k.id === id) || {}).model;
const activeRoster = () => KEEPERS.filter((k) => k.active).map((k) => k.id);

// The one-shot, sessionless runner. Injectable (opts.askOnce) so tests don't spawn.
export function makeLiveAsk(opts = {}) {
  const run = opts.askOnce || askOnce;
  return (prompt, o = {}) => run(prompt, o);
}

// runStep's `do`. Calls handle() against a SHARED warm reg so Keeper sessions persist
// across steps (the whole point of warm Keepers), and maps handle()'s rich return down
// to the signals the loop reads. Routing: a pinned Keeper wins — per-step (step.keeper,
// via ctx) or loop-wide (opts.keeper, the CLI's --keeper) — else handle() routes by
// content. The pin exists because a code loop's steps MUST run in the repo cwd (Ptah);
// advisory routing onto `clean` tmpdir Keepers is the 07-09 parking failure. The
// produced Keeper is stamped on the result so the reviewer (g4) can pick someone
// different.
export function makeLiveHandle(opts = {}) {
  const h = opts.handle || handle;
  const ask = opts.ask || makeLiveAsk(opts);
  const reg = opts.reg || loadRegistry(opts.registryPath);
  const persist = opts.persist !== false;
  return async (prompt, ctx = {}) => {
    const r = await h(prompt, {
      reg,
      ask,
      keeper: ctx.keeper ?? opts.keeper,
      settings: opts.settings,
      store: opts.store,
      persist,
      registryPath: opts.registryPath,
      learn: false, // a loop step is autonomous work, not the operator revealing durable facts
    });
    if (persist) saveRegistry(reg, opts.registryPath);
    return {
      text: r.text,
      keeper: r.routed, // the producer — review/g4 reads this
      contextTokens: r.contextTokens || 0,
      compacting: !!r.compacting,
      degraded: !!r.degraded,
      redone: !!r.redone,
      error: !!r.error,
      touched: r.touched || [], // files this turn edited (from the stream-json tool_use log) → arms plateau (g1) + scope/risk drift (g2)
    };
  };
}

// Default ground-truth check: spawn a shell command, pass on exit 0. Injectable.
function defaultRunCheck(cmd, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, { shell: true, cwd: opts.cwd, stdio: 'ignore' });
    } catch {
      return resolve(false);
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

// P3 — the per-Keeper verify table. Dispatch order:
//   1. the step declares a check COMMAND (Ptah/code ground truth: run tests/compile),
//   2. a per-Keeper verifier in opts.verifiers[keeper] (Thoth rubric, Ra reality, …),
//   3. the frozen contract's checks (g3),
//   4. structural: the turn ran without error.
// Same `do → verify → adjust` shape everywhere; only the ground truth differs (docs §9).
export function makeDomainVerify(opts = {}) {
  const runCheck = opts.runCheck || defaultRunCheck;
  const verifiers = opts.verifiers || {};
  const assess = opts.assess; // (checks, result) → satisfied[] of met check ids; injected live
  return async (step, result, vctx = {}) => {
    const cmd = step.check || step.test;
    if (cmd) {
      const ok = await runCheck(cmd, opts);
      return ok ? { pass: true } : { pass: false, feedback: `check failed: ${cmd}` };
    }
    const keeper = result.keeper || step.keeper;
    if (keeper && verifiers[keeper]) return verifiers[keeper](step, result, vctx);
    // g3 — enforce the frozen contract when its checks can be MEASURED. The producer may
    // already report `satisfied`; if not, an injected `assess` grades the output against
    // the checks to produce one. Only when neither yields a signal do we fall through to
    // structural (a contract you genuinely can't measure must not auto-park the step — the
    // first live run hit exactly that). Fail-soft: an assess error → structural, never a block.
    if (step.contract && (step.contract.checks || []).length) {
      let satisfied = Array.isArray(result.satisfied) ? result.satisfied : null;
      if (!satisfied && assess) {
        try { satisfied = await assess(step.contract.checks, result); } catch { satisfied = null; }
      }
      if (Array.isArray(satisfied)) return verifyAgainstContract(step.contract, { ...result, satisfied });
    }
    return result.error ? { pass: false, feedback: 'turn errored' } : { pass: true };
  };
}

// g4 live — route a review payload to a DIFFERENT Keeper's model for a read-only verdict.
// Fail-soft to approved on an unparseable reply (never block a lock on a parse miss).
export function makeLiveReview(opts = {}) {
  const ask = opts.ask || makeLiveAsk(opts);
  return async (payload) => {
    const model = modelOf(payload.reviewer) || opts.model;
    const prompt =
      `You are an INDEPENDENT reviewer (read-only) — a different Keeper than the producer. ` +
      `Approve ONLY if the work genuinely meets its done-condition; be skeptical.\n\n` +
      `Intent: ${payload.intent}\nDone-condition: ${payload.definition_of_done}\n` +
      `Checks: ${JSON.stringify(payload.checks)}\nResult: ${JSON.stringify(payload.result)}\n\n` +
      `Return ONLY JSON: {"approved":true|false,"notes":"<one line>"}.`;
    const out = await ask(prompt, { model });
    return extractJson(out) || { approved: true, notes: 'reviewer unparseable → pass (fail-soft)' };
  };
}

// g5 live — the forked review. A one-shot askOnce is SESSIONLESS: it runs in its own
// process and cannot touch the live conversation or its prompt cache — exactly the
// "forked, doesn't mutate the live thread" property the design needs. The anti-poison
// screen + patch-before-create still run in selfWrite() on whatever this returns.
export function makeLiveSelfwrite(opts = {}) {
  const ask = opts.ask || makeLiveAsk(opts);
  return async (payload) => {
    const prompt =
      `You are a FORKED reviewer with access to memory+skill tools ONLY. Reflect on what ` +
      `just happened and propose 0–2 REUSABLE skills to author or patch. Rules: ` +
      `${JSON.stringify(payload.rules)}. Existing skills: ${JSON.stringify(payload.existingSkills)}. ` +
      `Context: goal=${JSON.stringify(payload.goal)}, lastStep=${JSON.stringify(payload.lastStep)}.\n\n` +
      `Return ONLY JSON: {"skills":[{"name":"<class-level kebab name>","body":"<the reusable how-to>"}]}. ` +
      `Return {"skills":[]} if nothing generalizes.`;
    const out = await ask(prompt);
    const v = extractJson(out);
    return v && Array.isArray(v.skills) ? v.skills : [];
  };
}

// g3 live — grade a result against the frozen contract's checks to produce the
// `satisfied` signal makeDomainVerify needs. Sessionless ask (independent of the producer
// thread). The grader gets the EVIDENCE, not just the producer's chat reply: the files
// the turn touched (from stream-json) are read off disk and included — grading a code
// step from a prose summary alone strictly-fails checks the work actually meets (the
// p1-provider run parked 3 correct steps exactly this way). Fail-soft everywhere: an
// unreadable file is skipped, an unparseable reply → null (verify falls to structural).
const ASSESS_MAX_FILES = 8;
const ASSESS_MAX_BYTES = 8_000; // per file — enough to judge a module, bounded prompt

export function makeLiveAssess(opts = {}) {
  const ask = opts.ask || makeLiveAsk(opts);
  const read = opts.readFile || ((f) => readFileSync(f, 'utf8'));
  return async (checks, result) => {
    const evidence = (result?.touched || [])
      .slice(0, ASSESS_MAX_FILES)
      .map((f) => {
        try { return `--- ${f}\n${String(read(f)).slice(0, ASSESS_MAX_BYTES)}`; } catch { return null; }
      })
      .filter(Boolean)
      .join('\n\n');
    const prompt =
      `Grade whether an attempt meets each acceptance check. For each check, decide if the ` +
      `evidence CLEARLY satisfies it — be strict.\n\n` +
      `Checks: ${JSON.stringify(checks)}\n` +
      `Producer's reply: ${JSON.stringify((result && result.text) || '')}\n` +
      (evidence ? `Files the attempt edited (current contents):\n${evidence}\n\n` : '') +
      `Return ONLY JSON: {"satisfied":["<id of each met check>"]}.`;
    // tools:'' — the grader embeds file contents (untrusted at one remove); it must judge,
    // never act (same posture as the research fan-out's non-worker stages).
    const out = await ask(prompt, { tools: '' });
    const v = extractJson(out);
    return v && Array.isArray(v.satisfied) ? v.satisfied : null;
  };
}

// Assemble the full opts bundle for runLoop — live planner/elaborator (via ask), live
// step runner (warm reg), domain verify, live reviewer + self-writer, a real skills
// store, and the active-Keeper roster. opts.overrides win (tests/sims swap any seam).
export function makeLiveLoopOpts(opts = {}) {
  const ask = makeLiveAsk(opts);
  const reg = opts.reg || loadRegistry(opts.registryPath);
  const skills = opts.skills || createSkillStore(opts);
  return {
    loopId: opts.loopId,
    dir: opts.dir,
    ask,
    handle: makeLiveHandle({ ...opts, reg, ask }),
    verify: makeDomainVerify({ ...opts, assess: opts.assess || makeLiveAssess({ ...opts, ask }) }),
    review: makeLiveReview({ ...opts, ask }),
    selfwrite: makeLiveSelfwrite({ ...opts, ask }),
    skills,
    roster: opts.roster || activeRoster(),
    riskPaths: opts.riskPaths,
    ...opts.overrides,
  };
}
