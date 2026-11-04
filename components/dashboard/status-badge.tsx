import { AlertTriangle, CheckCircle2, ListChecks, Loader2 } from 'lucide-react'
import type { AuditStatus } from '@/lib/projects'

type StatusBadgeProps = {
  status: AuditStatus
  progress: number
}

/** État du dernier audit, écrit en toutes lettres avec une icône (la couleur n'est jamais seule) */
export function StatusBadge({ status, progress }: StatusBadgeProps) {
  const base = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold'

  if (status === 'crawling') {
    return (
      <span className={`${base} border-primary/60 text-primary-ink`}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Exploration <span className="tabular-nums">{progress} %</span>
      </span>
    )
  }
  if (status === 'analyzing') {
    return (
      <span className={`${base} border-primary/60 text-primary-ink`}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Analyse IA en cours
      </span>
    )
  }
  if (status === 'awaiting') {
    return (
      <span className={`${base} border-[#38bdf8]/50 text-sky-soft`}>
        <ListChecks className="size-3.5" aria-hidden="true" />
        Pages à choisir
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className={`${base} border-[#ef4444]/50 text-red-soft`}>
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        Échec
      </span>
    )
  }
  return (
    <span className={`${base} border-[#12b10f]/50 text-green-soft`}>
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      Terminé
    </span>
  )
}
