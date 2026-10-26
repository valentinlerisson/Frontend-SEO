'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  emptyScores,
  initialProjects,
  initialStats,
  projectNameFromDomain,
  type Project,
  type AuditStatus,
} from '@/lib/projects'

type ProjectsContextValue = {
  projects: Project[]
  stats: typeof initialStats
  launchAudit: (domain: string) => void
  relaunchAudit: (projectId: string) => void
  deleteProject: (projectId: string) => void
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [stats, setStats] = useState(initialStats)

  // Récupérer les projets réels depuis l'API backend
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.projects) && data.projects.length > 0) {
        const mapped: Project[] = data.projects.map((p: any) => {
          const isCrawling = p.auditStatus === 'CRAWLING_TECH' || p.auditStatus === 'QUEUED'
          const status: AuditStatus = isCrawling ? 'crawling' : 'completed'
          return {
            id: p.id,
            name: p.name || projectNameFromDomain(p.domain),
            domain: p.domain,
            status,
            progress: p.progress ?? (isCrawling ? 45 : 100),
            scores: {
              tech: typeof p.techScore === 'number' ? Math.round(p.techScore) : null,
              edito: typeof p.editorialScore === 'number' ? Math.round(p.editorialScore) : null,
              geo: typeof p.geoScore === 'number' ? Math.round(p.geoScore) : null,
            },
            lastAuditMinutesAgo: 1,
          }
        })

        setProjects(mapped)
        setStats((prev) => ({
          ...prev,
          activeProjects: mapped.length,
        }))
      }
    } catch (err) {
      console.warn('Impossible de joindre /api/projects, maintien du cache local', err)
    }
  }, [])

  // Chargement initial
  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Polling si un crawl est en cours
  const hasRunningCrawl = projects.some((p) => p.status === 'crawling')

  useEffect(() => {
    if (!hasRunningCrawl) return
    const timer = setInterval(() => {
      fetchProjects()
    }, 2000)
    return () => clearInterval(timer)
  }, [hasRunningCrawl, fetchProjects])

  // Lancer un nouvel audit via l'API
  async function launchAudit(domainInput: string) {
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
        lastAuditMinutesAgo: 0,
      },
      ...curr.filter((p) => p.domain !== cleanDomain),
    ])

    try {
      const res = await fetch('/api/audits/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `https://${cleanDomain}` }),
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
          ? { ...p, status: 'crawling' as AuditStatus, progress: 10, scores: emptyScores }
          : p
      )
    )

    try {
      const res = await fetch('/api/audits/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `https://${project.domain}` }),
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
