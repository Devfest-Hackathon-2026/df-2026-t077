import { join } from 'node:path';
import { root, run, npmCli } from './env-lib.mjs';
try {
  for (const command of ['typecheck', 'lint', 'test:unit', 'build']) {
    run(process.execPath, [npmCli, 'run', command], { cwd: join(root, 'frontend') });
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
