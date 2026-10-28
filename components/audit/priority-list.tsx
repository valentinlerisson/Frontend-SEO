'use client'

import { ArrowDown } from 'lucide-react'

type PriorityItem = {
  type: 'alert' | 'optimization'
  text: string
  section?: number
  /** L'anomalie retire des points au score de la page */
  affectsScore?: boolean
  /** Points en jeu sur 100 (avant normalisation) */
  maxPoints?: number | null
}

function Row({ item, onGo }: { item: PriorityItem; onGo: (section: number) => void }) {
  const clickable = item.section !== undefined
  const content = (
    <>
      <span className={`shrink-0 font-bold ${item.type === 'alert' ? 'text-[#ef4444]' : 'text-primary-ink'}`}>
        {item.type === 'alert' ? 'À corriger :' : 'À améliorer :'}
      </span>
      <span className="min-w-0 flex-1 text-left text-foreground">{item.text}</span>
      {item.affectsScore && item.maxPoints ? (
        <span className="shrink-0 rounded-md border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary-ink">
          {item.maxPoints >= 100 ? 'score à 0' : `jusqu’à ${item.maxPoints} pts`}
        </span>
      ) : null}
      {clickable && (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-primary-ink">
          Voir le détail
          <ArrowDown className="size-3.5" aria-hidden="true" />
        </span>
      )}
    </>
  )

  return clickable ? (
    <button
      type="button"
      onClick={() => onGo(item.section as number)}
      className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-foreground/5"
    >
      {content}
    </button>
  ) : (
    <div className="flex items-start gap-2 px-1.5 py-1">{content}</div>
  )
}

/**
 * Points à traiter d'un onglet du tiroir d'inspection, séparés en deux groupes : ceux qui retirent des points
 * au score de la page, et les recommandations sans effet sur le score. Chaque point renvoie vers le bloc concerné.
 */
export function PriorityList({
  items,
  onGo,
}: {
  items: PriorityItem[]
  onGo: (section: number) => void
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground sm:text-sm">Aucun point à traiter détecté sur cet onglet.</p>
  }

  const scored = items.filter((item) => item.affectsScore)
  const unscored = items.filter((item) => !item.affectsScore)

  const group = (title: string, hint: string, list: PriorityItem[]) =>
    list.length === 0 ? null : (
      <div>
        <h5 className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title} <span className="font-normal normal-case">({list.length}) · {hint}</span>
        </h5>
        <ul className="mt-1 space-y-1 text-xs sm:text-sm">
          {list.map((item, index) => (
            <li key={index}>
              <Row item={item} onGo={onGo} />
            </li>
          ))}
        </ul>
      </div>
    )

  return (
    <div className="space-y-3">
      {group('Font varier le score', 'à corriger pour le faire monter', scored)}
      {group('Sans effet sur le score', 'recommandations utiles, mais n’entrent pas dans la note', unscored)}
    </div>
  )
}
