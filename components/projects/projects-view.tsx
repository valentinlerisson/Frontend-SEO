'use client'

import { useState } from 'react'
import { currentUser, type Project } from '@/lib/projects'
import { useProjects } from '@/components/providers/projects-provider'
import { AuditUrlForm } from '@/components/dashboard/audit-url-form'
import { DeleteProjectDialog } from './delete-project-dialog'
import { PaginationNav } from './pagination-nav'
import { ProjectsListTable } from './projects-list-table'

const PAGE_SIZE = 5

export function ProjectsView() {
  const { projects, launchAudit, relaunchAudit, deleteProject } = useProjects()
  const [requestedPage, setRequestedPage] = useState(1)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)

  const pageCount = Math.max(1, Math.ceil(projects.length / PAGE_SIZE))
  const page = Math.min(requestedPage, pageCount)
  const visibleProjects = projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleLaunch(domain: string) {
    launchAudit(domain)
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
    <>
      <header className="flex flex-col gap-6 px-2 pt-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-medium text-balance md:text-5xl">Bonjour, {currentUser.firstName}</h1>
          <p className="mt-3 text-base text-muted-foreground md:text-xl">
            Gérez et suivez l&apos;état de vos audits SEO &amp; GEO
          </p>
        </div>
        <AuditUrlForm onLaunch={handleLaunch} className="xl:w-auto xl:shrink-0 [&>div]:xl:w-80" />
      </header>

      <ProjectsListTable projects={visibleProjects} onRelaunch={handleRelaunch} onDelete={setProjectToDelete} />

      <div className="mt-auto pb-2">
        <PaginationNav page={page} pageCount={pageCount} onPageChange={setRequestedPage} />
      </div>

      <DeleteProjectDialog
        project={projectToDelete}
        onOpenChange={(open) => !open && setProjectToDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </>
  )
}
