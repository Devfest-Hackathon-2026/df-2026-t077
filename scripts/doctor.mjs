import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, versions, uvPath, backendPython, firebaseCli, windows, localJavaHome, run } from './env-lib.mjs';

const profile = process.argv[2] || 'frontend';
if (!['frontend', 'backend', 'full'].includes(profile)) throw new Error('Choose frontend, backend or full');
let failures = 0;
function check(name, action) {
  try { console.log('[OK] ' + name + ': ' + action()); }
  catch (error) { failures++; console.error('[MISSING] ' + name + ': ' + error.message); }
}
function envFile(directory) {
  check(directory + '/.env', () => {
    if (!existsSync(join(root, directory, '.env'))) throw new Error('run setup for ' + profile);
    return 'present (values are not printed)';
  });
}
console.log('Checking profile: ' + profile);
check('Node.js', () => {
  if (process.versions.node !== versions.node) throw new Error('expected ' + versions.node + ', got ' + process.versions.node);
  return process.versions.node;
});
if (profile !== 'backend') {
  check('Frontend dependencies', () => {
    if (!existsSync(join(root, 'frontend/node_modules/vite/package.json'))) throw new Error('run setup');
    return 'installed';
  });
  envFile('frontend');
}
if (profile !== 'frontend') {
  check('uv', () => run(uvPath, ['--version'], { capture: true }));
  check('Python', () => {
    const actual = run(backendPython, ['-c', 'import sys; print(sys.version.split()[0])'], { capture: true });
    if (actual !== versions.python) throw new Error('expected ' + versions.python + ', got ' + actual);
    return actual;
  });
  envFile('backend');
}
if (profile === 'full') {
  check('Firebase CLI', () => run(process.execPath, [firebaseCli, '--version'], { capture: true }));
  check('Java', () => {
    const home = localJavaHome();
    const executable = home && join(home, 'bin', windows ? 'java.exe' : 'java');
    if (!executable || !existsSync(executable)) throw new Error('run full setup');
    const result = spawnSync(executable, ['-version'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error('java -version failed');
    return (result.stderr || result.stdout).trim().split('\n')[0];
  });
}
console.log('Profiles: frontend = UI mock; backend = Python; full = both plus Firebase emulators.');
process.exitCode = failures ? 1 : 0;
