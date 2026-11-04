import type { LucideIcon } from 'lucide-react'

type StatCardProps = {
  label: string
  value: string | number
  hint?: string
  icon?: LucideIcon
}

/** Tuile de chiffre clé, même présentation que les tuiles de la synthèse */
export function StatCard({ label, value, hint, icon: Icon }: StatCardProps) {
  return (
    <div className="glass-card glass-lift rounded-2xl border p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="block text-3xl font-extrabold tracking-tight tabular-nums text-foreground">{value}</span>
        {Icon && <Icon className="size-5 text-muted-foreground" aria-hidden="true" />}
      </div>
      <span className="mt-1 block text-sm font-semibold text-foreground">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}
