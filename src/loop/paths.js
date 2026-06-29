// Loop state lives under `.pharos/loops/<loopId>/`, mirroring the rest of the
// `.pharos/` convention (gitignored, anchored to repoRoot via import.meta.url so it
// is location-independent — same discipline as registry.js / events.js).
//
// Every loop file resolver routes through here. Tests pass `opts.dir` to redirect
// the whole loop into a temp dir; nothing else needs to know the layout.

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../');
const loopsRoot = join(repoRoot, '.pharos', 'loops');

// Resolve the on-disk paths for one loop. `opts.dir` overrides the directory wholesale
// (tests / a non-default root); otherwise it is `.pharos/loops/<loopId>/`.
export function loopPaths(loopId, opts = {}) {
  const dir = opts.dir || join(loopsRoot, String(loopId));
  return {
    dir,
    plan: join(dir, 'plan.json'),
    inbox: join(dir, 'inbox.jsonl'),
    log: join(dir, 'log.jsonl'),
  };
}
