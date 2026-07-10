#!/usr/bin/env node
// alexandria-update — update the global install from GitHub without a manual reinstall.
//
//   alexandria-update            check main's version; install only if newer
//   alexandria-update --force    reinstall regardless (also works offline-check-failed)

import { update, localVersion } from '../src/update.js';

const force = process.argv.includes('--force');
process.stderr.write(`  · alexandria ${localVersion()} — checking for updates…\n`);

const r = await update({ force });
if (r.status === 'current') {
  console.log(`✓ already up to date (${r.version})`);
} else if (r.status === 'updated') {
  console.log(`✓ updated ${r.from} → ${r.to}`);
} else {
  console.error(`✗ update failed: ${r.reason}${force ? '' : ' — try alexandria-update --force'}`);
  process.exit(1);
}
