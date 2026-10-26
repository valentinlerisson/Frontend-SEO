'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { ProjectAuditData, bigHappyAuditData, InspectionData, getInspectionDataForPage } from '@/lib/audit-data'

type AuditContextType = {
  projectId: string
  audit: ProjectAuditData
  auditDbId: string | null
  loading: boolean
  error: string | null
  refreshAudit: () => Promise<void>
  savePillars: (pillarIds: string[]) => Promise<boolean>
  getInspection: (pageId: string) => InspectionData
}

const AuditContext = createContext<AuditContextType | null>(null)

export function AuditProvider({
  projectId,
  children,
}: {
  projectId: string
  children: React.ReactNode
}) {
  const [audit, setAudit] = useState<ProjectAuditData>(bigHappyAuditData)
  const [auditDbId, setAuditDbId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAuditData = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/projects/${projectId}/audit`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.audit) {
        setAudit(data.audit)
        if (data.auditDbId) {
          setAuditDbId(data.auditDbId)
        }
      }
      setError(null)
    } catch (err: any) {
      console.warn('Erreur chargement audit API, maintien des données courantes', err)
      setError(err?.message || 'Erreur chargement')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchAuditData()
  }, [fetchAuditData])

  const savePillars = async (pillarIds: string[]): Promise<boolean> => {
    if (!auditDbId) {
      console.warn('auditDbId non disponible pour sauvegarder les piliers')
      return false
    }

    try {
      const res = await fetch(`/api/audits/${auditDbId}/pillars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillarPageIds: pillarIds }),
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

  const getInspection = (pageId: string): InspectionData => {
    if (audit.inspections && audit.inspections[pageId]) {
      return audit.inspections[pageId]
    }
    return getInspectionDataForPage(pageId)
  }

  return (
    <AuditContext.Provider
      value={{
        projectId,
        audit,
        auditDbId,
        loading,
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
    // Fallback gracieux si utilisé hors provider
    return {
      projectId: 'big-happy',
      audit: bigHappyAuditData,
      auditDbId: null,
      loading: false,
      error: null,
      refreshAudit: async () => {},
      savePillars: async () => false,
      getInspection: getInspectionDataForPage,
    }
  }
  return ctx
}
