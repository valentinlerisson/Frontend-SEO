'use client'

import { useState } from 'react'
import { useAudit } from '@/components/providers/audit-provider'

/** Requêtes notées choisies à la main, au plus */
export const MAX_SCORED = 6

/**
 * Ajoute ou retire une recherche des requêtes notées d'une page (6 au plus) : la note est recalculée sans l'IA. Le
 * premier ajout part des requêtes notées actuelles, qui deviennent un choix de l'utilisateur.
 */
export function useQuerySetToggle(pageId: string, scored: string[]) {
  const { auditDbId, refreshAudit } = useAudit()
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const isScored = (keyword: string) => scored.some((query) => sameText(query, keyword))

  const toggle = async (keyword: string) => {
    if (!auditDbId) return
    const next = isScored(keyword) ? scored.filter((query) => !sameText(query, keyword)) : [...scored, keyword]
    if (next.length > MAX_SCORED) {
      setError(`${MAX_SCORED} requêtes notées au plus : décochez-en une.`)
      return
    }
    setToggling(true)
    setError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: next.length > 0 ? next : null }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `Erreur ${res.status}`)
      }
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Modification impossible')
    } finally {
      setToggling(false)
    }
  }

  return { isScored, toggle, toggling, error, setError, full: scored.length >= MAX_SCORED }
}
