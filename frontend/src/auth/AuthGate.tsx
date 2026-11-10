import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { env } from '../config/env'
import { useLocale } from '../i18n/useLocale'
import { Button } from '../components/ui/Button'
import { getToken } from './token'
import { getAuthSession, onIdentityChange, subscribeAuthSession } from './session'

export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeAuthSession, getAuthSession)
  const query = useQueryClient()
  const { t, locale, setLocale } = useLocale()
  const [error, setError] = useState<unknown>()
  useEffect(() => onIdentityChange(() => { void query.cancelQueries(); query.clear() }), [query])
  useEffect(() => {
    if (env.mocks || session.ready) return
    let active = true
    void getToken().catch((failure) => { if (active) setError(failure) })
    return () => { active = false }
  }, [session.revision, session.ready])
  if (env.mocks) return children
  // A new identity remounts page/form/mutation state as well as clearing Query data.
  if (session.ready) return <Fragment key={session.revision}>{children}</Fragment>
  return <main className="container auth-state">
    <header><h1>{t('title')}</h1><nav aria-label="Language"><Button lang="ja" aria-pressed={locale === 'ja'} onClick={() => setLocale('ja')}>日本語</Button><Button lang="en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</Button></nav></header>
    {error !== undefined
      ? <section className="status" role="alert"><p>{t('authFailed')}</p><Button onClick={() => { setError(undefined); void getToken().catch(setError) }}>{t('retry')}</Button></section>
      : <p className="status" role="status">{t('authLoading')}</p>}
  </main>
}
