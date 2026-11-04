'use client'

import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import { PAGE_ROLES, ROLE_LABEL } from '@/core/domain/scoring/page-role'
import { GOAL_HINT, GOAL_LABEL, PAGE_GOALS } from '@/core/domain/scoring/page-goal'
import type { PageGoal, PageRole } from '@/core/domain/types'

type Props = {
  pageId: string
  path: string
  role: PageRole
  roleSource: 'manual' | 'ai' | 'auto'
  roleReason?: string
  goal: PageGoal
  goalSource: 'manual' | 'auto'
  /** L'analyse de l'IA a été faite sous un autre objectif */
  goalStale?: boolean
  /** compact : tableau des sous-pages ; full : tiroir de la page, avec explications */
  variant: 'compact' | 'full'
  disabled?: boolean
  onError?: (message: string | null) => void
}

const ROLE_ORIGIN = { manual: 'Choisi par vous', ai: 'Corrigé par l’IA', auto: 'Déduit' } as const
const GOAL_ORIGIN = { manual: 'Choisi par vous', auto: 'Déduit du rôle' } as const

function Origin({ manual, label }: { manual: boolean; label: string }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-px text-[10px] font-semibold ${
        manual ? 'border-primary/60 text-primary-ink' : 'border-shade-44 text-muted-foreground'
      }`}
    >
      {label}
    </span>
  )
}

/**
 * Rôle (ce qu'est la page) et objectif (ce qu'on en attend), modifiables au même endroit : dans le tableau des
 * sous-pages et dans le tiroir de la page. Chaque changement est enregistré puis les notes sont recalculées ; un
 * objectif nouveau peut relancer l'analyse de l'IA pour cette page (un appel).
 */
export function PageRoleGoal({ pageId, path, role, roleSource, roleReason, goal, goalSource, goalStale, variant, disabled, onError }: Props) {
  const { auditDbId, refreshAudit } = useAudit()
  const [busy, setBusy] = useState<'role' | 'goal' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const full = variant === 'full'

  const save = async (kind: 'role' | 'goal', body: { role: PageRole } | { goal: PageGoal }) => {
    if (!auditDbId) return
    setBusy(kind)
    setError(null)
    onError?.(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`)
      await refreshAudit()
    } catch (err) {
      const message = err instanceof Error ? err.message : kind === 'role' ? 'Correction du rôle impossible' : 'Changement de l’objectif impossible'
      setError(message)
      onError?.(message)
    } finally {
      setBusy(null)
    }
  }

  const selectClass =
    'w-full truncate rounded-lg border border-shade-44 bg-shade-18 px-2 text-foreground focus:border-primary focus:outline-none disabled:opacity-50 ' +
    (full ? 'py-1.5 text-sm font-semibold' : 'py-1 text-xs')
  const labelClass = 'text-[10px] font-semibold uppercase tracking-wide text-indigo-pale'

  return (
    <div className={full ? 'grid gap-3 sm:grid-cols-2' : 'flex flex-col gap-2'}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor={`${id}-role`} className={labelClass}>
            Rôle
          </label>
          <Origin manual={roleSource !== 'auto'} label={ROLE_ORIGIN[roleSource]} />
          {busy === 'role' && <Loader2 className="size-3 animate-spin text-muted-foreground" aria-label="Enregistrement" />}
        </div>
        <select
          id={`${id}-role`}
          value={role}
          disabled={disabled || busy !== null}
          onChange={(e) => save('role', { role: e.target.value as PageRole })}
          aria-label={`Rôle de ${path}`}
          title={roleReason ?? 'Ce qu’est la page : modifiable'}
          className={selectClass}
        >
          {PAGE_ROLES.map((item) => (
            <option key={item} value={item}>
              {ROLE_LABEL[item]}
            </option>
          ))}
        </select>
        {full && (
          <p className="text-xs text-muted-foreground">
            Ce qu’est la page. {roleSource === 'ai' && roleReason ? `Corrigé par l’IA : ${roleReason}` : 'Il adapte les attentes (un auteur ne se demande qu’à un article).'}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor={`${id}-goal`} className={labelClass}>
            Objectif
          </label>
          <Origin manual={goalSource === 'manual'} label={GOAL_ORIGIN[goalSource]} />
          {busy === 'goal' && <Loader2 className="size-3 animate-spin text-muted-foreground" aria-label="Enregistrement" />}
        </div>
        <select
          id={`${id}-goal`}
          value={goal}
          disabled={disabled || busy !== null}
          onChange={(e) => save('goal', { goal: e.target.value as PageGoal })}
          aria-label={`Objectif de ${path}`}
          title={GOAL_HINT[goal]}
          className={selectClass}
        >
          {PAGE_GOALS.map((item) => (
            <option key={item} value={item}>
              {GOAL_LABEL[item]}
            </option>
          ))}
        </select>
        {full && <p className="text-xs text-muted-foreground">Ce qu’on attend d’elle. {GOAL_HINT[goal]}</p>}
        {goalStale && (
          <p className="text-[11px] text-sky-soft">
            {full
              ? 'L’analyse de l’IA date d’un autre objectif : relancez-la pour obtenir des pistes adaptées.'
              : 'Analyse faite sous un autre objectif : à relancer.'}
          </p>
        )}
      </div>
      {error && !onError && (
        <p role="alert" className="text-xs text-red-soft sm:col-span-2">
          {error}
        </p>
      )}
    </div>
  )
}
