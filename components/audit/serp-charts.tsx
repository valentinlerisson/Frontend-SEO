'use client'

import type { SerpAnalysis } from '@/core/domain/types'
import type { ResultKind } from '@/core/domain/serp-insights'

/**
 * Graphiques des résultats Google, en SVG sans bibliothèque. Couleurs lisibles en clair et en sombre, toujours
 * doublées d'un mot ou d'un chiffre (la couleur n'est jamais seule), et un tableau équivalent pour les lecteurs d'écran.
 */

const DEPTH = 30

function shortLabel(serp: SerpAnalysis) {
  const query = serp.query.length > 34 ? `${serp.query.slice(0, 32)}…` : serp.query
  return `« ${query} »${serp.zone ? ` · ${serp.zone.city}` : ''}`
}

/** Échelle 1 → 30 : un point par recherche et par zone ; absente du Top 30 à droite */
export function PositionScale({ measures }: { measures: SerpAnalysis[] }) {
  const rows = measures.filter((serp) => serp.status === 'DONE')
  if (rows.length === 0) return null
  const rankOf = (serp: SerpAnalysis) => serp.pagePosition ?? serp.pageSitelinkOf ?? null
  const x = (rank: number) => ((rank - 1) / (DEPTH - 1)) * 100
  return (
    <figure className="rounded-xl border border-shade-33 bg-shade-1e p-4">
      <figcaption className="text-sm font-bold text-foreground">Où se situe la page</figcaption>
      <p className="text-xs text-muted-foreground">Position dans Google pour chaque recherche mesurée (1 = premier résultat).</p>
      <div className="mt-3 flex flex-col gap-2.5" aria-hidden="true">
        <div className="ml-[38%] flex justify-between text-[10px] text-muted-foreground sm:ml-[30%]">
          <span>1</span>
          <span>10</span>
          <span>20</span>
          <span>30</span>
          <span className="w-10 text-right">Absente</span>
        </div>
        {rows.map((serp) => {
          const rank = rankOf(serp)
          return (
            <div key={`${serp.query}-${serp.zone?.id ?? 'z'}`} className="flex items-center gap-2">
              <span className="w-[38%] truncate text-xs text-foreground sm:w-[30%]" title={shortLabel(serp)}>
                {shortLabel(serp)}
              </span>
              <div className="relative h-5 flex-1">
                {/* Zones : Top 3, page 1, pages 2 et 3 */}
                <div className="absolute inset-y-1.5 left-0 right-10 flex overflow-hidden rounded-full">
                  <span className="h-full bg-[#12b10f]/25" style={{ width: `${x(3.5)}%` }} />
                  <span className="h-full bg-[#f5e400]/25" style={{ width: `${x(10.5) - x(3.5)}%` }} />
                  <span className="h-full flex-1 bg-shade-38" />
                </div>
                <div className="absolute inset-y-1.5 right-0 w-8 rounded-full bg-[#38bdf8]/20" />
                {/* Point : sur la piste 1 → 30, ou dans la case « absente » à droite */}
                <div className={rank === null ? 'absolute inset-y-0 right-0 w-8' : 'absolute inset-y-0 left-0 right-10'}>
                  <span
                    className={`absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[9px] font-bold ${
                      rank === null ? 'border-[#38bdf8] bg-background text-sky-soft' : 'border-foreground bg-primary text-primary-foreground'
                    }`}
                    style={{ left: rank === null ? '50%' : `${x(Math.min(rank, DEPTH))}%` }}
                  >
                    {rank ?? '–'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span><span className="mr-1 inline-block size-2 rounded-full bg-[#12b10f]/60" />Top 3</span>
          <span><span className="mr-1 inline-block size-2 rounded-full bg-[#f5e400]/70" />Page 1</span>
          <span><span className="mr-1 inline-block size-2 rounded-full bg-shade-44" />Pages 2 et 3</span>
          <span><span className="mr-1 inline-block size-2 rounded-full bg-[#38bdf8]/60" />Absente du Top 30</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>Position de la page par recherche</caption>
        <tbody>
          {rows.map((serp) => (
            <tr key={`${serp.query}-${serp.zone?.id ?? 'z'}-t`}>
              <th scope="row">{shortLabel(serp)}</th>
              <td>{rankOf(serp) ?? 'absente du Top 30'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

const KIND: Record<ResultKind, { label: string; color: string; text: string }> = {
  own: { label: 'Votre site', color: '#f5e400', text: '#111' },
  competitor: { label: 'Concurrents directs', color: '#64748b', text: '#fff' },
  directory: { label: 'Annuaires et plateformes', color: '#f59e0b', text: '#111' },
  public: { label: 'Sites publics', color: '#14b8a6', text: '#111' },
}

/** Qui occupe le Top 10 : une case par position, colorée et étiquetée par type de site */
export function TopTenBar({ items, query }: { items: { position: number; domain: string; kind: ResultKind }[]; query: string }) {
  if (items.length === 0) return null
  const counts = (Object.keys(KIND) as ResultKind[]).map((kind) => ({ kind, count: items.filter((item) => item.kind === kind).length }))
  return (
    <figure className="rounded-xl border border-shade-33 bg-shade-1e p-4">
      <figcaption className="text-sm font-bold text-foreground">Qui occupe le Top 10</figcaption>
      <p className="text-xs text-muted-foreground">Sur « {query} » : la place est-elle prenable ?</p>
      <div className="mt-3 grid grid-cols-10 gap-0.5" aria-hidden="true">
        {items.map((item) => (
          <span
            key={item.position}
            title={`${item.position}. ${item.domain} (${KIND[item.kind].label})`}
            className="flex h-9 items-center justify-center rounded-sm text-[11px] font-bold first:rounded-l-lg last:rounded-r-lg"
            style={{ background: KIND[item.kind].color, color: KIND[item.kind].text }}
          >
            {item.position}
          </span>
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {counts
          .filter((entry) => entry.count > 0)
          .map((entry) => (
            <li key={entry.kind} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: KIND[entry.kind].color }} aria-hidden="true" />
              <span className="text-foreground">{KIND[entry.kind].label}</span>
              <span className="font-semibold text-foreground">{entry.count}</span>
            </li>
          ))}
      </ul>
      <table className="sr-only">
        <caption>Les 10 premiers résultats par type de site</caption>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.position}-t`}>
              <th scope="row">{item.position}</th>
              <td>{item.domain}</td>
              <td>{KIND[item.kind].label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
