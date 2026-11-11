// Plateau detector — a second kill-switch beside the per-step attempt budget (step.js).
//
// The attempt budget bounds how MANY times a step retries; it can't tell a productive
// retry (each attempt moves to new ground) from a Keeper THRASHING the same spot. This
// detects the thrash: if the last K attempts keep touching the same SET of targets
// (files / tools / diff-paths), their Jaccard overlap stays high — the loop is polishing
// one corner, not converging. Pure; step.js owns the wiring + the early park.
//
// (← claude-code-harness scripts/detect-review-plateau.sh — Jaccard over review outputs.)

// Jaccard similarity of two sets: |A∩B| / |A∪B|. Two empty sets give 0 (no signal is
// NOT "identical"), so missing touch-data can never read as a plateau.
export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a || []);
  const B = b instanceof Set ? b : new Set(b || []);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// window — how many trailing attempts must agree (>= 2; needs window-1 adjacent pairs).
// threshold — minimum adjacent Jaccard for each of those pairs to count as thrash.
export const DEFAULT_PLATEAU = { window: 2, threshold: 0.7 };

// Given the per-attempt target sets in order (oldest → newest), is the loop plateauing?
// True when the last `window` attempts exist AND every adjacent pair within that window
// overlaps >= threshold (a SUSTAINED repeat, not one coincidence). Any attempt in the
// window with no targets breaks the plateau — it did something unmeasured, give it room.
export function isPlateau(history, opts = {}) {
  const { window, threshold } = { ...DEFAULT_PLATEAU, ...opts };
  if (!Array.isArray(history) || history.length < window || window < 2) return false;
  const recent = history.slice(-window).map((t) => (t instanceof Set ? t : new Set(t || [])));
  if (recent.some((s) => s.size === 0)) return false;
  for (let i = 1; i < recent.length; i += 1) {
    if (jaccard(recent[i - 1], recent[i]) < threshold) return false;
  }
  return true;
}

// The set of targets one attempt touched — files/tools/diff-paths the Keeper reported.
// Live handle() populates result.touched; mocks inject it; absent → empty (no signal).
export function attemptTargets(result = {}) {
  const t = result.touched || result.targets || [];
  return new Set(Array.isArray(t) ? t : []);
}
