'use client'

import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import { PAGE_ROLES, ROLE_LABEL } from '@/core/domain/scoring/page-role'
import { FAMILY_HINT, FAMILY_LABEL, familyOf } from '@/core/domain/scoring/page-family'
import type { PageFamily, PageRole } from '@/core/domain/types'

type Props = {
  pageId: string
  path: string
  role: PageRole
  roleSource: 'manual' | 'ai' | 'auto'
  roleReason?: string
  family: PageFamily
  /** L'analyse de l'IA a été faite sous une autre famille (ou un ancien objectif) */
  familyStale?: boolean
  /** compact : tableau des sous-pages ; full : tiroir de la page, avec explications */
  variant: 'compact' | 'full'
  disabled?: boolean
  onError?: (message: string | null) => void
}

const ROLE_ORIGIN = { manual: 'Choisi par vous', ai: 'Corrigé par l’IA', auto: 'Déduit' } as const

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
 * Rôle de la page (modifiable) et famille qui en découle (informer, présenter, non notée), dans le tableau des
 * sous-pages et dans le tiroir de la page. Un changement de rôle est enregistré puis les notes sont recalculées ; un
 * rôle d'une autre famille relance l'analyse de l'IA pour cette page (un appel).
 */
export function PageRoleFamily({ pageId, path, role, roleSource, roleReason, family, familyStale, variant, disabled, onError }: Props) {
  const { auditDbId, refreshAudit } = useAudit()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const full = variant === 'full'

  const save = async (next: PageRole) => {
    if (!auditDbId) return
    setBusy(true)
    setError(null)
    onError?.(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`)
      await refreshAudit()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Correction du rôle impossible'
      setError(message)
      onError?.(message)
    } finally {
      setBusy(false)
    }
  }

  const selectClass =
    'w-full truncate rounded-lg border border-shade-44 bg-shade-18 px-2 text-foreground focus:border-primary focus:outline-none disabled:opacity-50 ' +
    (full ? 'py-1.5 text-sm font-semibold' : 'py-1 text-xs')
  const labelClass = 'text-[10px] font-semibold uppercase tracking-wide text-indigo-pale'

  return (
    <div className={full ? 'grid gap-3 sm:grid-cols-2' : 'flex flex-col gap-1'}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor={`${id}-role`} className={labelClass}>
            Rôle
          </label>
          <Origin manual={roleSource !== 'auto'} label={ROLE_ORIGIN[roleSource]} />
          {busy && <Loader2 className="size-3 animate-spin text-muted-foreground" aria-label="Enregistrement" />}
        </div>
        <select
          id={`${id}-role`}
          value={role}
          disabled={disabled || busy}
          onChange={(e) => save(e.target.value as PageRole)}
          aria-label={`Rôle de ${path}`}
          title={roleReason ?? 'Ce qu’est la page : modifiable'}
          className={selectClass}
        >
          {PAGE_ROLES.map((item) => (
            <option key={item} value={item}>
              {full ? `${ROLE_LABEL[item]} (${FAMILY_LABEL[familyOf(item)].toLowerCase()})` : ROLE_LABEL[item]}
            </option>
          ))}
        </select>
        {full && (
          <p className="text-xs text-muted-foreground">
            Ce qu’est la page. {roleSource === 'ai' && roleReason ? `Corrigé par l’IA : ${roleReason}` : 'Il décide de la famille de la page et de ses critères.'}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        {full ? (
          <>
            <span className={labelClass}>Famille</span>
            <p className="rounded-lg border border-shade-44 px-2 py-1.5 text-sm font-semibold text-foreground">{FAMILY_LABEL[family]}</p>
            <p className="text-xs text-muted-foreground">Déduite du rôle. {FAMILY_HINT[family]}</p>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground" title={FAMILY_HINT[family]}>
            Famille : {FAMILY_LABEL[family]}
          </span>
        )}
        {familyStale && (
          <p className="text-[11px] text-sky-soft">
            {full
              ? 'L’analyse de l’IA date de l’ancien barème : relancez-la pour obtenir la grille de cette famille.'
              : 'Analyse de l’ancien barème : à relancer.'}
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
