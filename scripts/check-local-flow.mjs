import { join } from 'node:path';
import { root, run, npmCli } from './env-lib.mjs';

try {
  run(process.execPath, [npmCli, 'run', 'test:live'], { cwd: join(root, 'frontend') });
} catch (error) { console.error(error.message); process.exitCode = 1; }
