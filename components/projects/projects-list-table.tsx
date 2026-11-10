import Link from 'next/link'
import { ArrowUpRight, RotateCw, Trash2 } from 'lucide-react'
import { formatRelativeTime, globalScore, isRunning, type Project } from '@/lib/projects'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { ScoreValue } from './score-value'
import { GEO_ENABLED } from '@/core/domain/features'

type ProjectsListTableProps = {
  projects: Project[]
  /** Colonnes des trois notes, et actions Relancer / Supprimer (page Projets) ; sans : liste courte de l'accueil */
  detailed?: boolean
  onRelaunch?: (projectId: string) => void
  onDelete?: (project: Project) => void
  emptyText?: string
}

const iconButton =
  'inline-flex size-9 items-center justify-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2'

/** Tableau des projets, même présentation que les tableaux des onglets d'audit */
export function ProjectsListTable({
  projects,
  detailed = false,
  onRelaunch,
  onDelete,
  emptyText = 'Aucun projet pour le moment. Lancez votre premier audit ci-dessus.',
}: ProjectsListTableProps) {
  const columns = [
    'Projet',
    'Statut',
    'Note globale',
    ...(detailed ? ['Technique', 'Contenu', ...(GEO_ENABLED ? ['Moteurs IA'] : [])] : []),
    'Dernier audit',
    'Actions',
  ]

  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-separate border-spacing-0 text-left ${detailed ? 'min-w-[900px]' : 'min-w-[640px]'}`}>
        <thead>
          <tr className="text-sm text-foreground">
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={[
                  'bg-shade-38 px-4 py-3 font-normal',
                  index === 0 ? 'rounded-l-xl' : '',
                  index === columns.length - 1 ? 'rounded-r-xl' : '',
                ].join(' ')}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {projects.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          ) : (
            projects.map((project) => {
              const running = isRunning(project.status)
              const cell = 'border-b border-shade-3e px-4 py-3.5 align-middle'
              return (
                <tr key={project.id} className="hover:bg-shade-33/40">
                  <th scope="row" className={`${cell} font-normal`}>
                    <span className="block font-semibold text-foreground">{project.name}</span>
                    <span className="block text-sm text-muted-foreground">{project.domain}</span>
                  </th>
                  <td className={cell}>
                    <StatusBadge status={project.status} progress={project.progress} />
                  </td>
                  <td className={cell}>
                    <ScoreValue
                      score={globalScore(project)}
                      pendingLabel={running ? 'Calcul en cours' : project.status === 'awaiting' ? 'Après l’analyse' : '—'}
                    />
                  </td>
                  {detailed && (
                    <>
                      <td className={cell}>
                        <ScoreValue score={project.scores.tech} compact pendingLabel={running ? 'Calcul…' : '—'} />
                      </td>
                      <td className={cell}>
                        <ScoreValue score={project.scores.edito} compact pendingLabel="—" />
                      </td>
                      {GEO_ENABLED && (
                        <td className={cell}>
                          <ScoreValue score={project.scores.geo} compact pendingLabel="—" />
                        </td>
                      )}
                    </>
                  )}
                  <td className={`${cell} whitespace-nowrap text-sm text-muted-foreground`}>
                    {formatRelativeTime(project.lastAuditMinutesAgo)}
                  </td>
                  <td className={cell}>
                    <div className="flex items-center gap-2">
                      {running ? (
                        <span className="text-xs text-muted-foreground">Audit en cours…</span>
                      ) : (
                        <Link
                          href={`/projets/${project.id}/synthese`}
                          aria-label={`Ouvrir l’audit de ${project.name}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-[#e0d100] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          Ouvrir
                          <ArrowUpRight className="size-4" aria-hidden="true" />
                        </Link>
                      )}
                      {detailed && onRelaunch && !running && (
                        <button
                          type="button"
                          onClick={() => onRelaunch(project.id)}
                          aria-label={`Relancer l’audit de ${project.name}`}
                          className={`${iconButton} border-shade-44 text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-primary`}
                        >
                          <RotateCw className="size-4" aria-hidden="true" />
                        </button>
                      )}
                      {detailed && onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(project)}
                          aria-label={`Supprimer le projet ${project.name}`}
                          className={`${iconButton} border-[#ef4444]/40 text-red-soft hover:bg-[#ef4444]/10 focus-visible:outline-destructive`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
