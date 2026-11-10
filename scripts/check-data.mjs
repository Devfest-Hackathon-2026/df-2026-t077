import { join } from 'node:path';
import { root, run, backendPython } from './env-lib.mjs';
try { run(backendPython, [join(root, 'scripts/validate_spots.py'), ...process.argv.slice(2)]); }
catch (error) { console.error(error.message); process.exitCode = 1; }
