import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  APILoadingStatus,
  APIProvider,
  Map as GoogleMap,
  Marker,
  Polyline,
  useApiLoadingStatus,
  useMap,
} from '@vis.gl/react-google-maps'
import type { Locale, Plan, Spot } from '../../api/types'
import { env } from '../../config/env'
import { spotName } from '../compare/display'

interface ItineraryMapProps {
  plan: Plan
  spots: Spot[]
  locale: Locale
  selectedStopId: string | null
  onSelectStop: (stopId: string) => void
}

export function ItineraryMap(props: ItineraryMapProps) {
  const [loadError, setLoadError] = useState(false)
  const onMapError = useCallback(() => setLoadError(true), [])
  useEffect(() => {
    if (!env.googleMapsApiKey) return
    // The SDK can load successfully but reject a key/referrer afterwards.
    const target = window as typeof window & { gm_authFailure?: () => void }
    const previous = target.gm_authFailure
    const failure = () => { setLoadError(true); previous?.() }
    target.gm_authFailure = failure
    return () => { if (target.gm_authFailure === failure) target.gm_authFailure = previous }
  }, [])
  const spotsById = new Map(props.spots.map((spot) => [spot.id, spot]))
  const hasMappedStop = props.plan.stops.some((stop) => spotsById.has(stop.spot_id))

  if (!env.googleMapsApiKey) {
    return <MapFallback {...props} reason={props.locale === 'en'
      ? 'The map is unavailable. Use the numbered places and itinerary below.'
      : '地図は現在利用できません。番号付きの訪問先と時刻表で旅程を確認できます。'} />
  }
  if (!hasMappedStop) {
    return <MapFallback {...props} reason={props.locale === 'en'
      ? 'No itinerary stops have coordinates available for the map.'
      : '地図に表示できる座標を持つ訪問先がありません。'} />
  }

  return (
    <APIProvider
      apiKey={env.googleMapsApiKey}
      language={props.locale}
      region="JP"
      onError={onMapError}
    >
      <MapContent {...props} loadError={loadError} />
    </APIProvider>
  )
}

function MapContent({
  plan,
  spots,
  locale,
  selectedStopId,
  onSelectStop,
  loadError,
}: ItineraryMapProps & { loadError: boolean }) {
  const status = useApiLoadingStatus()
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    if (status === APILoadingStatus.LOADED) return
    const timer = window.setTimeout(() => setTimedOut(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [status])
  const map = useMap('itinerary-map')
  const spotsById = useMemo(() => new Map(spots.map((spot) => [spot.id, spot])), [spots])
  const markers = useMemo(
    () => plan.stops.flatMap((stop, index) => {
      const spot = spotsById.get(stop.spot_id)
      return spot ? [{ stop, spot, number: index + 1 }] : []
    }),
    [plan.stops, spotsById],
  )
  const positions = useMemo(
    () => markers.map(({ spot }) => ({ lat: spot.location.lat, lng: spot.location.lng })),
    [markers],
  )
  const markerGroups = useMemo(() => {
    const groups = new Map<string, typeof markers>()
    for (const marker of markers) {
      const key = `${marker.spot.location.lat},${marker.spot.location.lng}`
      groups.set(key, [...(groups.get(key) ?? []), marker])
    }
    return [...groups.values()]
  }, [markers])
  const selectedPosition = markers.find(({ stop }) => stop.id === selectedStopId)
  const previousSelectedStopId = useRef(selectedStopId)
  const hasMapExtent = positions.length > 1
    && (new Set(positions.map((position) => `${position.lat},${position.lng}`))).size > 1
  const defaultBounds = hasMapExtent
    ? {
        north: Math.max(...positions.map((position) => position.lat)),
        south: Math.min(...positions.map((position) => position.lat)),
        east: Math.max(...positions.map((position) => position.lng)),
        west: Math.min(...positions.map((position) => position.lng)),
        padding: 48,
      }
    : undefined
  const center = positions[0] ?? { lat: 35.181, lng: 136.9 }

  useEffect(() => {
    if (map && selectedPosition && previousSelectedStopId.current !== selectedStopId) {
      map.panTo({
        lat: selectedPosition.spot.location.lat,
        lng: selectedPosition.spot.location.lng,
      })
    }
    previousSelectedStopId.current = selectedStopId
  }, [map, selectedPosition, selectedStopId])

  if (loadError || (timedOut && status !== APILoadingStatus.LOADED) || status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) {
    return (
      <MapFallback
        plan={plan}
        spots={spots}
        locale={locale}
        selectedStopId={selectedStopId}
        onSelectStop={onSelectStop}
        reason={locale === 'en'
          ? 'Google Maps could not load. The itinerary list remains available.'
          : 'Google Mapsを読み込めませんでした。時刻表は引き続き利用できます。'}
      />
    )
  }

  if (status !== APILoadingStatus.LOADED) {
    return <p role="status" className="trip-map-status">
      {locale === 'en' ? 'Loading Google Maps…' : 'Google Mapsを読み込んでいます…'}
    </p>
  }

  const routeCoordinates = plan.stops.map((stop) => {
    const spot = spotsById.get(stop.spot_id)
    return spot ? { lat: spot.location.lat, lng: spot.location.lng } : null
  })
  const hasCompleteRouteCoordinates = routeCoordinates.every(
    (position): position is { lat: number; lng: number } => position !== null,
  )

  return (
    <div className="trip-map-content">
      <p className="trip-map-explanation">
        {locale === 'en'
          ? 'Dashed lines show itinerary order only, not walking routes.'
          : '点線は訪問順の概略です。道路に沿った徒歩経路ではありません。'}
      </p>
      <GoogleMap
        id="itinerary-map"
        className="trip-map-canvas"
        defaultCenter={center}
        defaultZoom={15}
        defaultBounds={defaultBounds}
        gestureHandling="cooperative"
        clickableIcons={false}
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
      >
        {hasCompleteRouteCoordinates && routeCoordinates.length > 1 && (
          <Polyline
            path={routeCoordinates}
            strokeOpacity={0}
            icons={[{
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
              offset: '0',
              repeat: '12px',
            }]}
          />
        )}
        {markerGroups.map((group) => {
          const selectedIndex = group.findIndex(({ stop }) => stop.id === selectedStopId)
          const active = group[selectedIndex >= 0 ? selectedIndex : 0]
          const title = group.map(({ stop, spot, number }) =>
            `${number}. ${spotName(spot, stop.spot_id, locale)} (${roleLabel(stop.role, locale)})`,
          ).join(' / ')
          return (
            <Marker
              key={group.map(({ stop }) => stop.id).join('-')}
              position={{ lat: active.spot.location.lat, lng: active.spot.location.lng }}
              title={title}
              label={{
                text: group.map(({ number }) => number).join('/'),
                color: '#ffffff',
                fontWeight: '700',
              }}
              icon={{
                path: 'M 0,0 a 1,1 0 1,0 0.0001,0',
                scale: selectedIndex >= 0 ? 17 : 14,
                fillColor: selectedIndex >= 0 ? '#1d4ed8' : '#dc2626',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
              }}
              onClick={() => {
                const nextIndex = selectedIndex < 0 ? 0 : (selectedIndex + 1) % group.length
                onSelectStop(group[nextIndex].stop.id)
              }}
            />
          )
        })}
      </GoogleMap>
      {!hasCompleteRouteCoordinates && (
        <p className="trip-map-status">
          {locale === 'en'
            ? 'Some stops have no coordinates, so the complete visit-order line is omitted.'
            : '座標のない訪問先があるため、訪問順の線は全体を表示していません。'}
        </p>
      )}
      <StopIndex
        plan={plan}
        spotsById={spotsById}
        locale={locale}
        selectedStopId={selectedStopId}
        onSelectStop={onSelectStop}
      />
      <p className="trip-map-attribution">Map data © Google</p>
    </div>
  )
}

function StopIndex({
  plan,
  spotsById,
  locale,
  selectedStopId,
  onSelectStop,
}: {
  plan: Plan
  spotsById: Map<string, Spot>
  locale: Locale
  selectedStopId: string | null
  onSelectStop: (stopId: string) => void
}) {
  return (
    <ol className="trip-map-stop-index" aria-label={locale === 'en' ? 'Map stop list' : '地図の訪問先一覧'}>
      {plan.stops.map((stop, index) => {
        const spot = spotsById.get(stop.spot_id)
        const role = stop.role === 'origin'
          ? (locale === 'en' ? 'Start' : '出発')
          : stop.role === 'destination'
            ? (locale === 'en' ? 'Return' : '帰着')
            : null
        return (
          <li key={stop.id}>
            <button
              type="button"
              aria-pressed={selectedStopId === stop.id}
              onClick={() => onSelectStop(stop.id)}
            >
              <span className="trip-map-stop-number">{index + 1}</span>
              <span>{spotName(spot, stop.spot_id, locale)}</span>
              {role && <span className="trip-map-stop-role">{role}</span>}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function roleLabel(role: Plan['stops'][number]['role'], locale: Locale) {
  if (role === 'origin') return locale === 'en' ? 'Start' : '出発'
  if (role === 'destination') return locale === 'en' ? 'Return' : '帰着'
  return locale === 'en' ? 'Visit' : '訪問'
}

function MapFallback({
  plan,
  spots = [],
  locale,
  selectedStopId,
  onSelectStop,
  reason,
}: ItineraryMapProps & { reason: string }) {
  const spotsById = new Map(spots.map((spot) => [spot.id, spot]))
  return (
    <div className="trip-map-fallback">
      <p role="status">{reason}</p>
      {plan && (
        <StopIndex
          plan={plan}
          spotsById={spotsById}
          locale={locale}
          selectedStopId={selectedStopId}
          onSelectStop={onSelectStop}
        />
      )}
      <p className="trip-map-attribution">
        {locale === 'en' ? 'Map tiles and attribution are provided by Google when the map is available.' : '地図が表示される場合、地図と帰属表示はGoogle Mapsが提供します。'}
      </p>
    </div>
  )
}
