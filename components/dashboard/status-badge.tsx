import { Loader } from 'lucide-react'
import type { AuditStatus } from '@/lib/projects'

type StatusBadgeProps = {
  status: AuditStatus
  progress: number
}

export function StatusBadge({ status, progress }: StatusBadgeProps) {
  if (status === 'crawling') {
    return (
      <span className="inline-flex items-center gap-3 rounded-full bg-primary px-4 py-1 text-base font-medium whitespace-nowrap text-primary-foreground">
        <span>
          Crawling <span className="tabular-nums">({progress}%)</span>
        </span>
        <Loader className="size-4 animate-spin" aria-hidden="true" />
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full bg-success px-4 py-1 text-base font-medium text-success-foreground">
      Completed
    </span>
  )
}
