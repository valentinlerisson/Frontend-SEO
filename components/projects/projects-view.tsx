'use client'

import { useState } from 'react'
import { type Project } from '@/lib/projects'
import { useProjects, type CrawlScopeChoice } from '@/components/providers/projects-provider'
import { AuditLauncher } from '@/components/dashboard/audit-launcher'
import { DeleteProjectDialog } from './delete-project-dialog'
import { PaginationNav } from './pagination-nav'
import { ProjectsListTable } from './projects-list-table'

const PAGE_SIZE = 10

export function ProjectsView() {
  const { projects, launchAudit, relaunchAudit, deleteProject } = useProjects()
  const [requestedPage, setRequestedPage] = useState(1)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)

  const pageCount = Math.max(1, Math.ceil(projects.length / PAGE_SIZE))
  const page = Math.min(requestedPage, pageCount)
  const visibleProjects = projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleLaunch(domain: string, scope?: CrawlScopeChoice) {
    launchAudit(domain, scope)
    setRequestedPage(1)
  }

  function handleRelaunch(projectId: string) {
    relaunchAudit(projectId)
    setRequestedPage(1)
  }

  function handleConfirmDelete(projectId: string) {
    deleteProject(projectId)
    setProjectToDelete(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Projets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {projects.length} projet{projects.length > 1 ? 's' : ''} · ouvrez, relancez ou supprimez un audit.
        </p>
      </div>

      <AuditLauncher onLaunch={handleLaunch} />

      <section aria-labelledby="projects-title" className="glass-card rounded-2xl border p-4 md:p-6">
        <h2 id="projects-title" className="mb-4 text-base font-bold text-foreground">
          Tous les projets
        </h2>
        <ProjectsListTable
          projects={visibleProjects}
          detailed
          onRelaunch={handleRelaunch}
          onDelete={setProjectToDelete}
        />
        <div className="mt-4">
          <PaginationNav page={page} pageCount={pageCount} onPageChange={setRequestedPage} />
        </div>
      </section>

      <DeleteProjectDialog
        project={projectToDelete}
        onOpenChange={(open) => !open && setProjectToDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
