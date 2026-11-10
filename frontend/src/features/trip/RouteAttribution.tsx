import type { Evidence, Locale, Plan } from '../../api/types'

/** Attribute only providers actually referenced by the itinerary's walking legs. */
export function RouteAttribution({ plan, evidence, locale }: { plan: Plan; evidence: Evidence[]; locale: Locale }) {
  const ids = new Set(plan.legs.flatMap((leg) => leg.evidence_ids))
  const google = evidence.some((source) => ids.has(source.id) && /google maps/i.test(source.provider))
  if (!google) return null
  return <p className="route-attribution">{locale === 'en' ? 'Routes: ' : '経路：'}<span lang="en">Google Maps</span> · {locale === 'en' ? 'Estimated walking time and distance; not measured.' : '徒歩時間・距離は推定値です。実測値ではありません。'}</p>
}
