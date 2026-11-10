import { env } from '../config/env'
import { singleFlight } from '../lib/singleFlight'
import { setAuthIdentity } from './session'

let realTokenProvider: Promise<(refresh: boolean) => Promise<string>> | undefined
let emulatorConnected = false
let unsubscribeAuth: (() => void) | undefined

async function configureFirebase() {
  const { initializeApp, getApps } = await import('firebase/app')
  const { getAuth, connectAuthEmulator, signInAnonymously, onAuthStateChanged } = await import('firebase/auth')
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  if (!apiKey || !projectId) throw new Error('Firebase configuration is missing')
  const app = getApps()[0] ?? initializeApp({ apiKey, projectId, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN })
  const auth = getAuth(app)
  if (env.emulators && !emulatorConnected) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); emulatorConnected = true }
  await new Promise<void>((resolve, reject) => {
    unsubscribeAuth?.()
    unsubscribeAuth = onAuthStateChanged(auth, (user) => { setAuthIdentity(user?.uid ?? null); resolve() }, reject)
  })
  const signIn = singleFlight(() => signInAnonymously(auth))
  return async (refresh: boolean) => {
    const user = auth.currentUser ?? (await signIn()).user
    return user.getIdToken(refresh)
  }
}

export async function getToken(forceRefresh = false): Promise<string> {
  if (env.mocks) return 'development-mock-only'
  const provider = await (realTokenProvider ??= configureFirebase().catch((error) => {
    realTokenProvider = undefined
    throw error
  }))
  return provider(forceRefresh)
}
