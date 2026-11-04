'use client'

import Link from 'next/link'
import { ArrowUpRight, Folder, Gauge, ListChecks } from 'lucide-react'
import { currentUser, globalScore, isRunning } from '@/lib/projects'
import { useProjects } from '@/components/providers/projects-provider'
import { ProjectsListTable } from '@/components/projects/projects-list-table'
import { AuditLauncher } from './audit-launcher'
import { StatCard } from './stat-card'

const RECENT_AUDITS_LIMIT = 5
/** Note globale sous laquelle un projet est à renforcer */
const IMPROVE_BELOW = 60

export function DashboardView() {
  const { projects, launchAudit } = useProjects()
  const recentProjects = projects.slice(0, RECENT_AUDITS_LIMIT)
  const running = projects.filter((project) => isRunning(project.status)).length
  const awaiting = projects.filter((project) => project.status === 'awaiting').length
  const scored = projects.map(globalScore).filter((score): score is number => score !== null)
  const toImprove = scored.filter((score) => score < IMPROVE_BELOW).length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Bonjour, {currentUser.firstName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lancez un nouvel audit ou reprenez une analyse en cours.
        </p>
      </div>

      <AuditLauncher onLaunch={launchAudit} />

      <section aria-label="Vos projets en chiffres" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Projets suivis"
          value={projects.length}
          hint={running > 0 ? `${running} audit(s) en cours` : 'aucun audit en cours'}
          icon={Folder}
        />
        <StatCard
          label="Pages à choisir"
          value={awaiting}
          hint={awaiting > 0 ? 'audits qui attendent vos pages stratégiques' : 'aucun audit en attente'}
          icon={ListChecks}
        />
        <StatCard
          label="Projets à renforcer"
          value={scored.length > 0 ? toImprove : '—'}
          hint={
            scored.length > 0
              ? `note globale sous ${IMPROVE_BELOW}/100, sur ${scored.length} audit(s) terminé(s)`
              : 'disponible après une analyse complète'
          }
          icon={Gauge}
        />
      </section>

      <section aria-labelledby="recent-title" className="glass-card rounded-2xl border p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="recent-title" className="text-base font-bold text-foreground">
            Derniers audits
          </h2>
          <Link
            href="/projets"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline"
          >
            Voir tous les projets
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <ProjectsListTable projects={recentProjects} />
      </section>
    </div>
  )
}
