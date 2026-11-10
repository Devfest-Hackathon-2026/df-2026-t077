import { join } from 'node:path';
import { root, run, backendPython, npmCli } from './env-lib.mjs';
try {
  run(backendPython, [join(root, 'scripts/export_contracts.py'), '--check']);
  run(backendPython, [join(root, 'scripts/validate_fixtures.py')]);
  run(backendPython, ['-m', 'pytest', 'backend/tests', '-q']);
  for (const task of ['typecheck', 'lint', 'test:unit', 'build']) {
    run(process.execPath, [npmCli, 'run', task], { cwd: join(root, 'frontend') });
  }
  console.log('Shared foundation checks passed. Live business services and external providers are separate tasks.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
