export interface AuthSession { uid: string | null; revision: number; ready: boolean }
let snapshot: AuthSession = { uid: null, revision: 0, ready: false }
const listeners = new Set<() => void>()
const resetters = new Set<() => void>()

export const getAuthSession = () => snapshot
export function subscribeAuthSession(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function onIdentityChange(reset: () => void) { resetters.add(reset); return () => { resetters.delete(reset) } }

/** Clear the old user's data synchronously before publishing the next identity. */
export function setAuthIdentity(uid: string | null) {
  if (snapshot.uid === uid) return
  for (const reset of resetters) reset()
  snapshot = { uid, ready: uid !== null, revision: snapshot.revision + 1 }
  for (const listener of listeners) listener()
}
