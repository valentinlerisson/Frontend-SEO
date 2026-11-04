'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { CrawlScope } from '@/core/domain/types'
import { useSettings } from './settings-provider'

/** Périmètre choisi au lancement ; le plafond de pages vient des paramètres */
export type CrawlScopeChoice = Pick<CrawlScope, 'mode' | 'sitemaps'>
import {
  emptyScores,
  initialStats,
  projectNameFromDomain,
  type Project,
  type AuditStatus,
  isRunning,
} from '@/lib/projects'

type ProjectsContextValue = {
  projects: Project[]
  /** false tant que la première réponse de GET /api/projects n'est pas arrivée */
  loaded: boolean
  stats: typeof initialStats
  launchAudit: (domain: string, scope?: CrawlScopeChoice) => void
  relaunchAudit: (projectId: string) => void
  deleteProject: (projectId: string) => void
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const { maxCrawlPages } = useSettings()
  const [loaded, setLoaded] = useState(false)
  const [stats, setStats] = useState(initialStats)

  // Récupérer les projets réels depuis l'API backend
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.projects)) {
        const mapped: Project[] = data.projects.map((p: any) => {
          const status: AuditStatus =
            p.auditStatus === 'QUEUED' || p.auditStatus === 'CRAWLING_TECH'
              ? 'crawling'
              : p.auditStatus === 'ANALYZING_AI'
                ? 'analyzing'
                : p.auditStatus === 'AWAITING_AI_SELECTION'
                  ? 'awaiting'
                  : p.auditStatus === 'FAILED'
                    ? 'failed'
                    : 'completed'
          const lastAuditAt = p.lastAuditAt ? new Date(p.lastAuditAt).getTime() : null
          return {
            id: p.id,
            name: p.name || projectNameFromDomain(p.domain),
            domain: p.domain,
            status,
            progress: p.progress ?? 0,
            scores: {
              tech: typeof p.techScore === 'number' ? Math.round(p.techScore) : null,
              edito: typeof p.editorialScore === 'number' ? Math.round(p.editorialScore) : null,
              geo: typeof p.geoScore === 'number' ? Math.round(p.geoScore) : null,
            },
            overall: typeof p.overallScore === 'number' ? Math.round(p.overallScore) : null,
            lastAuditMinutesAgo:
              lastAuditAt === null ? 0 : Math.max(0, Math.floor((Date.now() - lastAuditAt) / 60000)),
          }
        })

        setProjects(mapped)
        setStats((prev) => ({ ...prev, activeProjects: mapped.length }))
      }
    } catch (err) {
      console.warn('Impossible de joindre /api/projects', err)
    } finally {
      setLoaded(true)
    }
  }, [])

  // Chargement initial
  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Polling si un crawl est en cours
  const hasRunningCrawl = projects.some((p) => isRunning(p.status))

  useEffect(() => {
    if (!hasRunningCrawl) return
    const timer = setInterval(() => {
      fetchProjects()
    }, 2000)
    return () => clearInterval(timer)
  }, [hasRunningCrawl, fetchProjects])

  // Lancer un nouvel audit via l'API
  async function launchAudit(domainInput: string, scope?: CrawlScopeChoice) {
    const cleanDomain = domainInput.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

    // Mise à jour optimiste de l'UI
    setProjects((curr) => [
      {
        id: cleanDomain.replace(/\./g, '-'),
        name: projectNameFromDomain(cleanDomain),
        domain: cleanDomain,
        status: 'crawling',
        progress: 10,
        scores: emptyScores,
        overall: null,
        lastAuditMinutesAgo: 0,
      },
      ...curr.filter((p) => p.domain !== cleanDomain),
    ])

    try {
      const res = await fetch('/api/audits/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `https://${cleanDomain}`, scope, maxPages: maxCrawlPages }),
      })

      if (res.ok) {
        await fetchProjects()
      }
    } catch (err) {
      console.error('Erreur lancement audit backend:', err)
    }
  }

  // Relancer un audit
  async function relaunchAudit(projectId: string) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return

    setProjects((curr) =>
      curr.map((p) =>
        p.id === projectId
          ? { ...p, status: 'crawling' as AuditStatus, progress: 10, scores: emptyScores, overall: null }
          : p
      )
    )

    try {
      const res = await fetch('/api/audits/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Relance : le périmètre gardé pour le projet est repris par le serveur, avec le plafond actuel des paramètres
        body: JSON.stringify({ url: `https://${project.domain}`, maxPages: maxCrawlPages }),
      })

      if (res.ok) {
        await fetchProjects()
      }
    } catch (err) {
      console.error('Erreur relance audit:', err)
    }
  }

  // Supprimer un projet
  async function deleteProject(projectId: string) {
    setProjects((curr) => curr.filter((p) => p.id !== projectId))
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      })
      await fetchProjects()
    } catch (err) {
      console.error('Erreur suppression projet backend:', err)
    }
  }

  return (
    <ProjectsContext.Provider
      value={{
        projects,
        loaded,
        stats,
        launchAudit,
        relaunchAudit,
        deleteProject,
      }}
    >
      {children}
    </ProjectsContext.Provider>
  )
}

export function useProjects() {
  const context = useContext(ProjectsContext)
  if (!context) {
    throw new Error('useProjects doit être utilisé au sein d’un ProjectsProvider')
  }
  return context
}
