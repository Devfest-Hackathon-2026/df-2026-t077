import { useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useProposal, useSelectPlan, useSpots } from '../../api/hooks'
import { ApiError } from '../../api/client'
import type { Plan, ProposalBundle, SelectionRequest } from '../../api/types'
import { StatusPanel } from '../../components/ui/StatusPanel'
import { useLocale } from '../../i18n/useLocale'
import { messages, type MessageKey } from '../../i18n/messages'
import { WhyPanel } from '../why/WhyPanel'
import { RefineForm } from '../why/RefineForm'
import { Button } from '../../components/ui/Button'
import { fromJapanDateTime } from '../../lib/japanTime'
import { PlanCard } from './PlanCard'
import { ServerText } from '../../components/ui/ServerText'
import './compare.css'

export function ComparePage() {
  const { tripId = '' } = useParams()
  const [search] = useSearchParams()
  const proposalId = search.get('proposalId') || ''
  return <ComparisonSession key={`${tripId}/${proposalId}`} tripId={tripId} proposalId={proposalId} />
}

function ComparisonSession({ tripId, proposalId }: { tripId: string; proposalId: string }) {
  const { t, locale } = useLocale()
  const proposal = useProposal(tripId, proposalId)
  const selection = useSelectPlan(tripId, proposalId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const attempts = useRef(new Map<string, SelectionRequest>())
  const lastPlan = useRef<Plan | null>(null)
  const selectionInFlight = useRef(false)

  if (!tripId || !proposalId) {
    return (
      <section className="compare-state" role="alert">
        <h1>{locale === 'en' ? 'Proposal link is incomplete' : '提案リンクが不完全です'}</h1>
        <p>
          {locale === 'en'
            ? 'A trip ID and proposal ID are required. Return to planning to create or open a proposal.'
            : '旅程IDと提案IDが必要です。条件入力へ戻り、提案を作成または開いてください。'}
        </p>
        <Link className="compare-state-link" to="/plan/new">{t('back')}</Link>
      </section>
    )
  }
  if (proposal.isPending) return <StatusPanel loading />
  if (proposal.isError) {
    const isNotFound = proposal.error instanceof ApiError && proposal.error.status === 404
    return (
      <section className="compare-state" role="alert">
        <h1>{isNotFound
          ? (locale === 'en' ? 'Proposal not found' : '提案が見つかりません')
          : (locale === 'en' ? 'Could not load proposal' : '提案を読み込めませんでした')}</h1>
        <p>{isNotFound
          ? (locale === 'en'
            ? 'This proposal may have expired or the link may be incorrect. Return to planning and generate a new proposal.'
            : '提案が存在しないか、リンクが正しくない可能性があります。条件入力へ戻り、新しい提案を作成してください。')
          : (locale === 'en'
            ? 'The proposal could not be retrieved. Retry loading; this will not generate a new proposal.'
            : '提案を取得できませんでした。再試行は読み込みのみで、新しい提案は生成しません。')}</p>
        <div className="compare-state-actions">
          {!isNotFound && (
            <button type="button" onClick={() => void proposal.refetch()}>{t('retry')}</button>
          )}
          <Link className="compare-state-link" to="/plan/new">{t('back')}</Link>
        </div>
      </section>
    )
  }
  if (!proposal.data) return <StatusPanel loading />

  const bundle = proposal.data

  async function reviewLatest(conflictCode: string) {
    const reason = ['VERSION_CONFLICT', 'MODE_CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(conflictCode)
      ? conflictCode
      : 'OTHER_CONFLICT'
    await queryClient.invalidateQueries({ queryKey: ['trip', tripId], refetchType: 'none' })
    navigate(`/trips/${tripId}?selectionConflict=${reason}`)
  }

  async function choose(plan: Plan) {
    if (selectionInFlight.current || selection.isPending) return
    if (selection.error && (!isSelectionRetryable(selection.error) || lastPlan.current?.id !== plan.id)) return
    selectionInFlight.current = true
    lastPlan.current = plan
    const key = `${proposalId}/${plan.id}`
    let body = attempts.current.get(key)
    if (!body) {
      body = { plan_id: plan.id, expected_version: bundle.base_version, idempotency_key: crypto.randomUUID() }
      attempts.current.set(key, body)
    }
    try {
      await selection.mutateAsync(body)
      navigate(`/trips/${tripId}`)
    } catch (error) {
      if (error instanceof ApiError && ['VERSION_CONFLICT', 'MODE_CONFLICT'].includes(error.code)) {
        await reviewLatest(error.code)
      }
    } finally {
      selectionInFlight.current = false
    }
  }

  if (selection.error instanceof ApiError && selection.error.status === 404) {
    return (
      <section className="compare-state" role="alert">
        <h1>{t('selectionUnavailableTitle')}</h1>
        <p>{t('selectionUnavailable')}</p>
        <Link className="compare-state-link" to="/plan/new">{t('back')}</Link>
      </section>
    )
  }

  return (
    <ProposalComparison
      bundle={bundle}
      selectionError={selection.error}
      selectionRetryable={isSelectionRetryable(selection.error)}
      isSelecting={selection.isPending}
      locale={locale}
      t={t}
      onSelect={(plan) => void choose(plan)}
      onRetrySelection={() => {
        if (selection.error instanceof ApiError && selection.error.status === 409 && selection.error.code !== 'REQUEST_IN_PROGRESS') {
          void reviewLatest(selection.error.code)
        } else if (lastPlan.current) {
          void choose(lastPlan.current)
        }
      }}
    />
  )
}

function isSelectionRetryable(error: Error | null): boolean {
  if (!(error instanceof ApiError)) return error !== null
  if (error.code === 'REQUEST_IN_PROGRESS' || error.status === 429 || error.status === 401 || error.status >= 500) return true
  return false
}

function ProposalComparison({
  bundle,
  selectionError,
  selectionRetryable,
  isSelecting,
  locale,
  t,
  onSelect,
  onRetrySelection,
}: {
  bundle: ProposalBundle
  selectionError: Error | null
  selectionRetryable: boolean
  isSelecting: boolean
  locale: 'ja' | 'en'
  t: (key: import('../../i18n/messages').MessageKey) => string
  onSelect: (plan: Plan) => void
  onRetrySelection: () => void
}) {
  const [whyId, setWhyId] = useState<string | null>(null)
  const [refining, setRefining] = useState(false)
  const { tripId = '' } = useParams()
  const visitDate = fromJapanDateTime(bundle.effective_constraints.start_at).date
  const spots = useSpots(bundle.effective_constraints.area_id, visitDate)
  const plans = [bundle.baseline, ...bundle.alternatives].filter((plan): plan is Plan => plan !== null)
  const whyPlan = plans.find((plan) => plan.id === whyId)
  const allEvidence = [...bundle.evidence, ...(spots.data?.evidence ?? [])]
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value))
  const titleFor = (plan: Plan, isBaseline: boolean) => {
    if (isBaseline) return locale === 'en' ? 'Baseline plan' : '元案'
    if (plan.strategy === 'time_shift') return locale === 'en' ? 'Time shift' : '時間ずらし案'
    if (plan.strategy === 'place_shift') return locale === 'en' ? 'Place shift' : '場所ずらし案'
    return locale === 'en' ? 'Alternative plan' : '代替案'
  }

  return (
    <section className="compare-page" aria-labelledby="comparison-title">
      <Link className="back" to="/plan/new">← {t('back')}</Link>
      <div className="section-heading">
        <h1 id="comparison-title">{t('compare')}</h1>
        <p>{t('japanTime')}</p>
      </div>

      <div className="compare-introduction"><p>{locale === 'en' ? 'Keep your must-see places. Compare visiting at a different time or choosing another optional place, then adopt the plan that suits you.' : '必ず行きたい場所はそのまま。時間をずらす案と、任意の場所を交換する案を比べて、自分に合う旅を選べます。'}</p><Button type="button" disabled={isSelecting} onClick={() => setRefining(true)}>{t('refine')}</Button></div>

      {bundle.status === 'partial' && (
        <section className="compare-result-notice compare-result-partial" role="status">
          <h2>{locale === 'en' ? 'Some proposal results are incomplete' : '一部の提案結果が不完全です'}</h2>
          <p>
            {locale === 'en'
              ? 'Available feasible plans remain comparable and selectable.'
              : '成立した案は比較・採用できます。'}
            {bundle.warnings.length === 0 && bundle.violations.length === 0 && (
              locale === 'en'
                ? ' Some alternatives or details could not be provided.'
                : ' 一部の代替案または詳細を提示できませんでした。'
            )}
            {bundle.warnings.length > 0 && (
              locale === 'en' ? ' Review the warnings below.' : ' 以下の警告も確認してください。'
            )}
          </p>
          {bundle.warnings.length > 0 && (
            <ul>{bundle.warnings.map((warning) => <li key={warning}><ServerText text={warning} sourceLocale={bundle.effective_constraints.locale} /></li>)}</ul>
          )}
          {bundle.violations.map((violation, index) => (
            <div className="compare-violation" key={`${violation.code}-${violation.spot_id ?? 'trip'}-${index}`}>
              <strong><ServerText text={violation.message} sourceLocale={bundle.effective_constraints.locale} spots={spots.data?.items} /></strong>
              <p>{locale === 'en' ? 'What you can change: ' : '変更候補: '}<ServerText text={violation.suggested_action} sourceLocale={bundle.effective_constraints.locale} spots={spots.data?.items} /></p>
            </div>
          ))}
        </section>
      )}

      {bundle.status === 'no_feasible_plan' && (
        <section className="compare-result-notice compare-result-infeasible" role="status">
          <h2>{t('noPlan')}</h2>
          <p>
            {locale === 'en'
              ? 'No plan satisfies the current constraints. No constraint has been relaxed automatically.'
              : '現在の条件を満たす案はありません。条件は自動で緩和していません。'}
          </p>
          {bundle.violations.map((violation, index) => (
            <div className="compare-violation" key={`${violation.code}-${violation.spot_id ?? 'trip'}-${index}`}>
              <strong><ServerText text={violation.message} sourceLocale={bundle.effective_constraints.locale} spots={spots.data?.items} /></strong>
              <p>{locale === 'en' ? 'What you can change: ' : '変更候補: '}<ServerText text={violation.suggested_action} sourceLocale={bundle.effective_constraints.locale} spots={spots.data?.items} /></p>
            </div>
          ))}
          {bundle.warnings.length > 0 && (
            <ul>{bundle.warnings.map((warning) => <li key={warning}><ServerText text={warning} sourceLocale={bundle.effective_constraints.locale} /></li>)}</ul>
          )}
          <Link className="compare-state-link" to="/plan/new">{t('back')}</Link>
        </section>
      )}

      {bundle.status !== 'no_feasible_plan' && !bundle.baseline && (
        <section className="compare-result-notice compare-result-infeasible" role="status">
          <h2>{locale === 'en' ? 'Baseline plan is infeasible' : '元案が成立しません'}</h2>
          <p>
            {locale === 'en'
              ? 'The baseline is not available for adoption. Compare only the feasible alternatives returned by the proposal.'
              : '元案は採用できません。提案で返された成立済みの代替案だけを表示しています。'}
          </p>
          {bundle.status !== 'partial' && bundle.violations.map((violation, index) => (
            <div className="compare-violation" key={`${violation.code}-${violation.spot_id ?? 'trip'}-${index}`}>
              <strong><ServerText text={violation.message} sourceLocale={bundle.effective_constraints.locale} spots={spots.data?.items} /></strong>
              <p>{locale === 'en' ? 'What you can change: ' : '変更候補: '}<ServerText text={violation.suggested_action} sourceLocale={bundle.effective_constraints.locale} spots={spots.data?.items} /></p>
            </div>
          ))}
          <Link className="compare-state-link" to="/plan/new">{t('back')}</Link>
        </section>
      )}

      {bundle.status === 'complete' && (bundle.warnings.length > 0 || bundle.violations.length > 0) && (
        <section className="compare-result-notice compare-result-partial" role="status">
          <h2>{locale === 'en' ? 'Proposal notes' : '提案に関する注意'}</h2>
          {bundle.warnings.map((warning) => (
            <p key={warning}><ServerText text={warning} sourceLocale={bundle.effective_constraints.locale} /></p>
          ))}
          {bundle.violations.map((violation, index) => (
            <div className="compare-violation" key={`${violation.code}-${violation.spot_id ?? 'trip'}-${index}`}>
              <strong><ServerText text={violation.message} sourceLocale={bundle.effective_constraints.locale} spots={spots.data?.items} /></strong>
              <p>{locale === 'en' ? 'What you can change: ' : '変更候補: '}<ServerText text={violation.suggested_action} sourceLocale={bundle.effective_constraints.locale} spots={spots.data?.items} /></p>
            </div>
          ))}
        </section>
      )}

      {bundle.effective_constraints.locale !== locale && (
        <div className="notice"><p>{t('explanationLanguage')}: {bundle.effective_constraints.locale}</p><p>{locale === 'en' ? 'Your itinerary and selection stay the same when you switch language. Text without a translation remains available in its original language.' : '言語を切り替えても旅程や採用は変わりません。翻訳のない文章は原文を開いて確認できます。'}</p><Button type="button" disabled={isSelecting} onClick={() => setRefining(true)}>{locale === 'en' ? 'Generate new plans with English explanations' : '日本語の説明で再提案する'}</Button></div>
      )}

      {spots.isLoading && (
        <p role="status" className="compare-spot-status">
          {locale === 'en' ? 'Loading spot information…' : 'スポット情報を読み込んでいます…'}
        </p>
      )}
      {spots.isError && (
        <div role="alert" className="compare-spot-error">
          <p>
            {locale === 'en'
              ? 'Spot information could not be loaded. Spot IDs are shown where names are unavailable.'
              : 'スポット情報を読み込めませんでした。名称を取得できない場合はスポットIDを表示しています。'}
          </p>
          <button type="button" onClick={() => void spots.refetch()}>
            {t('retry')}
          </button>
        </div>
      )}

      {selectionError && (
        <section
          className="compare-result-notice compare-selection-error"
          role={selectionError instanceof ApiError && selectionError.code === 'REQUEST_IN_PROGRESS' ? 'status' : 'alert'}
        >
          <p>
            {selectionError instanceof ApiError && selectionError.code === 'REQUEST_IN_PROGRESS'
              ? t('REQUEST_IN_PROGRESS')
              : selectionError instanceof ApiError && selectionError.code === 'IDEMPOTENCY_KEY_REUSED'
                ? t('selectionKeyMismatch')
                : selectionError instanceof ApiError && selectionError.code === 'MODE_CONFLICT'
                  ? t('MODE_CONFLICT')
                  : selectionError instanceof ApiError && selectionError.code === 'VERSION_CONFLICT'
                    ? t('VERSION_CONFLICT')
                    : selectionError instanceof ApiError && selectionError.code in messages.ja
                      ? t(selectionError.code as MessageKey)
                      : t('apiError')}
          </p>
          {selectionRetryable && (
            <p>{t('selectionRetryNote')}</p>
          )}
          {selectionRetryable && (
            <div className="compare-state-actions">
              <button type="button" disabled={isSelecting} onClick={onRetrySelection}>
                {t('selectionRetrySame')}
              </button>
            </div>
          )}
          {!selectionRetryable && selectionError instanceof ApiError && selectionError.status === 409 && (
            <div className="compare-state-actions">
              <button type="button" onClick={onRetrySelection}>{t('selectionReviewLatest')}</button>
            </div>
          )}
          {!selectionRetryable && selectionError instanceof ApiError && selectionError.status !== 409 && (
            <div className="compare-state-actions">
              <Link className="compare-state-link" to="/plan/new">{t('back')}</Link>
            </div>
          )}
        </section>
      )}

      {bundle.status !== 'no_feasible_plan' && bundle.alternatives.length < 2 && (
        <p className="compare-result-count" role="status">
          {locale === 'en'
            ? `${bundle.alternatives.length} alternative(s) meet the current conditions. Only available plans are shown.`
            : `現在の条件で提示できる代替案は${bundle.alternatives.length}件です。成立した案のみ表示しています。`}
        </p>
      )}

      {bundle.status !== 'no_feasible_plan' && (
      <div className="compare-plan-grid">
        {bundle.baseline && (
          <PlanCard
            key={bundle.baseline.id}
            plan={bundle.baseline}
            title={titleFor(bundle.baseline, true)}
            spots={spots.data?.items ?? []}
            evidence={allEvidence}
            isSelecting={isSelecting}
            selectionDisabled={selectionError !== null}
            locale={locale}
            sourceLocale={bundle.effective_constraints.locale}
            formatTime={formatTime}
            onWhy={() => setWhyId(bundle.baseline!.id)}
            onSelect={() => onSelect(bundle.baseline!)}
          />
        )}
        {bundle.alternatives.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            title={titleFor(plan, false)}
            spots={spots.data?.items ?? []}
            evidence={allEvidence}
            isSelecting={isSelecting}
            selectionDisabled={selectionError !== null}
            locale={locale}
            sourceLocale={bundle.effective_constraints.locale}
            formatTime={formatTime}
            onWhy={() => setWhyId(plan.id)}
            onSelect={() => onSelect(plan)}
          />
        ))}
      </div>
      )}

      {whyPlan && (
        <WhyPanel
          plan={whyPlan}
          spots={spots.data?.items ?? []}
          evidence={allEvidence}
          effectiveConstraints={bundle.effective_constraints}
          onRefine={() => { setWhyId(null); setRefining(true) }}
          onClose={() => setWhyId(null)}
        />
      )}
      {refining && <RefineForm tripId={tripId} effectiveConstraints={bundle.effective_constraints} expectedVersion={bundle.base_version} onClose={() => setRefining(false)} />}
    </section>
  )
}
