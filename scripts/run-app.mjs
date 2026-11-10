import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { root, uvPath, npmCli, run } from './env-lib.mjs';

const target = process.argv[2];
const entry = target === 'frontend' ? join(root, 'frontend/index.html') : join(root, 'backend/app/main.py');
if (!existsSync(entry)) {
  console.error('Application entry is missing. Obtain the complete repository and read docs/DEVELOPMENT.md.');
  process.exitCode = 2;
} else {
  try {
    if (target === 'frontend') run(process.execPath, [npmCli, 'run', 'dev'], { cwd: join(root, 'frontend') });
    else if (target === 'backend') run(uvPath, ['run', '--frozen', '--project', join(root, 'backend'), 'uvicorn', 'app.main:app', '--reload', '--reload-dir', 'app', '--host', '127.0.0.1', '--port', '8000'], { cwd: join(root, 'backend') });
    else throw new Error('Expected frontend or backend.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
