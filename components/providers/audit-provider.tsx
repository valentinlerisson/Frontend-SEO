'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { ProjectAuditData, InspectionData } from '@/lib/audit-data'

export type AuditViewState = 'IDLE' | 'LOADING' | 'ERROR' | 'SUCCESS'

type AuditContextType = {
  projectId: string
  state: AuditViewState
  audit: ProjectAuditData | null
  auditDbId: string | null
  progress: number
  loading: boolean
  error: string | null
  refreshAudit: () => Promise<void>
  /** `targetQueries` : requêtes cibles saisies par l'utilisateur, par identifiant de page */
  savePillars: (pillarIds: string[], targetQueries?: Record<string, string>) => Promise<boolean>
  getInspection: (pageId: string) => InspectionData | null
}

const AuditContext = createContext<AuditContextType | null>(null)

const POLL_INTERVAL_MS = 3000
const IN_PROGRESS_STATUSES = ['QUEUED', 'CRAWLING_TECH', 'ANALYZING_AI']

export function AuditProvider({
  projectId,
  children,
}: {
  projectId: string
  children: React.ReactNode
}) {
  const [state, setState] = useState<AuditViewState>('LOADING')
  const [audit, setAudit] = useState<ProjectAuditData | null>(null)
  const [auditDbId, setAuditDbId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedOnce = useRef(false)

  const fetchAuditData = useCallback(async () => {
    try {
      // Affiche le skeleton uniquement au premier chargement, pas pendant le polling
      if (!hasLoadedOnce.current) setState('LOADING')
      const res = await fetch(`/api/projects/${projectId}/audit`, { cache: 'no-store' })

      if (res.status === 404) {
        setAudit(null)
        setAuditDbId(null)
        setError(null)
        setState('IDLE')
        return
      }

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }

      if (!data?.audit) {
        setAudit(null)
        setState('IDLE')
        return
      }

      hasLoadedOnce.current = true
      setAuditDbId(data.auditDbId ?? null)
      setProgress(typeof data.progress === 'number' ? data.progress : 0)

      if (data.status === 'FAILED') {
        setAudit(null)
        setError(data.errorMessage || 'L’audit a échoué.')
        setState('ERROR')
        return
      }

      setAudit(data.audit)
      setError(null)
      setState(IN_PROGRESS_STATUSES.includes(data.status) ? 'LOADING' : 'SUCCESS')
    } catch (err: any) {
      console.error('Erreur chargement audit API', err)
      setAudit(null)
      setError(err?.message || 'Erreur de chargement de l’audit')
      setState('ERROR')
    }
  }, [projectId])

  useEffect(() => {
    hasLoadedOnce.current = false
    fetchAuditData()
  }, [fetchAuditData])

  // Polling tant que le crawl/l'analyse est en cours
  useEffect(() => {
    if (state !== 'LOADING' || !hasLoadedOnce.current) return
    const timer = setInterval(fetchAuditData, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [state, fetchAuditData])

  const savePillars = async (
    pillarIds: string[],
    targetQueries: Record<string, string> = {},
  ): Promise<boolean> => {
    if (!auditDbId) {
      console.warn('auditDbId non disponible pour sauvegarder les piliers')
      return false
    }

    try {
      const res = await fetch(`/api/audits/${auditDbId}/pillars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillarPageIds: pillarIds, targetQueries }),
      })

      if (res.ok) {
        // Recharger immédiatement l'audit mis à jour
        await fetchAuditData()
        return true
      }
      return false
    } catch (err) {
      console.error('Erreur sauvegarde des piliers:', err)
      return false
    }
  }

  const getInspection = (pageId: string): InspectionData | null => {
    return audit?.inspections?.[pageId] ?? null
  }

  return (
    <AuditContext.Provider
      value={{
        projectId,
        state,
        audit,
        auditDbId,
        progress,
        loading: state === 'LOADING',
        error,
        refreshAudit: fetchAuditData,
        savePillars,
        getInspection,
      }}
    >
      {children}
    </AuditContext.Provider>
  )
}

export function useAudit() {
  const ctx = useContext(AuditContext)
  if (!ctx) {
    throw new Error('useAudit must be used within an AuditProvider')
  }
  return ctx
}
