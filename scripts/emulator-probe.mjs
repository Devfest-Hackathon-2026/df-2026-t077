const baseAuth = 'http://127.0.0.1:9099';
const baseFirestore = 'http://127.0.0.1:8080';
try {
  const authResponse = await fetch(baseAuth + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-only', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!authResponse.ok) throw new Error('Local Auth emulator anonymous sign-up failed.');
  const auth = await authResponse.json();
  if (!auth.idToken || !auth.localId) throw new Error('Local Auth emulator did not return a test identity.');
  const firestoreResponse = await fetch(baseFirestore + '/v1/projects/demo-zurashitabi/databases/(default)/documents/environment_probe/test', {
    headers: { Authorization: 'Bearer ' + auth.idToken },
  });
  if (firestoreResponse.status !== 403) throw new Error('Expected deny-all Firestore rules to reject a client request; got ' + firestoreResponse.status);
  console.log('Local Auth anonymous sign-up: OK. Local Firestore client deny-all rules: OK.');
  console.log('Only demo-zurashitabi on 127.0.0.1 was used; no real Firebase project was contacted by this probe.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
