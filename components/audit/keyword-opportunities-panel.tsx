'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import type { KeywordOpportunities, OpportunityKind, OpportunityRow, OpportunityStatus } from '@/core/domain/keyword-opportunities'
import { Trend } from './keyword-research-panel'
import { useQuerySetToggle } from './use-query-set-toggle'

const KIND_LABEL: Record<OpportunityKind, string> = {
  attribute: 'Précision sur le produit',
  occasion: 'Moment ou événement',
  synonym: 'Autre nom du sujet',
  product: 'Autre produit',
  brand: 'Marque d’un tiers',
}

const STATUS_LABEL: Record<OpportunityStatus, string> = {
  ready: 'Intégrable',
  confirm: 'À confirmer',
  'other-page': 'Autre page',
  'off-offer': 'Hors offre',
  rejected: 'Écartée',
}

const ZONES: { key: keyof OpportunityRow['presence']; label: string }[] = [
  { key: 'title', label: 'du Title' },
  { key: 'h1', label: 'du H1' },
  { key: 'h2', label: 'des sous-titres' },
]

const quoted = (words: string[]) => words.map((word) => `« ${word} »`).join(', ')

/** Explication du statut, tirée des seules vérifications du code */
function statusDetail(row: OpportunityRow): string {
  switch (row.status) {
    case 'ready': {
      const absent = ZONES.filter(({ key }) => !row.presence[key]).map(({ label }) => label)
      return absent.length > 0
        ? `Tous ses mots sont dans la page ; absente ${absent.join(', ')}.`
        : 'Tous ses mots sont dans la page, Title et H1 compris.'
    }
    case 'confirm':
      return `Absent de la page : ${quoted(row.missing)}. Cochez seulement si c’est vrai pour ce produit.`
    case 'other-page':
      return 'Sujet porté par une autre page du site.'
    case 'off-offer':
      return `Aucune page du site ne porte ${quoted(row.missing)}.`
    case 'rejected':
      return row.rejection === 'third-party-brand'
        ? `Marque d’un tiers${row.thirdPartyBrand ? ` (${row.thirdPartyBrand})` : ''}.`
        : row.rejection === 'low-volume'
          ? 'Moins de 20 recherches par mois.'
          : 'Aucun volume donné par Keyword Planner.'
  }
}

function Season({ row }: { row: OpportunityRow }) {
  const parts = [
    ...(row.peakRatio ? [`pic ×${row.peakRatio.toLocaleString('fr-FR')}`] : []),
    ...(row.recent ? ['nouvelle'] : []),
  ]
  return (
    <span className="inline-flex items-center gap-1.5">
      <Trend trend={row.trend} />
      {parts.length > 0 && <span className="text-[11px] text-sky-soft">{parts.join(' · ')}</span>}
    </span>
  )
}

/**
 * Recherches hors page : l'IA propose des recherches que les internautes tapent, même absentes de la page ; Keyword
 * Planner donne leur volume ; le code dit si la page peut les porter. Rien n'entre dans la note sans case cochée.
 */
export function KeywordOpportunitiesPanel({
  pageId,
  opportunities,
  scored = [],
}: {
  pageId: string
  opportunities?: KeywordOpportunities
  /** Requêtes notées actuelles de la page */
  scored?: string[]
}) {
  const { auditDbId, refreshAudit } = useAudit()
  const [running, setRunning] = useState(false)
  const { isScored, toggle, toggling, error, setError, full } = useQuerySetToggle(pageId, scored)
  const busy = running || toggling

  const run = async () => {
    if (!auditDbId) return
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/opportunities`, { method: 'POST' })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `Erreur ${res.status}`)
      }
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recherche impossible')
    } finally {
      setRunning(false)
    }
  }

  const rows = opportunities?.rows ?? []
  const shown = rows.filter((row) => row.status !== 'rejected')
  const rejected = rows.filter((row) => row.status === 'rejected')
  const volumeOf = (row: OpportunityRow) =>
    row.avgMonthlySearches === null ? 'Inconnu' : row.avgMonthlySearches.toLocaleString('fr-FR')

  const table = (list: OpportunityRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-xs">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-2 font-medium">Recherche</th>
            <th className="py-1.5 pr-2 text-right font-medium">Volume / mois</th>
            <th className="py-1.5 pr-2 font-medium">12 mois</th>
            <th className="py-1.5 pr-2 font-medium">Statut</th>
            <th className="py-1.5 font-medium">Notée</th>
          </tr>
        </thead>
        <tbody>
          {list.map((row) => {
            const scorable = row.status === 'ready' || row.status === 'confirm'
            return (
              <tr key={row.keyword} className="border-t border-shade-33 align-top">
                <td className="py-1.5 pr-2">
                  <span className="font-medium text-foreground">{row.keyword}</span>
                  <span className="block text-[11px] text-sky-soft">{KIND_LABEL[row.kind]} (IA)</span>
                  {row.evidence && (
                    <span className="block text-[11px] text-muted-foreground">Dans la page : « {row.evidence} »</span>
                  )}
                </td>
                <td className={`py-1.5 pr-2 text-right tabular-nums ${opportunities?.simulated ? 'text-sky-soft' : 'text-foreground'}`}>
                  {volumeOf(row)}
                </td>
                <td className="py-1.5 pr-2">
                  <Season row={row} />
                </td>
                <td className="py-1.5 pr-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      row.status === 'rejected' ? 'text-muted-foreground' : 'border border-line-indigo bg-tint-indigo text-sky-soft'
                    }`}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                  {row.broad && (
                    <span
                      title="Moins de 2 mots en commun avec la requête visée : volume souvent fort, mais la page y répond moins bien"
                      className="ml-1 rounded border border-line-indigo px-1.5 py-0.5 text-[11px] text-sky-soft"
                    >
                      Plus large
                    </span>
                  )}
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {statusDetail(row)}
                    {row.otherPage && (
                      <a href={row.otherPage.url} target="_blank" rel="noreferrer" className="ml-1 text-sky-soft underline">
                        {row.otherPage.title}
                      </a>
                    )}
                  </span>
                </td>
                <td className="py-1.5">
                  {scorable ? (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-foreground">
                      <input
                        type="checkbox"
                        checked={isScored(row.keyword)}
                        disabled={busy || opportunities?.simulated || (!isScored(row.keyword) && full)}
                        onChange={() => toggle(row.keyword)}
                        aria-label={
                          row.status === 'confirm'
                            ? `Confirmer que la page peut porter ${quoted(row.missing)} et la noter sur « ${row.keyword} »`
                            : `Noter la page sur « ${row.keyword} »`
                        }
                        className="size-3.5 accent-[#f5e400]"
                      />
                      {isScored(row.keyword) ? 'Oui' : ''}
                    </label>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-2.5 rounded-xl border border-shade-33 bg-shade-1e p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Recherches hors page</h4>
        <button
          type="button"
          disabled={busy}
          onClick={run}
          className="inline-flex items-center gap-1.5 rounded-md border border-shade-44 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          <Sparkles className={`size-3.5 ${running ? 'animate-pulse' : ''}`} />
          {running ? 'Recherche en cours…' : opportunities ? 'Relancer' : 'Chercher des recherches hors page'}
        </button>
      </div>

      {opportunities?.simulated && (
        <p className="rounded-lg border border-line-indigo bg-tint-indigo p-2.5 text-xs text-sky-soft">
          Volumes simulés : chiffres inventés pour tester l’écran. Les recherches ne peuvent pas être notées.
        </p>
      )}
      {error && <p className="text-xs text-[#ef4444]">{error}</p>}

      {!opportunities ? (
        <p className="text-xs text-muted-foreground">
          Quand le contenu de la page ne donne pas de bonnes recherches à viser : l’IA propose des recherches que les
          internautes tapent, même absentes de la page, Keyword Planner donne leur volume, puis le code vérifie si la
          page peut les porter. Un appel à l’IA, environ une minute. La note ne change que si vous cochez une recherche.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucune recherche nouvelle : l’IA n’a rien proposé au-delà des mots-clés déjà listés.</p>
      ) : (
        <>
          {shown.length > 0 ? table(shown) : <p className="text-xs text-muted-foreground">Toutes les recherches proposées ont été écartées.</p>}
          {rejected.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {rejected.length} recherche{rejected.length > 1 ? 's' : ''} écartée{rejected.length > 1 ? 's' : ''}
              </summary>
              <div className="mt-2">{table(rejected)}</div>
            </details>
          )}
          <p className="text-xs text-muted-foreground">
            Proposées par l’IA{opportunities.model ? ` (${opportunities.model})` : ''} le{' '}
            {new Date(opportunities.fetchedAt).toLocaleDateString('fr-FR')} ; volumes Keyword Planner (France). « Intégrable » :
            tous ses mots sont déjà dans la page. « À confirmer » : des mots manquent, à cocher seulement si le fait est
            vrai. « Plus large » : moins de 2 mots en commun avec la requête visée de la page (volume souvent fort, mais la page y répond moins bien). « Pic » : mois le plus fort comparé à la moyenne sur 12 mois ; « nouvelle » : aucune recherche les 3
            premiers mois. Une recherche cochée devient une requête notée : elle compte dans la note, arrive dans la
            réécriture et dans l’onglet Positionnement.
          </p>
        </>
      )}
    </div>
  )
}
