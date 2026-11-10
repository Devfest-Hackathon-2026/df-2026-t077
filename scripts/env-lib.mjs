import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const versions = JSON.parse(readFileSync(join(root, 'tools/versions.json'), 'utf8'));
export const windows = process.platform === 'win32';
export const toolPython = join(root, '.tools/bootstrap', windows ? 'Scripts/python.exe' : 'bin/python');
export const uvPath = join(root, '.tools/bootstrap', windows ? 'Scripts/uv.exe' : 'bin/uv');
export const backendPython = join(root, 'backend/.venv', windows ? 'Scripts/python.exe' : 'bin/python');
export const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
export const firebaseCli = join(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
export function environment(extra = {}) {
  return {
    ...process.env,
    UV_CACHE_DIR: join(root, '.tools/cache/uv'),
    UV_PYTHON_INSTALL_DIR: join(root, '.tools/python'),
    PIP_CACHE_DIR: join(root, '.tools/cache/pip'),
    ...extra,
  };
}
export function run(command, args, { cwd = root, env = {}, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd, env: environment(env), stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || result.stdout || '');
    throw new Error(command + ' exited with code ' + result.status);
  }
  return capture ? result.stdout.trim() : '';
}
export function pythonCandidates() {
  return windows ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];
}
export function localJavaHome() {
  const asset = versions.java[process.platform + '-' + process.arch];
  if (!asset) return null;
  const folder = join(root, '.tools/java', asset.release);
  return process.platform === 'darwin' ? join(folder, 'Contents/Home') : folder;
}
export function javaEnvironment() {
  const local = localJavaHome();
  const binary = windows ? 'java.exe' : 'java';
  if (local && existsSync(join(local, 'bin', binary))) {
    return { JAVA_HOME: local, PATH: join(local, 'bin') + (windows ? ';' : ':') + process.env.PATH };
  }
  return {};
}
export function requireFile(path, message) {
  if (!existsSync(path)) throw new Error(message);
}
