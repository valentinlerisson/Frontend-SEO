'use client'

import { useState } from 'react'
import { Building2, MapPinned } from 'lucide-react'
import type { LocalVisibility } from '@/lib/audit-data'
import type { CoverageReason, ZoneMeasures } from '@/core/domain/local-visibility'

const REASON: Record<CoverageReason, string> = {
  zone: 'rattachée',
  title: 'nom dans le Title',
  h1: 'nom dans le H1',
  adresse: 'adresse',
}

/** Pack local en une phrase : ce qui est sûr (affiché ou non), puis ce qui dépend du repérage des fiches */
export function packText(measures: ZoneMeasures): string {
  if (measures.measured === 0) return '—'
  if (measures.packShown === 0) return 'Aucun pack'
  if (measures.packRead === 0) return `Pack sur ${measures.packShown} recherche(s), fiches non lues`
  return `Présent ${measures.packPresent} fois sur ${measures.packRead}`
}

/**
 * Visibilité par zone, sous la carte de l'onglet Positionnement : pour chaque zone, pages qui la couvrent, recherches
 * mesurées depuis elle, meilleure position et pack local ; puis les établissements repérés et leurs coordonnées.
 */
export function ZoneVisibilityDetails({ data }: { data: LocalVisibility }) {
  const [showAll, setShowAll] = useState(false)
  if (data.zones.length === 0 && data.establishments.length === 0) return null
  const establishments = showAll ? data.establishments : data.establishments.slice(0, 8)

  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <MapPinned className="size-4 text-muted-foreground" aria-hidden="true" />
        Visibilité par zone
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Calculée sur les mesures déjà faites, sans recherche Google en plus. Une zone est couverte par une page qui y est
        rattachée, qui la nomme dans son Title ou son H1, ou dont l’adresse s’y trouve (l’adresse du siège, présente sur
        toutes les pages, ne compte pas).
      </p>

      {data.zones.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                {['Zone', 'Pages dédiées', 'Visible dans Google', 'Meilleure position', 'Pack local'].map((head, index, list) => (
                  <th
                    key={head}
                    scope="col"
                    className={`bg-shade-38 px-3 py-2.5 font-normal ${index === 0 ? 'rounded-l-xl' : ''} ${index === list.length - 1 ? 'rounded-r-xl' : ''}`}
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.zones.map(({ zone, fromPage, coverage, measures }) => (
                <tr key={zone.id} className="align-top">
                  <th scope="row" className="border-b border-shade-3e px-3 py-3 font-normal">
                    <span className="block font-semibold text-foreground">{zone.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {fromPage ? 'Zone d’une page' : 'Zone du projet'}
                    </span>
                  </th>
                  <td className="border-b border-shade-3e px-3 py-3">
                    {coverage.length === 0 ? (
                      <span className="text-sky-soft">Aucune page dédiée</span>
                    ) : (
                      <ul className="flex flex-col gap-0.5 text-xs">
                        {coverage.slice(0, 4).map((page) => (
                          <li key={page.id}>
                            <span className="font-mono text-foreground">{page.path}</span>{' '}
                            <span className="text-muted-foreground">({REASON[page.reason]})</span>
                          </li>
                        ))}
                        {coverage.length > 4 && <li className="text-muted-foreground">et {coverage.length - 4} autre(s)</li>}
                      </ul>
                    )}
                  </td>
                  <td className="border-b border-shade-3e px-3 py-3">
                    {measures.measured === 0 ? (
                      <span className="text-xs text-muted-foreground">Pas encore mesurée</span>
                    ) : (
                      <span>
                        <strong className="text-foreground">{measures.visible}</strong>
                        <span className="text-muted-foreground"> recherche(s) sur {measures.measured}</span>
                      </span>
                    )}
                  </td>
                  <td className="border-b border-shade-3e px-3 py-3 text-xs">
                    {measures.best ? (
                      <>
                        <span className="font-semibold text-foreground">n°{measures.best.rank}</span>{' '}
                        <span className="text-muted-foreground">
                          sur « {measures.best.query} » ({measures.best.path})
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="border-b border-shade-3e px-3 py-3 text-xs text-muted-foreground">{packText(measures)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.establishments.length > 0 && (
        <div className="mt-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
            Établissements repérés ({data.establishments.length})
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Pages dont l’adresse diffère de celle du siège. Rattachez chacune à sa ville depuis sa ligne ci-dessous pour
            mesurer sa visibilité locale.
          </p>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {establishments.map((item) => (
              <li key={item.pageId} className="rounded-xl border border-shade-3e p-3 text-xs">
                <span className="block font-semibold text-foreground">{item.title}</span>
                <span className="block font-mono text-muted-foreground">{item.path}</span>
                <span className="mt-1 block text-foreground">
                  {item.postalCode} {item.city}
                  {item.phone ? ` · ${item.phone.replace(/(\d{2})(?=\d)/g, '$1 ')}` : ''}
                </span>
                <span className="mt-1 block">
                  {item.schemaConsistent === null ? (
                    <span className="text-sky-soft">Pas de balisage de coordonnées à comparer</span>
                  ) : item.schemaConsistent ? (
                    <span className="text-green-soft">Coordonnées conformes au balisage</span>
                  ) : (
                    <span className="text-amber-soft">Coordonnées différentes du balisage</span>
                  )}
                  {' · '}
                  <span className="text-muted-foreground">{item.zoneLabel ? `Zone : ${item.zoneLabel}` : 'Non rattaché'}</span>
                </span>
              </li>
            ))}
          </ul>
          {data.establishments.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="mt-2 text-xs font-semibold text-primary-ink hover:underline"
            >
              {showAll ? 'Afficher moins' : `Afficher les ${data.establishments.length} établissements`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
