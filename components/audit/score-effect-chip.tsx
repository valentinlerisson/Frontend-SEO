import type { ScoreEffect } from '@/lib/score-effect'

const LABEL: Record<ScoreEffect, string> = {
  counts: 'Compte dans le score',
  partial: 'Compte en partie',
  none: 'Hors score',
}

const STYLE: Record<ScoreEffect, string> = {
  counts: 'border-primary/60 bg-primary/10 text-primary-ink',
  partial: 'border-primary/40 bg-primary/5 text-primary-ink/80',
  none: 'border-shade-44 bg-shade-2f text-muted-foreground',
}

/** Indique si un bloc ou une anomalie fait varier le score de la page */
export function ScoreEffectChip({ effect }: { effect?: ScoreEffect }) {
  if (!effect) return null
  return (
    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${STYLE[effect]}`}>
      {LABEL[effect]}
    </span>
  )
}
