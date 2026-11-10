'use client'

import { useState } from 'react'
import { Plus, RotateCcw, Save } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import type { InspectionData } from '@/lib/audit-data'

/** Requêtes notées choisies à la main (le choix automatique en garde 4) */
const MAX_QUERIES = 6

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const SOURCE_LABEL = {
  volume: 'Volume',
  target: 'Requête cible',
  candidate: 'Suggérée par Google',
  manual: 'Choisie',
} as const

/**
 * Requêtes notées de la page : la note éditoriale (couverture, intention, concurrence entre pages) est la moyenne de
 * ces requêtes, pondérée par leur volume. Seules les requêtes notées sont listées : les autres mots-clés se cochent dans
 * « Mots-clés et volumes de recherche » et « Recherches hors page ». L'utilisateur décoche ou ajoute une requête
 * (6 au plus) ; la note est recalculée sans l'IA, l'intention d'une requête ajoutée est jugée à la prochaine analyse.
 */
export function QuerySetPanel({ pageId, editorial }: { pageId: string; editorial: InspectionData['editorial'] }) {
  const { auditDbId, refreshAudit } = useAudit()
  const set = editorial.querySet ?? []
  const keywords = editorial.keywords
  const realVolumes = Boolean(keywords?.provider && !keywords.simulated && !keywords.error)

  const initial = set.map((entry) => entry.query)
  const [chosen, setChosen] = useState<string[]>(initial)
  const [extra, setExtra] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = JSON.stringify(chosen) !== JSON.stringify(initial)
  const full = chosen.length >= MAX_QUERIES
  const toggle = (query: string) =>
    setChosen((current) =>
      current.includes(query) ? current.filter((item) => item !== query) : current.length < MAX_QUERIES ? [...current, query] : current
    )

  const save = async (queries: string[] | null) => {
    if (!auditDbId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `Erreur ${res.status}`)
      }
      setExtra([])
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible')
    } finally {
      setBusy(false)
    }
  }

  const add = () => {
    const query = draft.replace(/\s+/g, ' ').trim()
    if (!query || full || chosen.some((item) => normalize(item) === normalize(query))) return
    setExtra((current) => [...current, query])
    setChosen((current) => [...current, query])
    setDraft('')
  }

  const totalVolume = set.reduce((sum, entry) => sum + (entry.volume ?? 0), 0)
  const volumeText = (volume?: number) => (volume === undefined ? '–' : volume.toLocaleString('fr-FR'))

  return (
    <div className="space-y-2.5 rounded-xl border border-shade-33 bg-shade-1e p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Requêtes notées</h4>
        <span className="text-xs text-muted-foreground">
          {set.length > 0
            ? `Note calculée sur ${set.length} requête${set.length > 1 ? 's' : ''}${totalVolume > 0 ? ` · ${totalVolume.toLocaleString('fr-FR')} recherches/mois` : ''}`
            : 'Pas encore de requêtes notées : ré-analysez la page'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {realVolumes
          ? 'Les recherches les plus tapées (Google Keyword Planner), pondérées par leur volume, 50 % au plus chacune.'
          : 'Sans volumes réels : requête cible et recherches proposées que Google suggère, à poids égal.'}{' '}
        Couverture, intention et concurrence entre vos pages sont calculées pour chacune, puis moyennées. Jusqu’à 6 :
        cochez-en d’autres dans « Mots-clés et volumes de recherche » ou ajoutez-en une ci-dessous ; elles arrivent
        cochées dans Positionnement.
        {editorial.querySetManual ? ' Liste choisie par vous.' : ''}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-6 py-1.5 pr-2 font-medium" aria-label="Notée" />
              <th className="py-1.5 pr-2 font-medium">Requête</th>
              <th className="py-1.5 pr-2 text-right font-medium">Volume</th>
              <th className="py-1.5 pr-2 text-right font-medium">Poids</th>
              <th className="py-1.5 pr-2 font-medium">Placée dans la page</th>
              <th className="py-1.5 pr-2 font-medium">Intention</th>
              <th className="py-1.5 font-medium">Google</th>
            </tr>
          </thead>
          <tbody>
            {set.map((entry) => (
              <tr key={entry.query} className="border-t border-shade-33 align-top">
                <td className="py-1.5 pr-2">
                  <input
                    type="checkbox"
                    checked={chosen.includes(entry.query)}
                    disabled={busy}
                    onChange={() => toggle(entry.query)}
                    aria-label={`Noter la page sur « ${entry.query} »`}
                    className="mt-0.5 size-3.5 accent-[#f5e400]"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <span className="font-medium text-foreground">{entry.query}</span>
                  <span className="block text-[11px] text-muted-foreground">{SOURCE_LABEL[entry.source]}</span>
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-foreground">{volumeText(entry.volume)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-foreground">{Math.round(entry.weight * 100)} %</td>
                <td className="py-1.5 pr-2">
                  <span className={entry.coverage.score >= 12 ? 'text-green-soft' : 'text-amber-soft'}>{entry.coverage.score}/15</span>
                  {entry.coverage.missing.length > 0 && (
                    <span className="block text-[11px] text-muted-foreground">manque : {entry.coverage.missing.join(', ')}</span>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  {entry.intent === null ? (
                    <span className="text-sky-soft">À juger</span>
                  ) : (
                    <span className={entry.intent >= 12 ? 'text-green-soft' : 'text-sky-soft'}>{entry.intent}/15</span>
                  )}
                </td>
                <td className="py-1.5 text-muted-foreground">
                  {entry.position === undefined ? 'Non mesurée' : entry.position === null ? 'Hors des résultats lus' : `n°${entry.position}`}
                </td>
              </tr>
            ))}
            {/* Requêtes ajoutées à la main, pas encore enregistrées */}
            {extra
              .filter((query) => !set.some((entry) => entry.query === query))
              .map((query) => (
                <tr key={query} className="border-t border-shade-33 align-top opacity-80">
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={chosen.includes(query)}
                      disabled={busy || (!chosen.includes(query) && full)}
                      onChange={() => toggle(query)}
                      aria-label={`Noter la page sur « ${query} »`}
                      className="mt-0.5 size-3.5 accent-[#f5e400]"
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-foreground">{query}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-foreground">–</td>
                  <td className="py-1.5 pr-2 text-right text-muted-foreground" colSpan={4}>
                    Notée à l’enregistrement
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          maxLength={120}
          disabled={busy || full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={full ? `${MAX_QUERIES} requêtes au plus` : 'Ajouter une requête'}
          aria-label="Requête à ajouter aux requêtes notées"
          className="min-w-0 flex-1 rounded-lg border border-shade-44 bg-shade-16 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || full || !draft.trim()}
          aria-label="Ajouter la requête"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-primary/60 text-primary-ink hover:bg-primary/15 disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => save(chosen)}
          disabled={busy || !changed || chosen.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-[#e0d100] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="size-3.5" aria-hidden="true" /> Enregistrer
        </button>
        {editorial.querySetManual && (
          <button
            type="button"
            onClick={() => save(null)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" /> Choix automatique
          </button>
        )}
      </div>
      {set.some((entry) => entry.intent === null) && (
        <p className="text-xs text-sky-soft">
          Intention pas encore jugée pour certaines requêtes : elle compte dès la prochaine ré-analyse de la page. En
          attendant, la note d’intention repose sur les requêtes déjà jugées.
        </p>
      )}
      {error && <p className="text-xs text-[#ef4444]">{error}</p>}
    </div>
  )
}
