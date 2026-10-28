'use client'

import { ChevronDown, Lightbulb } from 'lucide-react'
import type { EditorialAccordion } from '@/lib/audit-data'
import { InspectionItemRow } from './inspection-item-row'

function pointsClass(earned: number, max: number) {
  const ratio = earned / max
  if (ratio >= 0.75) return 'border-[#12b10f]/50 bg-[#12b10f]/10 text-green-soft'
  if (ratio >= 0.5) return 'border-[#eab308]/50 bg-[#eab308]/10 text-amber-soft'
  return 'border-[#ef4444]/50 bg-[#ef4444]/10 text-red-soft'
}

/**
 * Bloc de l'onglet SEO éditorial : titre, points (critère noté) ou état (diagnostic), constat en une phrase
 * visible même replié ; déplié, l'action à mener puis le détail des constats avec leur source.
 */
export function EditorialBlock({
  block,
  index,
  open,
  onToggle,
}: {
  block: EditorialAccordion
  index: number
  open: boolean
  onToggle: () => void
}) {
  const toFix = block.scoreText.endsWith('à revoir')
  return (
    <div id={`inspection-acc-${index}`} className="overflow-hidden rounded-xl border border-shade-33 bg-shade-1e">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 p-4 text-left transition-colors hover:bg-shade-25"
      >
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-foreground">{block.title}</span>
          {block.verdict && <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{block.verdict}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums ${
              block.points
                ? pointsClass(block.points.earned, block.points.max)
                : toFix
                  ? 'border-[#eab308]/50 bg-[#eab308]/10 text-amber-soft'
                  : 'border-shade-44 text-muted-foreground'
            }`}
          >
            {block.scoreText}
          </span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-shade-33 bg-shade-19 p-4 text-xs sm:text-sm">
          {block.action && (
            <div className="flex items-start gap-2.5 rounded-lg border border-primary/40 bg-primary/5 p-3 text-foreground">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary-ink" aria-hidden="true" />
              <p>
                <span className="font-semibold text-primary-ink">À faire : </span>
                {block.action}
              </p>
            </div>
          )}
          {block.verdict !== block.aiReasoning && block.aiReasoning && (
            <p className="text-xs text-muted-foreground">{block.aiReasoning}</p>
          )}
          <div className="space-y-2">
            {block.items.map((item, i) => (
              <InspectionItemRow key={i} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
