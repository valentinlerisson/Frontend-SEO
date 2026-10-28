import type { LucideIcon } from 'lucide-react'

type StatCardProps = {
  label: string
  value: number
  icon?: LucideIcon
}

export function StatCard({ label, value, icon: Icon }: StatCardProps) {
  return (
    <div className="flex flex-col justify-between glass-card glass-lift rounded-2xl border px-6 py-6 md:px-8">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xl font-medium md:text-2xl">{label}</p>
        {Icon && <Icon className="size-8 text-primary-ink" strokeWidth={2} aria-hidden="true" />}
      </div>
      <p className="mt-4 text-6xl font-semibold tabular-nums md:text-7xl">{value}</p>
    </div>
  )
}
