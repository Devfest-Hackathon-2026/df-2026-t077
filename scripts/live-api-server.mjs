// Local integration only: force the demo Firebase project and loopback emulators. The catalog may be demo or curated; never use a cloud project.
import { join } from 'node:path';
import { backendPython, root, run } from './env-lib.mjs';

const firestore = process.env.FIRESTORE_EMULATOR_HOST;
const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!['127.0.0.1:8080', 'localhost:8080'].includes(firestore) || !['127.0.0.1:9099', 'localhost:9099'].includes(auth)) {
  throw new Error('Run npm run verify:local-flow with local Auth/Firestore emulators.');
}
run(backendPython, ['-m', 'uvicorn', 'app.main:app', '--app-dir', join(root, 'backend'), '--host', '127.0.0.1', '--port', '8008'], {
  env: { APP_ENV: 'test', DATA_MODE: process.env.LOCAL_FLOW_DATA_MODE === 'curated' ? 'curated' : 'demo', GCP_PROJECT_ID: 'demo-zurashitabi', GCP_LOCATION: 'global', GEMINI_MODEL: '', CORS_ORIGINS: 'http://127.0.0.1:5188', FIREBASE_AUTH_EMULATOR_HOST: auth, FIRESTORE_EMULATOR_HOST: firestore },
});
