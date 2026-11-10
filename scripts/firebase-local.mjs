import { join } from 'node:path';
import { root, firebaseCli, run, javaEnvironment, requireFile, backendPython } from './env-lib.mjs';

try {
  requireFile(firebaseCli, 'Run npm ci and npm run setup first.');
  const mode = process.argv[2] || 'start';
  const exec = mode === 'verify' || mode === 'backend-test';
  const args = [firebaseCli, exec ? 'emulators:exec' : 'emulators:start', '--project', 'demo-zurashitabi', '--only', 'auth,firestore'];
  if (mode === 'verify') args.push('node scripts/emulator-probe.mjs');
  // Firestore repository tests (backend/tests/test_firestore_repository.py); the emulator sets FIRESTORE_EMULATOR_HOST.
  if (mode === 'backend-test') args.push(`${JSON.stringify(backendPython)} -m pytest ${JSON.stringify(join(root, 'backend/tests/test_firestore_repository.py'))} -q`);
  run(process.execPath, args, { env: { ...javaEnvironment(), FIREBASE_CLI_DISABLE_USAGE_REPORTING: 'true', CI: 'true' } });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
