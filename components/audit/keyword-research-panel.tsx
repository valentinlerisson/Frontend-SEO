'use client'

import { useState } from 'react'
import { Minus, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import { MAX_SCORED, useQuerySetToggle } from './use-query-set-toggle'
import type { KeywordResearch, KeywordRow } from '@/core/domain/keyword-research'

const ORIGIN_LABEL: Record<KeywordRow['origin'], string> = {
  target: 'Requête visée',
  candidate: 'Recherche proposée',
  page: 'Titres de la page',
  core: 'Version courte',
  idea: 'Idée voisine',
}

const COMPETITION_LABEL = { LOW: 'Faible', MEDIUM: 'Moyenne', HIGH: 'Forte' } as const

/** Avis de l'IA : seules les recherches « visées » sont notées d'office */
const RELEVANCE_LABEL = {
  match: 'visée par la page (IA)',
  broad: 'plus large que la page (IA), notée si vous la cochez',
  off: 'hors sujet (IA)',
} as const

const PRESENCE: { key: keyof KeywordRow['presence']; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'h1', label: 'H1' },
  { key: 'h2', label: 'H2/H3' },
  { key: 'text', label: 'Texte' },
]

export function Trend({ trend }: { trend?: KeywordRow['trend'] }) {
  if (trend === 'up') return <TrendingUp className="size-3.5 text-muted-foreground" aria-label="En hausse" />
  if (trend === 'down') return <TrendingDown className="size-3.5 text-muted-foreground" aria-label="En baisse" />
  if (trend === 'flat') return <Minus className="size-3.5 text-muted-foreground" aria-label="Stable" />
  return <span className="text-muted-foreground">–</span>
}

/**
 * Mots-clés de la page avec leur volume de recherche (Keyword Planner) et les endroits où ils figurent. La colonne
 * « Notée » ajoute ou retire un mot-clé des requêtes notées (6 au plus), qui font la note et partent dans Positionnement.
 */
export function KeywordResearchPanel({
  pageId,
  keywords,
  scored = [],
}: {
  pageId: string
  keywords?: KeywordResearch
  /** Requêtes notées actuelles de la page */
  scored?: string[]
}) {
  const { auditDbId, refreshAudit } = useAudit()
  const [running, setRunning] = useState(false)
  // Ajoute ou retire un mot-clé des requêtes notées : la note est recalculée sans l'IA
  const { isScored, toggle: toggleScored, toggling, error, setError } = useQuerySetToggle(pageId, scored)
  const busy = running || toggling

  const run = async () => {
    if (!auditDbId) return
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/keywords`, { method: 'POST' })
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

  const rows = keywords?.rows ?? []
  const volumeOf = (row: KeywordRow) =>
    row.avgMonthlySearches === null ? 'Inconnu' : row.avgMonthlySearches.toLocaleString('fr-FR')

  return (
    <div className="space-y-2.5 rounded-xl border border-shade-33 bg-shade-1e p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Mots-clés et volumes de recherche</h4>
        <button
          type="button"
          disabled={busy}
          onClick={run}
          className="inline-flex items-center gap-1.5 rounded-md border border-shade-44 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
          {keywords ? 'Actualiser' : 'Rechercher les mots-clés'}
        </button>
      </div>

      {keywords?.simulated && (
        <p className="rounded-lg border border-line-indigo bg-tint-indigo p-2.5 text-xs text-sky-soft">
          Volumes simulés : chiffres inventés pour tester l’écran, en attendant l’accès à Google Keyword Planner. Ne
          les utilisez pas pour décider.
        </p>
      )}
      {keywords && !keywords.provider && (
        <p className="rounded-lg border border-line-indigo bg-tint-indigo p-2.5 text-xs text-sky-soft">
          Aucune source de volumes configurée : les mots-clés sont listés sans volume.
        </p>
      )}
      {keywords?.warning && (
        <p className="rounded-lg border border-line-indigo bg-tint-indigo p-2.5 text-xs text-sky-soft">
          Dernière actualisation impossible ({keywords.warning}).
        </p>
      )}
      {keywords?.error && (
        <p className="rounded-lg border border-line-indigo bg-tint-indigo p-2.5 text-xs text-sky-soft">
          Volumes indisponibles : {keywords.error}
        </p>
      )}
      {error && <p className="text-xs text-[#ef4444]">{error}</p>}

      {!keywords ? (
        <p className="text-xs text-muted-foreground">
          Pas encore recherchés pour cette page. La recherche ne fait pas appel à l’IA et ne change pas la note.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucun mot-clé exploitable : le Title, le H1 et les sous-titres ne contiennent pas d’expression de deux mots
          porteurs de sens.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Mot-clé</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Volume / mois</th>
                  <th className="py-1.5 pr-2 font-medium">Tendance</th>
                  <th className="py-1.5 pr-2 font-medium">Concurrence pub.</th>
                  <th className="py-1.5 pr-2 font-medium">Présent dans</th>
                  <th className="py-1.5 font-medium">Notée</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.keyword} className="border-t border-shade-33 align-top">
                    <td className="py-1.5 pr-2">
                      <span className="font-medium text-foreground">{row.keyword}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {ORIGIN_LABEL[row.origin]}
                        {row.relevance
                          ? ` · ${RELEVANCE_LABEL[row.relevance]}`
                          : row.weak
                            ? ' · lien faible, notée seulement si vous la cochez'
                            : ''}
                      </span>
                    </td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums ${keywords.simulated ? 'text-sky-soft' : 'text-foreground'}`}>
                      {volumeOf(row)}
                    </td>
                    <td className="py-1.5 pr-2">
                      <Trend trend={row.trend} />
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground">
                      {row.competition ? COMPETITION_LABEL[row.competition] : '–'}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="flex flex-wrap gap-1">
                        {PRESENCE.map(({ key, label }) => (
                          <span
                            key={key}
                            className={`rounded px-1.5 py-0.5 text-[11px] ${
                              row.presence[key] ? 'bg-chip-indigo text-foreground' : 'text-muted-foreground line-through opacity-60'
                            }`}
                          >
                            {label}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-foreground">
                        <input
                          type="checkbox"
                          checked={isScored(row.keyword)}
                          disabled={busy || (!isScored(row.keyword) && scored.length >= MAX_SCORED)}
                          onChange={() => toggleScored(row.keyword)}
                          aria-label={`Noter la page sur « ${row.keyword} »`}
                          className="size-3.5 accent-[#f5e400]"
                        />
                        {isScored(row.keyword) ? 'Oui' : ''}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Un mot-clé est « présent » quand tous ses mots porteurs de sens y figurent, dans n’importe quel ordre
            (singulier et pluriel confondus, 1 000 premiers mots pour le texte). La concurrence est celle des annonces
            payantes, pas la difficulté SEO. Cochez « Notée » pour noter la page sur un mot-clé (6 au plus) : il
            compte dans la note et arrive coché dans l’onglet Positionnement.
          </p>
        </>
      )}
    </div>
  )
}
