import { Link } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { env } from '../../config/env'
import { useLocale } from '../../i18n/useLocale'
import { TripForm } from './TripForm'

const MockPlanningForm = import.meta.env.DEV ? lazy(() => import('../../mocks/MockPlanningForm')) : null

export function SetupPage() {
  const { t, locale } = useLocale()
  return <div className="setup-page">
    <header className="setup-heading">
      <p className="eyebrow">YOUR TRIP, A LITTLE DIFFERENT</p>
      <h1>{t('planningTitle')}</h1><p>{t('tagline')}</p>
      {env.mocks && <Link className="setup-sample-link" to={`/trips/${locale === 'en' ? 'demo-trip-en' : 'demo-trip'}/compare?proposalId=demo-proposal`}>{t('sample')} <span aria-hidden="true">↗</span></Link>}
    </header>
    <ol className="setup-steps" aria-label={t('setupSteps')}>
      {(['setupBasics', 'setupPlaces', 'setupPace', 'setupReview'] as const).map((key, i) => <li key={key}><span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>{t(key)}</li>)}
    </ol>
    <TripForm />
    {env.mocks && MockPlanningForm && <details className="setup-devtools"><summary>{t('setupDevTools')}</summary><Suspense fallback={<p>{t('loading')}</p>}><MockPlanningForm /></Suspense></details>}
  </div>
}
