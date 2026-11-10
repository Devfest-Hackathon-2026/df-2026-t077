import createClient from 'openapi-fetch'
import type { paths } from './schema'
import type { ErrorResponse } from './types'
import { getToken } from '../auth/token'
import { env } from '../config/env'
import { getAuthSession } from '../auth/session'

const responseSessions = new WeakMap<Response, number>()
function sameSession(revision: number) {
  if (getAuthSession().revision !== revision) throw new ApiError(401, 'UNAUTHENTICATED')
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public requestId?: string, public details: ErrorResponse['error']['details'] = []) {
    super(code)
  }
}

async function authenticatedFetch(original: Request): Promise<Response> {
  // Clone before sending: a 401 retry keeps the same body/UUID and happens once.
  const retry = original.clone()
  const revision = getAuthSession().revision
  original.headers.set('Authorization', `Bearer ${await getToken()}`)
  sameSession(revision)
  const response = await fetch(original)
  sameSession(revision)
  if (response.status !== 401) { responseSessions.set(response, revision); return response }
  retry.headers.set('Authorization', `Bearer ${await getToken(true)}`)
  sameSession(revision)
  const retried = await fetch(retry)
  sameSession(revision)
  responseSessions.set(retried, revision)
  return retried
}

export const client = createClient<paths>({ baseUrl: env.apiBaseUrl, fetch: authenticatedFetch })

export async function unwrap<T>(result: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await result
  const revision = responseSessions.get(response)
  if (revision !== undefined) sameSession(revision)
  if (error || !response.ok || data === undefined) {
    const body = error as ErrorResponse | undefined
    throw new ApiError(response.status, body?.error?.code || 'DEPENDENCY_UNAVAILABLE', body?.error?.request_id, Array.isArray(body?.error?.details) ? body.error.details : [])
  }
  return data
}
