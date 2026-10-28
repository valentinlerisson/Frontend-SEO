import Link from 'next/link'
import { File } from 'lucide-react'
import { formatRelativeTime, globalScore, type Project } from '@/lib/projects'
import { StatusBadge } from './status-badge'

type ProjectsTableProps = {
  projects: Project[]
}

const columns = ['Projets/Domaines', 'Statut', 'Score Global', 'Dernier Audit', 'Actions']

export function ProjectsTable({ projects }: ProjectsTableProps) {
  return (
    <section aria-labelledby="recent-audits-title" className="glass-card rounded-2xl border p-3 md:p-4">
      <h2 id="recent-audits-title" className="sr-only">
        Derniers audits
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-xl text-foreground">
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={[
                    'bg-table-header px-6 py-6 font-normal md:px-8',
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
            {projects.map((project, index) => (
              <ProjectRow key={project.id} project={project} isLast={index === projects.length - 1} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ProjectRow({ project, isLast }: { project: Project; isLast: boolean }) {
  const isCrawling = project.status === 'crawling'
  const cell = `px-6 py-6 align-middle md:px-8 ${isLast ? '' : 'border-b border-muted-foreground/50'}`

  return (
    <tr>
      <th scope="row" className={`${cell} font-normal`}>
        <span className="block text-xl font-semibold">{project.name}</span>
        <span className="block text-xl text-muted-foreground">/{project.domain}</span>
      </th>
      <td className={cell}>
        <StatusBadge status={project.status} progress={project.progress} />
      </td>
      <td className={`${cell} text-lg tabular-nums`}>
        {isCrawling ? 'Calcul...' : `${globalScore(project.scores) ?? '--'}%`}
      </td>
      <td className={`${cell} text-lg`}>{formatRelativeTime(project.lastAuditMinutesAgo)}</td>
      <td className={cell}>
        {isCrawling ? (
          <span className="text-xl text-muted-foreground">En cours ...</span>
        ) : (
          <Link
            href={`/projets/${project.id}/synthese`}
            aria-label={`Accéder à l’audit de ${project.name}`}
            className="inline-flex items-center gap-4 rounded-xl bg-primary px-6 py-3 text-xl font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <File className="size-6" strokeWidth={1.75} aria-hidden="true" />
            Accéder
          </Link>
        )}
      </td>
    </tr>
  )
}
