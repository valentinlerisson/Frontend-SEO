'use client'

import { CheckCircle2, Circle } from 'lucide-react'
import type { QueryMatrixData } from '@/lib/audit-data'

const percent = (value: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0)

/** Barre fine d'une valeur : une seule teinte (accent des graphiques), piste discrète ; la valeur est écrite à côté */
function Meter({ value, max, width }: { value: number; max: number; width: string }) {
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full ${width}`} style={{ backgroundColor: 'var(--viz-track)' }} aria-hidden="true">
      <span className="block h-full rounded-full" style={{ width: `${percent(value, max)}%`, backgroundColor: 'var(--viz-accent)' }} />
    </span>
  )
}

type Cell = QueryMatrixData['rows'][number]['cells'][number]

/** Case de la grille de l'IA : cochée (vert) ou non (bleu, estimation à confirmer, jamais une alerte) */
function CheckCell({ cell, label }: { cell: Cell; label: string }) {
  if (cell.earned === null) {
    return (
      <span className="text-muted-foreground" title={`${label} : non jugée`}>
        —
      </span>
    )
  }
  const passed = cell.earned > 0
  const text = `${label} : ${passed ? `oui, ${cell.earned} pts` : 'non'}`
  return passed ? (
    <CheckCircle2 className="mx-auto size-4 text-green-ink" role="img" aria-label={text}>
      <title>{text}</title>
    </CheckCircle2>
  ) : (
    <Circle className="mx-auto size-4 text-sky-ink" role="img" aria-label={text}>
      <title>{text}</title>
    </Circle>
  )
}

/** Zone mesurée : points, barre, et mots de la requête absents quand il en manque une partie */
function ZoneCell({ cell, label }: { cell: Cell; label: string }) {
  const earned = cell.earned ?? 0
  const missing = cell.missing ?? []
  const partial = earned > 0 && missing.length > 0
  return (
    <span
      className="inline-flex flex-col items-center gap-1"
      title={`${label} : ${missing.length === 0 ? 'requête entière présente' : `manque ${missing.map((word) => `« ${word} »`).join(', ')}`}`}
    >
      <span className={`tabular-nums ${earned === 0 ? 'text-muted-foreground' : 'text-foreground'}`}>
        {earned}/{cell.max}
      </span>
      <Meter value={earned} max={cell.max} width="w-10" />
      {partial && <span className="max-w-24 text-[10px] leading-tight text-muted-foreground">sans « {missing.join(' ')} »</span>}
    </span>
  )
}

/**
 * Tableau des requêtes notées d'un critère : une ligne par requête (volume et poids dans la note), une colonne par case
 * de la grille de l'IA ou par zone mesurée, la note de la requête et, en pied, la note du critère.
 */
export function QueryMatrix({ data, caption }: { data: QueryMatrixData; caption: string }) {
  const ai = data.source === 'ai'
  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-shade-2f bg-shade-14">
        <table className="w-full min-w-[26rem] border-collapse text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-shade-2f text-[11px] text-muted-foreground">
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Requête
              </th>
              {data.columns.map((column) => (
                <th key={column.label} scope="col" title={column.full} className="px-2 py-2 text-center font-medium">
                  {column.label}
                  <span className="block text-[10px] font-normal">{column.max} pts</span>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Note
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.query} className="border-b border-shade-2a last:border-b-0">
                <th scope="row" className="px-3 py-2 text-left align-middle font-normal">
                  <span className="block font-medium text-foreground">{row.query}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {row.volume !== undefined ? `${row.volume.toLocaleString('fr-FR')}/mois · ` : ''}
                    compte pour {Math.round(row.weight * 100)} %
                  </span>
                </th>
                {row.cells.map((cell, index) => (
                  <td key={index} className="px-2 py-2 text-center align-middle">
                    {ai ? <CheckCell cell={cell} label={data.columns[index].full} /> : <ZoneCell cell={cell} label={data.columns[index].full} />}
                  </td>
                ))}
                <td className="px-3 py-2 text-right align-middle">
                  {row.total === null ? (
                    <span className="text-[11px] text-muted-foreground">à juger</span>
                  ) : (
                    <span className="inline-flex flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums text-foreground">
                        {row.total}/{row.max}
                      </span>
                      <Meter value={row.total} max={row.max} width="w-14" />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-shade-2f bg-shade-19">
              <td colSpan={data.columns.length + 1} className="px-3 py-2 text-[11px] text-muted-foreground">
                Note du critère : moyenne des requêtes, chacune selon son poids
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                {data.result.earned}/{data.result.max}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <figcaption className="text-[11px] leading-relaxed text-muted-foreground">
        {ai ? (
          <>
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5 text-green-ink" aria-hidden="true" /> oui
            </span>
            {' · '}
            <span className="inline-flex items-center gap-1">
              <Circle className="size-3.5 text-sky-ink" aria-hidden="true" /> non
            </span>
            {' · estimation de l’IA. '}
            {data.columns.map((column, index) => (
              <span key={column.label}>
                <span className="font-semibold">{column.label}</span> : {column.full.charAt(0).toLowerCase() + column.full.slice(1)}
                {index < data.columns.length - 1 ? ' ; ' : '.'}
              </span>
            ))}
          </>
        ) : (
          'Mesuré : points de chaque zone selon la part des mots de la requête qu’elle contient (survolez une case pour les mots absents).'
        )}
      </figcaption>
    </figure>
  )
}
