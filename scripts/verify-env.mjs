import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { root, backendPython, run } from './env-lib.mjs';

try {
  run(process.execPath, [join(root, 'scripts/doctor.mjs'), 'full']);
  run(backendPython, ['-c', 'from importlib.metadata import version; import fastapi, uvicorn, pydantic, pydantic_settings, httpx, firebase_admin, google.cloud.firestore, google.genai; from zoneinfo import ZoneInfo; print("Backend imports OK; timezone="+str(ZoneInfo("Asia/Tokyo"))); print("fastapi="+version("fastapi")+" pydantic="+version("pydantic")+" google-genai="+version("google-genai"))']);
  const requireFrontend = createRequire(join(root, 'frontend/package.json'));
  const { build, createServer } = await import(pathToFileURL(requireFrontend.resolve('vite')).href);
  const scratch = mkdtempSync(join(tmpdir(), 'zurashitabi-env-check-'));
  writeFileSync(join(scratch, 'index.html'), '<!doctype html><html><body><script type="module" src="/check.tsx"></script></body></html>');
  writeFileSync(join(scratch, 'check.tsx'), 'import React from "react"; const label: string = "Environment smoke check"; document.body.textContent = label + " / React " + React.version;');
  const config = { root: scratch, configFile: false, resolve: { alias: { react: join(root, 'frontend/node_modules/react') } }, logLevel: 'warn' };
  await build({ ...config, build: { outDir: join(scratch, 'dist') } });
  if (!existsSync(join(scratch, 'dist/index.html'))) throw new Error('Vite smoke build output is missing.');
  const server = await createServer({ ...config, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  try {
    await server.listen();
    const address = server.httpServer.address();
    const response = await fetch('http://127.0.0.1:' + address.port);
    if (!response.ok || !(await response.text()).includes('check.tsx')) throw new Error('Vite HTTP smoke check failed.');
  } finally {
    await server.close();
  }
  console.log('Vite TypeScript/React dependency build and local HTTP: OK.');
  console.log('Smoke files stay in the OS temporary directory and are not copied into the product repository.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
