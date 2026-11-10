import { join } from 'node:path';
import { firebaseCli, root, run, requireFile, javaEnvironment, windows } from './env-lib.mjs';

function shellQuote(value) {
  return windows ? '"' + value.replaceAll('"', '""') + '"' : "'" + value.replaceAll("'", "'\\''") + "'";
}
try {
  if (process.argv.includes('--curated')) process.env.LOCAL_FLOW_DATA_MODE = 'curated';
  requireFile(firebaseCli, 'Run setup -Profile full first.');
  const command = [process.execPath, join(root, 'scripts/check-local-flow.mjs')].map(shellQuote).join(' ');
  run(process.execPath, [firebaseCli, 'emulators:exec', '--project', 'demo-zurashitabi', '--only', 'auth,firestore', command], {
    env: { ...javaEnvironment(), FIREBASE_CLI_DISABLE_USAGE_REPORTING: 'true', CI: 'true' },
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
