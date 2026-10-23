'use client'

import { createContext, use, useEffect, useState } from 'react'
import {
  emptyScores,
  initialProjects,
  initialStats,
  projectNameFromDomain,
  type Project,
} from '@/lib/projects'

const CRAWL_TICK_MS = 1200

type ProjectsContextValue = {
  projects: Project[]
  stats: typeof initialStats
  launchAudit: (domain: string) => void
  relaunchAudit: (projectId: string) => void
  deleteProject: (projectId: string) => void
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

function randomScore() {
  return 40 + Math.floor(Math.random() * 55)
}

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [stats, setStats] = useState(initialStats)

  const hasRunningCrawl = projects.some((project) => project.status === 'crawling')

  // Simulation du crawl côté client, à remplacer par le polling de l'API d'audit.
  useEffect(() => {
    if (!hasRunningCrawl) return
    const timer = setInterval(() => {
      setProjects((current) =>
        current.map((project) => {
          if (project.status !== 'crawling') return project
          const progress = Math.min(100, project.progress + Math.ceil(Math.random() * 8))
          if (progress < 100) return { ...project, progress }
          return {
            ...project,
            progress,
            status: 'completed',
            scores: { tech: randomScore(), edito: randomScore(), geo: randomScore() },
          }
        }),
      )
    }, CRAWL_TICK_MS)
    return () => clearInterval(timer)
  }, [hasRunningCrawl])

  function startCrawl(base: Pick<Project, 'id' | 'name' | 'domain'>) {
    const audit: Project = {
      ...base,
      status: 'crawling',
      progress: 0,
      scores: emptyScores,
      lastAuditMinutesAgo: 0,
    }
    setProjects((current) => [audit, ...current.filter((project) => project.id !== base.id)])
  }

  function launchAudit(domain: string) {
    const existing = projects.find((project) => project.domain === domain)
    if (existing?.status === 'crawling') return

    startCrawl({
      id: existing?.id ?? domain.replace(/\./g, '-'),
      name: existing?.name ?? projectNameFromDomain(domain),
      domain,
    })
    setStats((current) => ({
      activeProjects: current.activeProjects + (existing ? 0 : 1),
      auditsThisMonth: current.auditsThisMonth + 1,
    }))
  }

  function relaunchAudit(projectId: string) {
    const project = projects.find((item) => item.id === projectId)
    if (!project || project.status === 'crawling') return
    startCrawl(project)
    setStats((current) => ({ ...current, auditsThisMonth: current.auditsThisMonth + 1 }))
  }

  function deleteProject(projectId: string) {
    setProjects((current) => current.filter((project) => project.id !== projectId))
    setStats((current) => ({ ...current, activeProjects: Math.max(0, current.activeProjects - 1) }))
  }

  return (
    <ProjectsContext value={{ projects, stats, launchAudit, relaunchAudit, deleteProject }}>
      {children}
    </ProjectsContext>
  )
}

export function useProjects() {
  const context = use(ProjectsContext)
  if (!context) throw new Error('useProjects doit être utilisé dans <ProjectsProvider>')
  return context
}
