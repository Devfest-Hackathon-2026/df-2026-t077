import { useEffect } from 'react'
import { Link, Outlet, useLocation, useRouteError } from 'react-router-dom'
import { env } from '../config/env'
import { useLocale } from '../i18n/useLocale'
import { StatusPanel } from '../components/ui/StatusPanel'

function NavigationFocus() {
  const location = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [location.pathname, location.search])
  return null
}

export function Shell() {
  const { locale, setLocale, t } = useLocale()
  return <><a className="skip-link" href="#main-content">{locale === 'en' ? 'Skip to content' : '本文へ移動'}</a><header className="site-header"><Link className="brand" to="/plan/new"><span aria-hidden="true" className="brand-mark">↗</span>{t('title')}</Link><nav aria-label="Language"><button lang="ja" onClick={() => setLocale('ja')} aria-pressed={locale === 'ja'}>日本語</button><button lang="en" onClick={() => setLocale('en')} aria-pressed={locale === 'en'}>English</button></nav></header>{env.mocks && <aside className="mock-banner">{t('mock')}</aside>}<main id="main-content" className="container" tabIndex={-1}><NavigationFocus /><Outlet /></main><footer className="container">{t('footer')}</footer></>
}
export function NotFound() {
  const { t } = useLocale()
  return <section><h1>{t('notFound')}</h1><Link to="/plan/new">{t('back')}</Link></section>
}
export function RouteError() { return <StatusPanel error={useRouteError()} /> }
