import Link from 'next/link'
import { File, RotateCw, Trash2 } from 'lucide-react'
import { formatRelativeTime, type Project } from '@/lib/projects'
import { StatusBadge } from '@/components/dashboard/status-badge'

type ProjectsListTableProps = {
  projects: Project[]
  onRelaunch: (projectId: string) => void
  onDelete: (project: Project) => void
}

const columns = ['Projets/ Domaines', 'Statut', 'Tech', 'Edito', 'GEO', 'Dernier Audit', 'Actions']

export function ProjectsListTable({ projects, onRelaunch, onDelete }: ProjectsListTableProps) {
  return (
    <section aria-labelledby="projects-list-title" className="glass-card border rounded-2xl p-3 md:p-5">
      <h2 id="projects-list-title" className="sr-only">
        Liste des projets
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-xl leading-tight text-foreground">
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={[
                    'bg-table-header px-5 py-5 font-normal',
                    index === 0 ? 'w-[18%] rounded-l-xl pl-8' : '',
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
                <td colSpan={columns.length} className="px-8 py-12 text-center text-lg text-muted-foreground">
                  Aucun projet pour le moment. Lancez votre premier audit ci-dessus.
                </td>
              </tr>
            ) : (
              projects.map((project, index) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  isLast={index === projects.length - 1}
                  onRelaunch={onRelaunch}
                  onDelete={onDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ScoreCell({ value, pending, className }: { value: number | null; pending?: boolean; className: string }) {
  return (
    <td className={`${className} text-lg tabular-nums`}>
      {pending ? 'Calcul...' : value === null ? <span aria-label="Non disponible">--</span> : `${value}%`}
    </td>
  )
}

function ProjectRow({
  project,
  isLast,
  onRelaunch,
  onDelete,
}: {
  project: Project
  isLast: boolean
  onRelaunch: (projectId: string) => void
  onDelete: (project: Project) => void
}) {
  const isCrawling = project.status === 'crawling'
  const cell = `px-5 py-6 align-middle ${isLast ? '' : 'border-b border-muted-foreground/50'}`

  return (
    <tr>
      <th scope="row" className={`${cell} pl-8 font-normal`}>
        <span className="block text-xl font-semibold">{project.name}</span>
        <span className="block text-xl text-muted-foreground">/{project.domain}</span>
      </th>
      <td className={cell}>
        <StatusBadge status={project.status} progress={project.progress} />
      </td>
      <ScoreCell value={project.scores.tech} pending={isCrawling} className={cell} />
      <ScoreCell value={project.scores.edito} className={cell} />
      <ScoreCell value={project.scores.geo} className={cell} />
      <td className={`${cell} text-lg whitespace-nowrap`}>{formatRelativeTime(project.lastAuditMinutesAgo)}</td>
      <td className={cell}>
        {isCrawling ? (
          <span className="text-xl whitespace-nowrap text-muted-foreground">En cours ...</span>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href={`/projets/${project.id}/synthese`}
              aria-label={`Accéder à l’audit de ${project.name}`}
              className="inline-flex h-12 items-center gap-3 rounded-xl bg-primary px-5 text-lg font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <File className="size-5" strokeWidth={1.75} aria-hidden="true" />
              Accéder
            </Link>
            <button
              type="button"
              onClick={() => onRelaunch(project.id)}
              aria-label={`Relancer l’audit de ${project.name}`}
              title="Relancer l’audit"
              className="inline-flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <RotateCw className="size-6" strokeWidth={2.5} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(project)}
              aria-label={`Supprimer le projet ${project.name}`}
              title="Supprimer le projet"
              className="inline-flex size-12 items-center justify-center rounded-xl bg-destructive text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
            >
              <Trash2 className="size-6" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
