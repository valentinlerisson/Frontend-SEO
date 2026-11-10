'use client'

import { useEffect, useMemo, useState } from 'react'
import { LocateFixed, MapPin, Plus, X } from 'lucide-react'
import type { LocalVisibility } from '@/lib/audit-data'
import { MAX_PROJECT_ZONES, type GeoZone } from '@/core/domain/zones'
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM, MIN_RADIUS_KM, clampRadius, type GeoPoint } from '@/core/domain/geo-radius'
import { zoneBand, type ZoneBand } from '@/core/domain/local-visibility'
import { ZonePicker } from './zone-picker'
import { ZoneVisibilityDetails } from './local-visibility-section'
import { BAND_LABEL, ZonesMap, type MapCommune, type MapPin as MapPinData, type MapZone } from './zones-map'

const BAND_SWATCH: Record<ZoneBand, string> = {
  top3: 'var(--viz-pos-1)',
  top10: 'var(--viz-pos-2)',
  top30: 'var(--viz-pos-3)',
  absent: 'var(--viz-absent)',
  unmeasured: 'transparent',
}

type Center = { point: GeoPoint; label: string; source: 'siege' | 'zone' | 'clic' }
type Located = GeoPoint & { name: string; code: string }

/** Centre de la commune d'une adresse, gardé le temps de la session */
const locateCache = new Map<string, Promise<Located | null>>()
function locate(postalCode: string, city: string): Promise<Located | null> {
  const key = `${postalCode}|${city}`
  if (!locateCache.has(key)) {
    locateCache.set(
      key,
      fetch(`/api/geo/locate?postalCode=${encodeURIComponent(postalCode)}&city=${encodeURIComponent(city)}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    )
  }
  return locateCache.get(key)!
}

/** Rayon choisi, gardé dans ce navigateur pour chaque projet (confort, jamais indispensable) */
function storedRadius(projectId: string): number {
  try {
    const value = Number(window.localStorage.getItem(`auditly:rayon:${projectId}`))
    return value ? clampRadius(value) : DEFAULT_RADIUS_KM
  } catch {
    return DEFAULT_RADIUS_KM
  }
}

/**
 * Zones ciblées et visibilité locale, en un bloc (onglet Positionnement) : choix des zones (3 au plus), carte des
 * zones colorées selon la meilleure position mesurée, siège et établissements, rayon réglable autour du siège (ou d'un
 * point cliqué) avec les villes qu'il contient, puis le détail par zone. Le rayon aide à choisir les villes : la
 * position Google n'est pas mesurée par distance, seulement par zone (nom ajouté à la fin de la recherche).
 */
export function LocalZonesSection({
  projectId,
  zones,
  visibility,
  onSaved,
}: {
  projectId: string
  zones: GeoZone[]
  visibility?: LocalVisibility
  onSaved: () => Promise<void> | void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM)
  const [center, setCenter] = useState<Center | null>(null)
  const [headquarters, setHeadquarters] = useState<Located | null>(null)
  const [pins, setPins] = useState<MapPinData[]>([])
  const [nearby, setNearby] = useState<{ communes: MapCommune[]; total: number } | null>(null)
  const [nearbyError, setNearbyError] = useState<string | null>(null)

  useEffect(() => setRadiusKm(storedRadius(projectId)), [projectId])
  const changeRadius = (value: number) => {
    const next = clampRadius(value)
    setRadiusKm(next)
    try {
      window.localStorage.setItem(`auditly:rayon:${projectId}`, String(next))
    } catch {
      // Stockage indisponible (navigation privée) : le rayon revient à sa valeur par défaut au prochain affichage
    }
  }

  const save = async (refs: { kind: GeoZone['kind']; code: string }[]) => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/zones`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zones: refs }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
      setSaved(true)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }
  const refsOf = (list: GeoZone[]) => list.map((zone) => ({ kind: zone.kind, code: zone.code }))
  const full = zones.length >= MAX_PROJECT_ZONES
  const addCommune = (commune: { code: string }) => {
    if (full || zones.some((zone) => zone.id === `commune:${commune.code}`)) return
    void save([...refsOf(zones), { kind: 'commune', code: commune.code }])
  }

  // Zones de la carte : celles du projet et celles propres à une page, avec leur meilleure position mesurée
  const mapZones: MapZone[] = useMemo(() => {
    const entries = visibility?.zones ?? zones.map((zone) => ({ zone, fromPage: false, measures: undefined }))
    return entries.map(({ zone, fromPage, measures }) => {
      const band = measures ? zoneBand(measures) : 'unmeasured'
      const detail =
        !measures || measures.measured === 0
          ? 'Pas encore mesurée'
          : measures.best
            ? `Meilleure position : n°${measures.best.rank} sur « ${measures.best.query} »`
            : `Absente du Top 30 sur ${measures.measured} recherche(s)`
      return { zone, band, detail: fromPage ? `${detail} · zone d’une page` : detail }
    })
  }, [visibility, zones])
  const unplaced = mapZones.filter((item) => item.zone.kind === 'pays' || item.zone.kind === 'lieu')

  // Siège et établissements placés au centre de leur commune
  const hq = visibility?.headquarters
  const establishmentsKey = (visibility?.establishments ?? []).map((item) => `${item.pageId}:${item.postalCode}`).join('|')
  useEffect(() => {
    let active = true
    const run = async () => {
      const found = hq ? await locate(hq.postalCode, hq.city) : null
      const establishments = (visibility?.establishments ?? []).slice(0, 15)
      const located = await Promise.all(establishments.map(async (item) => ({ item, point: await locate(item.postalCode, item.city) })))
      if (!active) return
      setHeadquarters(found)
      setPins([
        ...(found && hq ? [{ id: 'siege', label: 'Siège', detail: `${hq.postalCode} ${hq.city}`, point: found }] : []),
        ...located
          .filter((entry): entry is { item: (typeof establishments)[number]; point: Located } => Boolean(entry.point))
          .map(({ item, point }) => ({ id: item.pageId, label: item.title, detail: `${item.postalCode} ${item.city} · ${item.path}`, point })),
      ])
    }
    void run()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hq?.postalCode, hq?.city, establishmentsKey])

  // Centre par défaut : le siège, sinon la ville de référence de la première zone
  const firstZoneCity = mapZones.find((item) => item.zone.city)?.zone
  useEffect(() => {
    setCenter((current) => {
      if (current?.source === 'clic') return current
      if (headquarters) return { point: headquarters, label: `Siège : ${headquarters.name}`, source: 'siege' }
      if (firstZoneCity?.city) return { point: firstZoneCity.city, label: `Zone : ${firstZoneCity.city.name}`, source: 'zone' }
      return null
    })
  }, [headquarters, firstZoneCity?.id, firstZoneCity?.city])

  // Villes dans le rayon, après une courte pause pendant le réglage
  useEffect(() => {
    if (!center) {
      setNearby(null)
      return
    }
    let active = true
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/geo/nearby?lat=${center.point.latitude}&lon=${center.point.longitude}&radius=${radiusKm}`)
        const data = await res.json().catch(() => ({}))
        if (!active) return
        if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
        setNearby({ communes: data.communes ?? [], total: data.total ?? 0 })
        setNearbyError(null)
      } catch (err) {
        if (active) setNearbyError(err instanceof Error ? err.message : 'Villes du rayon indisponibles')
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [center, radiusKm])

  return (
    <section aria-labelledby="zones-title" className="glass-card relative z-10 rounded-2xl border p-4 md:p-6">
      <h2 id="zones-title" className="flex items-center gap-2 text-base font-bold text-foreground">
        <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
        Zones et visibilité locale
        <span className="text-xs font-normal text-muted-foreground">
          {zones.length} zone{zones.length > 1 ? 's' : ''} sur {MAX_PROJECT_ZONES}
        </span>
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Le nom de chaque zone est ajouté à la fin des recherches mesurées (« agence web » devient « agence web chartres »).
        Une page peut avoir sa propre zone, choisie dans sa ligne du tableau.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {zones.map((zone) => (
          <span
            key={zone.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-shade-44 py-1 pr-1.5 pl-3 text-sm text-foreground"
          >
            {zone.label}
            <button
              type="button"
              disabled={saving}
              onClick={() => save(refsOf(zones.filter((item) => item.id !== zone.id)))}
              aria-label={`Retirer la zone ${zone.label}`}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-shade-33 hover:text-foreground disabled:opacity-50"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        {zones.length === 0 && <span className="text-sm text-muted-foreground">Aucune zone : recherches mesurées sans lieu.</span>}
        {!full && (
          <div className="w-full sm:w-auto sm:min-w-[440px]">
            <ZonePicker
              disabled={saving}
              onPick={(zone) => {
                if (!zones.some((item) => item.id === zone.id)) void save([...refsOf(zones), { kind: zone.kind, code: zone.code }])
              }}
            />
          </div>
        )}
      </div>
      <p role="status" className="mt-1 min-h-4 text-xs">
        {error ? (
          <span className="text-red-soft">{error}</span>
        ) : saved ? (
          <span className="text-muted-foreground">
            Zones enregistrées. Les recherches proposées seront mises à jour à la prochaine analyse IA de chaque page.
          </span>
        ) : null}
      </p>

      <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <ZonesMap
            zones={mapZones}
            pins={pins}
            center={center?.point ?? null}
            radiusKm={radiusKm}
            communes={nearby?.communes ?? []}
            onCenterChange={(point) => setCenter({ point, label: 'Point choisi sur la carte', source: 'clic' })}
            onCommuneClick={addCommune}
          />
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="Légende de la carte">
            {(Object.keys(BAND_LABEL) as ZoneBand[]).map((band) => (
              <li key={band} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-block size-3 rounded-sm ${band === 'unmeasured' ? 'border border-dashed border-muted-foreground' : ''}`}
                  style={{ background: BAND_SWATCH[band] }}
                />
                {BAND_LABEL[band]}
              </li>
            ))}
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-3 rounded-full border-2 border-[#18181b] bg-primary" />
              Siège, établissement
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-3 rounded-full border-2 border-[var(--viz-accent)] bg-card" />
              Ville du rayon
            </li>
          </ul>
          {unplaced.length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Hors carte (pays ou autre lieu, sans contour) : {unplaced.map((item) => `${item.zone.label} (${item.detail.toLowerCase()})`).join(', ')}.
            </p>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-3 rounded-xl border border-shade-3e bg-shade-1e p-3.5" aria-label="Rayon autour du siège">
          <div>
            <label htmlFor="rayon" className="flex items-baseline justify-between text-sm font-semibold text-foreground">
              Rayon
              <span className="tabular-nums">{radiusKm} km</span>
            </label>
            <input
              id="rayon"
              type="range"
              min={MIN_RADIUS_KM}
              max={MAX_RADIUS_KM}
              step={1}
              value={radiusKm}
              onChange={(e) => changeRadius(Number(e.target.value))}
              className="mt-1 w-full accent-[#f5e400]"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {center ? center.label : 'Aucune adresse ni zone : cliquez sur la carte pour placer le centre.'}
              {center && ' · cliquez sur la carte pour le déplacer.'}
            </p>
            {headquarters && center?.source !== 'siege' && (
              <button
                type="button"
                onClick={() => setCenter({ point: headquarters, label: `Siège : ${headquarters.name}`, source: 'siege' })}
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary-ink hover:underline"
              >
                <LocateFixed className="size-3.5" aria-hidden="true" /> Recentrer sur le siège
              </button>
            )}
          </div>

          {center && (
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                {nearby ? `${nearby.total.toLocaleString('fr-FR')} commune${nearby.total > 1 ? 's' : ''} dans le rayon` : 'Communes du rayon…'}
                {nearby && nearby.total > nearby.communes.length ? ' · les plus peuplées' : ''}
              </p>
              {nearbyError && <p className="mt-1 text-xs text-red-soft">{nearbyError}</p>}
              <ul className="mt-1.5 flex flex-col gap-1">
                {(nearby?.communes ?? []).map((commune) => {
                  const already = zones.some((zone) => zone.id === `commune:${commune.code}`)
                  return (
                    <li key={commune.code} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{commune.name}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {commune.population.toLocaleString('fr-FR')} hab. · {commune.distanceKm.toLocaleString('fr-FR')} km
                        </span>
                      </span>
                      {already ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">Zone</span>
                      ) : (
                        <button
                          type="button"
                          disabled={saving || full}
                          onClick={() => addCommune(commune)}
                          title={full ? `${MAX_PROJECT_ZONES} zones au plus : retirez-en une` : `Ajouter ${commune.name} aux zones`}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-shade-44 px-2 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Plus className="size-3" aria-hidden="true" /> Zone
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              {full && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {MAX_PROJECT_ZONES} zones au plus : retirez-en une pour ajouter une ville.
                </p>
              )}
            </div>
          )}
          <p className="mt-auto text-[11px] text-muted-foreground">
            Le rayon aide à choisir les villes à cibler. Google n’est pas mesuré par distance : seulement par zone.
          </p>
        </aside>
      </div>

      {visibility && (
        <div className="mt-6">
          <ZoneVisibilityDetails data={visibility} />
        </div>
      )}
    </section>
  )
}
