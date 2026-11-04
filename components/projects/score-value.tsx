import { scoreTone } from '@/lib/score-tone'

/** Note sur 100 colorée comme dans la synthèse, avec son niveau écrit ; tiret quand elle n'est pas encore calculée */
export function ScoreValue({ score, pendingLabel = 'À venir', compact = false }: { score: number | null; pendingLabel?: string; compact?: boolean }) {
  if (score === null) {
    return <span className="text-xs text-muted-foreground">{pendingLabel}</span>
  }
  const tone = scoreTone(score)
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="text-sm font-bold tabular-nums" style={{ color: tone.textColor }}>
        {score}
        <span className="font-normal text-muted-foreground">/100</span>
      </span>
      {!compact && <span className="text-[11px] text-muted-foreground">{tone.label}</span>}
    </span>
  )
}
