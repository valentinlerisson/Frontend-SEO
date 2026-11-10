'use client'

import { useState } from 'react'
import { ImpactBadge } from './impact-badge'
import Link from 'next/link'
import { ChevronLeft, Search, FileText, ExternalLink, ListChecks, Plus } from 'lucide-react'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection } from '@/components/providers/inspection-provider'
import { getInspectionTarget } from '@/lib/issue-routing'
import { getIssueColumns } from './issue-metrics'
import { useAudit } from '@/components/providers/audit-provider'
import { AuditStateGate } from './audit-state-gate'
import { useFixPlan } from './use-fix-plan'
import { FIX_STATUS_LABEL } from '@/core/domain/fix-plan'

export function IndividualIssueView({
  projectId,
  issueId,
}: {
  projectId: string
  issueId: string
}) {
  const { openInspection } = useInspection()
  const { audit, state } = useAudit()
  const [searchQuery, setSearchQuery] = useState('')
  const fixPlan = useFixPlan(projectId)
  const [planNotice, setPlanNotice] = useState<string | null>(null)

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="Issues & Tips" />

  const issue = audit.globalIssues.find((i) => i.id === issueId)

  if (!issue) {
    return (
      <div className="flex flex-col gap-6">
        <AuditHeader domain={audit.domain} currentTitle="Issues & Tips" />
        <section className="glass-card rounded-2xl border p-10 text-center">
          <p className="text-sm text-muted-foreground">Anomalie introuvable pour cet audit.</p>
          <Link
            href={`/projets/${projectId}/global-issues`}
            className="mt-4 inline-flex items-center gap-1.5 text-base font-semibold text-primary-ink hover:opacity-80"
          >
            <ChevronLeft className="size-5" />
            Retour aux erreurs
          </Link>
        </section>
      </div>
    )
  }

  const target = getInspectionTarget(issue)
  const columns = getIssueColumns(issue)
  const impactedUrls = issue.impactedUrls || []
  // Pages de l'anomalie pas encore dans le plan d'action (une tâche par page)
  const missingFromPlan = impactedUrls.filter((item) => !fixPlan.statusOf(issue.code, item.fullUrl))
  const addToPlan = async (urls: string[]) => {
    const added = await fixPlan.add(urls.map((url) => ({ code: issue.code, url })))
    setPlanNotice(added > 0 ? `${added} tâche${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} au plan d’action.` : null)
  }
  const filteredUrls = impactedUrls.filter(
    (item) =>
      item.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.fullUrl.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle={`Issues & Tips / ${issue.title.split('(')[0].trim()}`} />

      {/* Main Container */}
      <section className="glass-card rounded-2xl border p-5 md:p-6">
        {/* Top bar with Back button, Title, Search, Export */}
        <div className="flex flex-col gap-4 border-b border-shade-33 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <Link
              href={`/projets/${projectId}/global-issues`}
              className="inline-flex items-center gap-1.5 text-base font-semibold text-primary-ink transition-opacity hover:opacity-80"
            >
              <ChevronLeft className="size-5" />
              Retour aux erreurs
            </Link>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-foreground tracking-tight sm:text-2xl">
                  {issue.title}
                </h1>
                <ImpactBadge impact={issue.impact} />
              </div>
              <p className="text-xs text-muted-foreground">
                {issue.impactSummary || `${issue.impactCount ?? impactedUrls.length} URL impactées`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative min-w-[240px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher une URL..."
                className="w-full rounded-xl border border-shade-44 bg-shade-16 py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <button
              type="button"
              disabled={fixPlan.loading || missingFromPlan.length === 0}
              onClick={() => addToPlan(missingFromPlan.map((item) => item.fullUrl))}
              className="inline-flex items-center gap-2 rounded-xl border border-shade-44 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListChecks className="size-4" aria-hidden="true" />
              {missingFromPlan.length === 0
                ? 'Toutes les pages sont dans le plan'
                : `Ajouter ${missingFromPlan.length === 1 ? 'la page' : `les ${missingFromPlan.length} pages`} au plan`}
            </button>
            <ExportPdfButton />
          </div>
        </div>
        {planNotice && (
          <p role="status" className="mt-3 text-sm text-green-soft">
            {planNotice}{' '}
            <Link href={`/projets/${projectId}/plan`} className="font-semibold text-primary-ink hover:underline">
              Ouvrir le plan
            </Link>
          </p>
        )}

        {/* Issue Explanation Box */}
        <div className="mt-6 rounded-xl border border-shade-3e bg-shade-1c p-5">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-lg font-bold text-foreground">{issue.title}</h2>
            <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
              {issue.impactCount} pages impactées
            </span>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed max-w-4xl">
            {issue.description}
          </p>
          {issue.recommendation && (
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-4xl">
              {issue.recommendation}
            </p>
          )}
        </div>

        {/* Impacted URLs Table */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-base text-foreground">
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal rounded-l-xl">
                  URL
                </th>
                {columns.map((col) => (
                  <th key={col.header} scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                    {col.header}
                  </th>
                ))}
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                  Plan d’action
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal rounded-r-xl">
                  Page Details
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUrls.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 3} className="py-10 text-center text-sm text-muted-foreground">
                    Aucune URL trouvée pour cette recherche.
                  </td>
                </tr>
              ) : (
                filteredUrls.map((item, index) => {
                  const isLast = index === filteredUrls.length - 1
                  const cellClass = `px-6 py-5 align-middle ${isLast ? '' : 'border-b border-shade-33'}`

                  return (
                    <tr key={item.id} className="hover:bg-shade-28/50 transition-colors">
                      <th scope="row" className={`${cellClass} font-normal`}>
                        <button
                          type="button"
                          onClick={() => openInspection(item.id, target.tab, target.section)}
                          className="block text-left text-base font-semibold text-foreground hover:text-primary-ink transition-colors cursor-pointer"
                        >
                          {item.path}
                        </button>
                      </th>
                      {columns.map((col) => (
                        <td key={col.header} className={cellClass}>
                          {col.render(item)}
                        </td>
                      ))}
                      <td className={cellClass}>
                        {(() => {
                          const status = fixPlan.statusOf(issue.code, item.fullUrl)
                          return status ? (
                            <Link href={`/projets/${projectId}/plan`} className="text-sm text-foreground hover:underline">
                              {FIX_STATUS_LABEL[status]}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              disabled={fixPlan.loading}
                              onClick={() => addToPlan([item.fullUrl])}
                              className="inline-flex items-center gap-1 rounded-lg border border-shade-44 px-2.5 py-1 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-50"
                            >
                              <Plus className="size-3.5" aria-hidden="true" /> Ajouter
                            </button>
                          )
                        })()}
                      </td>
                      <td className={cellClass}>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openInspection(item.id, target.tab, target.section)}
                            title="Ouvrir l'inspection de la page"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-shade-38 hover:text-foreground transition-colors"
                          >
                            <FileText className="size-5" />
                          </button>
                          <a
                            href={item.fullUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Visiter la page"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-shade-38 hover:text-primary-ink transition-colors"
                          >
                            <ExternalLink className="size-5" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Inspection Sheet */}
      <PageInspectionSheet />
    </div>
  )
}
