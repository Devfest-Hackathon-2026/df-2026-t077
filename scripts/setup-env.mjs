import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, versions, toolPython, uvPath, npmCli, windows, run, pythonCandidates, localJavaHome } from './env-lib.mjs';
import { downloadVerified } from './download-tool.mjs';

const profile = process.argv[2] || 'frontend';
function copyEnvironment(directory) {
  const target = join(root, directory, '.env');
  if (!existsSync(target)) copyFileSync(join(root, directory, '.env.example'), target);
}
async function setup() {
  if (!['frontend', 'backend', 'full'].includes(profile)) throw new Error('Choose frontend, backend or full');
  if (process.versions.node !== versions.node) throw new Error('Use Node ' + versions.node + '; the setup wrapper uses the project Volta pin');
  mkdirSync(join(root, '.tools'), { recursive: true });
  if (profile !== 'frontend') {
    if (!existsSync(toolPython)) {
      let installed = false;
      for (const [command, prefix] of pythonCandidates()) {
        const probe = spawnSync(command, [...prefix, '-c', 'import sys; assert sys.version_info >= (3, 11)'], { stdio: 'ignore', windowsHide: true });
        if (!probe.error && probe.status === 0) {
          run(command, [...prefix, '-m', 'venv', join(root, '.tools/bootstrap')]);
          installed = true;
          break;
        }
      }
      if (!installed) throw new Error('Backend/full profile needs bootstrap Python 3.11+; frontend profile does not');
    }
    const uv = existsSync(uvPath) ? run(uvPath, ['--version'], { capture: true }).split(' ')[1] : '';
    if (uv !== versions.uv) run(toolPython, ['-m', 'pip', 'install', '--disable-pip-version-check', 'uv==' + versions.uv]);
    if (!existsSync(join(root, 'backend/uv.lock'))) throw new Error('backend/uv.lock is missing; obtain a complete checkout');
    run(uvPath, ['sync', '--frozen', '--project', join(root, 'backend'), '--python', versions.python]);
    copyEnvironment('backend');
  }
  if (profile !== 'backend') {
    run(process.execPath, [npmCli, 'ci', '--no-audit'], { cwd: join(root, 'frontend') });
    copyEnvironment('frontend');
  }
  if (profile === 'full') {
    run(process.execPath, [npmCli, 'ci', '--no-audit']);
    const javaHome = localJavaHome();
    const java = javaHome && join(javaHome, 'bin', windows ? 'java.exe' : 'java');
    if (!java || !existsSync(java)) {
      const asset = versions.java[process.platform + '-' + process.arch];
      if (!asset || basename(asset.archive) !== asset.archive) throw new Error('Unsupported Java platform; see docs/DEVELOPMENT.md');
      const cache = join(root, '.tools/downloads');
      mkdirSync(cache, { recursive: true });
      const archive = join(cache, asset.archive);
      console.log('Preparing local Java 21 for Firebase emulators...');
      await downloadVerified(asset.url, archive, asset.sha256);
      const destination = join(root, '.tools/java');
      mkdirSync(destination, { recursive: true });
      if (windows) {
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:ZURASHITABI_JAVA_ARCHIVE -DestinationPath $env:ZURASHITABI_JAVA_DESTINATION -Force'], {
          env: { ZURASHITABI_JAVA_ARCHIVE: archive, ZURASHITABI_JAVA_DESTINATION: destination },
        });
      } else run('tar', ['-xzf', archive, '-C', destination]);
      if (!existsSync(java)) throw new Error('Expected Java executable not found after extraction');
    }
  }
  run(process.execPath, [join(root, 'scripts/doctor.mjs'), profile]);
  console.log('Ready: ' + profile + '. Existing .env values were preserved.');
}
setup().catch((error) => { console.error(error.message); process.exitCode = 1; });
