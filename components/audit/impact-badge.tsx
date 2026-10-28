import type { ImpactLevel } from '@/lib/audit-data'
import { IMPACT_LABEL } from '@/lib/issue-impact'

const STYLE: Record<ImpactLevel, string> = {
  high: 'border-[#ef4444]/60 bg-[#ef4444]/10 text-red-soft',
  medium: 'border-[#eab308]/60 bg-[#eab308]/10 text-amber-soft',
  low: 'border-shade-4a bg-shade-2f text-muted-foreground',
  geo: 'border-[#818cf8]/60 bg-[#818cf8]/10 text-indigo-pale',
}

/** Impact de l'anomalie sur le classement Google (ou visibilité IA pour les anomalies GEO) */
export function ImpactBadge({ impact }: { impact: ImpactLevel }) {
  return (
    <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${STYLE[impact]}`}>
      {IMPACT_LABEL[impact]}
    </span>
  )
}
