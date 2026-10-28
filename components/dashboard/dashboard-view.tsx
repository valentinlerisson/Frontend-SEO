'use client'

import Link from 'next/link'
import { ChevronRight, Folder } from 'lucide-react'
import { currentUser } from '@/lib/projects'
import { useProjects } from '@/components/providers/projects-provider'
import { AuditLauncher } from './audit-launcher'
import { ProjectsTable } from './projects-table'
import { StatCard } from './stat-card'

const RECENT_AUDITS_LIMIT = 3

export function DashboardView() {
  const { projects, stats, launchAudit } = useProjects()
  const recentProjects = projects.slice(0, RECENT_AUDITS_LIMIT)

  return (
    <>
      <AuditLauncher firstName={currentUser.firstName} onLaunch={launchAudit} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:max-w-4xl lg:pl-4">
          <StatCard label="Projets Actifs" value={stats.activeProjects} icon={Folder} />
        </div>

        <Link
          href="/projets"
          className="inline-flex items-center gap-3 self-start rounded-xl border border-primary px-6 py-3 text-lg text-primary-ink transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:self-end"
        >
          Voir tout les projets
          <ChevronRight className="size-5" aria-hidden="true" />
        </Link>
      </div>

      <ProjectsTable projects={recentProjects} />
    </>
  )
}
