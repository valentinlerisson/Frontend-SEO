'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowUpRight, ChevronDown, Search, X } from 'lucide-react'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { ImpactBadge } from './impact-badge'
import { AuditStateGate } from './audit-state-gate'
import { getIssueColumns } from './issue-metrics'
import { useAudit } from '@/components/providers/audit-provider'
import { useInspection } from '@/components/providers/inspection-provider'
import { getInspectionTarget } from '@/lib/issue-routing'
import type { GlobalIssue, ImpactLevel, IssuePillar } from '@/lib/audit-data'

type SeverityFilter = 'all' | GlobalIssue['severity']
type PillarFilter = 'all' | IssuePillar

const IMPACT_ORDER: ImpactLevel[] = ['high', 'medium', 'low', 'geo']

const IMPACT_SECTION: Record<ImpactLevel, { title: string; hint: string; accent: string }> = {
  high: {
    title: 'À corriger en priorité',
    hint: 'Bloquent l’indexation ou pèsent le plus sur le classement',
    accent: '#ef4444',
  },
  medium: {
    title: 'À planifier',
    hint: 'Améliorent la pertinence, le maillage et la crédibilité',
    accent: '#eab308',
  },
  low: {
    title: 'Améliorations mineures',
    hint: 'Effet limité ou non démontré sur le classement',
    accent: '#94a3b8',
  },
  geo: {
    title: 'Visibilité dans les moteurs IA',
    hint: 'Concerne les réponses générées, pas le classement Google',
    accent: '#818cf8',
  },
}

const PILLAR_LABEL: Record<IssuePillar, string> = { TECH: 'Technique', EDITORIAL: 'Éditorial', GEO: 'GEO' }

const SEVERITY_STYLE: Record<GlobalIssue['severity'], { label: string; bar: string; text: string }> = {
  critical: { label: 'Critique', bar: 'bg-[#ef4444]', text: 'text-red-soft' },
  warning: { label: 'Avertissement', bar: 'bg-[#eab308]', text: 'text-amber-soft' },
  passed: { label: 'Info', bar: 'bg-[#38bdf8]', text: 'text-sky-soft' },
}

function initialSeverity(param: string | null): SeverityFilter {
  return param === 'critical' || param === 'warning' || param === 'passed' ? param : 'all'
}

export function GlobalIssuesView({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams()
  const { audit, state } = useAudit()
  const { openInspection } = useInspection()

  const [severity, setSeverity] = useState<SeverityFilter>(initialSeverity(searchParams.get('filter')))
  const [pillar, setPillar] = useState<PillarFilter>('all')
  const [impact, setImpact] = useState<ImpactLevel | 'all'>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Partial<Record<ImpactLevel, boolean>>>({ low: true, geo: true })

  const issues = audit?.globalIssues ?? []

  // Filtres de gravité, de pilier et de recherche : base commune aux compteurs et aux sections
  const base = useMemo(() => {
    const q = query.trim().toLowerCase()
    return issues.filter((issue) => {
      if (severity !== 'all' && issue.severity !== severity) return false
      if (pillar !== 'all' && issue.pillar !== pillar) return false
      if (q && !`${issue.title} ${issue.code} ${issue.description ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [issues, severity, pillar, query])

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="Issues & Tips" />

  const countBy = <T extends string>(items: GlobalIssue[], pick: (issue: GlobalIssue) => T) => {
    const counts = new Map<T, number>()
    for (const issue of items) counts.set(pick(issue), (counts.get(pick(issue)) ?? 0) + 1)
    return counts
  }
  const impactCounts = countBy(base, (issue) => issue.impact)
  const pageCounts = new Map<ImpactLevel, number>()
  for (const issue of base) pageCounts.set(issue.impact, (pageCounts.get(issue.impact) ?? 0) + (issue.impactCount ?? 0))

  // Les compteurs de pilier et de gravité ignorent leur propre filtre pour rester lisibles
  const pillarCounts = countBy(
    issues.filter((i) => (severity === 'all' || i.severity === severity)),
    (issue) => issue.pillar,
  )
  const severityCounts = countBy(
    issues.filter((i) => pillar === 'all' || i.pillar === pillar),
    (issue) => issue.severity,
  )

  const visible = base.filter((issue) => impact === 'all' || issue.impact === impact)
  const filtersActive = severity !== 'all' || pillar !== 'all' || impact !== 'all' || query.trim() !== ''
  const reset = () => {
    setSeverity('all')
    setPillar('all')
    setImpact('all')
    setQuery('')
  }

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Issues & Tips" />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Anomalies & recommandations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {issues.length} anomalie{issues.length > 1 ? 's' : ''}, classées par effet sur le classement. Commencez par
            le haut de la liste.
          </p>
        </div>
        <ExportPdfButton />
      </div>

      {/* Répartition par impact : un clic filtre la liste */}
      <section aria-label="Répartition par impact" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {IMPACT_ORDER.map((level) => {
          const config = IMPACT_SECTION[level]
          const active = impact === level
          return (
            <button
              key={level}
              type="button"
              onClick={() => setImpact(active ? 'all' : level)}
              aria-pressed={active}
              className={`relative overflow-hidden rounded-2xl border p-4 text-left transition-colors ${
                active ? 'border-foreground/40 bg-shade-33' : 'border-shade-3e bg-shade-2b hover:border-foreground/20'
              }`}
            >
              <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: config.accent }} aria-hidden="true" />
              <span className="block pl-2 text-3xl font-extrabold tracking-tight text-foreground">
                {impactCounts.get(level) ?? 0}
              </span>
              <span className="mt-0.5 block pl-2 text-sm font-semibold text-foreground">{config.title}</span>
              <span className="block pl-2 text-xs text-muted-foreground">
                {pageCounts.get(level) ?? 0} page{(pageCounts.get(level) ?? 0) > 1 ? 's' : ''} concernée
                {(pageCounts.get(level) ?? 0) > 1 ? 's' : ''}
              </span>
            </button>
          )
        })}
      </section>

      {/* Filtres */}
      <section className="glass-card rounded-2xl border p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-shade-38 bg-shade-14 p-1">
              {(
                [
                  { key: 'all', label: 'Tous', count: issues.filter((i) => severity === 'all' || i.severity === severity).length },
                  { key: 'TECH', label: 'Technique', count: pillarCounts.get('TECH') ?? 0 },
                  { key: 'EDITORIAL', label: 'Éditorial', count: pillarCounts.get('EDITORIAL') ?? 0 },
                  { key: 'GEO', label: 'GEO', count: pillarCounts.get('GEO') ?? 0 },
                ] as { key: PillarFilter; label: string; count: number }[]
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setPillar(tab.key)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                    pillar === tab.key ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label} <span className="font-normal opacity-70">{tab.count}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              {(
                [
                  { key: 'all', label: 'Toutes gravités' },
                  { key: 'critical', label: 'Critique' },
                  { key: 'warning', label: 'Avertissement' },
                  { key: 'passed', label: 'Info' },
                ] as { key: SeverityFilter; label: string }[]
              ).map((chip) => {
                const active = severity === chip.key
                const count = chip.key === 'all' ? null : (severityCounts.get(chip.key) ?? 0)
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setSeverity(chip.key)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-foreground/50 bg-foreground/10 text-foreground'
                        : 'border-shade-44 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {chip.label}
                    {count !== null && <span className="ml-1 font-normal opacity-70">{count}</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="relative min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une anomalie…"
              aria-label="Rechercher une anomalie"
              className="w-full rounded-xl border border-shade-44 bg-shade-16 py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {filtersActive && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-shade-2a px-4 py-2 text-xs text-muted-foreground">
            <span>
              {visible.length} anomalie{visible.length > 1 ? 's' : ''} affichée{visible.length > 1 ? 's' : ''} sur {issues.length}
            </span>
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 font-medium text-primary-ink hover:underline">
              <X className="size-3.5" aria-hidden="true" />
              Réinitialiser les filtres
            </button>
          </div>
        )}
      </section>

      {/* Anomalies regroupées par impact */}
      {visible.length === 0 && (
        <p className="rounded-2xl border border-dashed border-shade-44 py-12 text-center text-sm text-muted-foreground">
          {issues.length === 0 ? 'Aucune anomalie détectée.' : 'Aucune anomalie ne correspond à ces filtres.'}
        </p>
      )}

      {IMPACT_ORDER.map((level) => {
        const group = visible.filter((issue) => issue.impact === level)
        if (group.length === 0) return null
        const config = IMPACT_SECTION[level]
        const isCollapsed = impact === 'all' && collapsed[level]

        return (
          <section key={level} aria-label={config.title} className="glass-card rounded-2xl border p-4 md:p-5">
            <button
              type="button"
              onClick={() => setCollapsed((prev) => ({ ...prev, [level]: !prev[level] }))}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="h-8 w-1.5 rounded-full" style={{ backgroundColor: config.accent }} aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    {config.title} <span className="font-normal text-muted-foreground">({group.length})</span>
                  </h2>
                  <p className="text-xs text-muted-foreground">{config.hint}</p>
                </div>
              </div>
              <ChevronDown className={`size-5 text-muted-foreground transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
            </button>

            {!isCollapsed && (
              <ul className="mt-4 flex flex-col gap-2.5">
                {group.map((issue) => {
                  const isExpanded = expanded === issue.id
                  const severityStyle = SEVERITY_STYLE[issue.severity]
                  const hasPages = (issue.impactedUrls?.length ?? 0) > 0
                  const target = getInspectionTarget(issue)
                  const columns = getIssueColumns(issue)

                  return (
                    <li key={issue.id} className="glass-card overflow-hidden rounded-xl border transition-colors hover:border-shade-55">
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : issue.id)}
                        aria-expanded={isExpanded}
                        className="relative flex w-full items-start gap-3 py-3.5 pl-5 pr-4 text-left"
                      >
                        <span className={`absolute inset-y-0 left-0 w-1.5 ${severityStyle.bar}`} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold text-foreground">{issue.title}</span>
                            <span className="rounded-md border border-shade-4a bg-shade-38 px-2 py-0.5 text-[11px] text-muted-foreground">
                              {PILLAR_LABEL[issue.pillar]}
                            </span>
                            <span className={`text-[11px] font-semibold ${severityStyle.text}`}>{severityStyle.label}</span>
                          </div>
                          {issue.recommendation && (
                            <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{issue.recommendation}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-right text-xs text-muted-foreground">
                            <span className="block text-base font-bold text-foreground">{issue.impactCount ?? 0}</span>
                            page{(issue.impactCount ?? 0) > 1 ? 's' : ''}
                          </span>
                          <ChevronDown className={`size-5 text-primary-ink transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="space-y-4 border-t border-shade-3a bg-shade-24 px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <ImpactBadge impact={issue.impact} />
                          </div>
                          {issue.description && <p className="text-sm text-foreground/90">{issue.description}</p>}

                          {issue.steps && issue.steps.length > 0 && (
                            <div>
                              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Comment corriger
                              </h3>
                              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-foreground/90">
                                {issue.steps.slice(0, 4).map((step, index) => (
                                  <li key={index}>{step}</li>
                                ))}
                              </ol>
                            </div>
                          )}

                          {hasPages && (
                            <div>
                              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Pages concernées
                              </h3>
                              <div className="mt-2 overflow-x-auto">
                                <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left">
                                  <thead>
                                    <tr className="text-xs text-muted-foreground">
                                      <th scope="col" className="px-2 py-1.5 font-normal">URL</th>
                                      {columns.map((col) => (
                                        <th key={col.header} scope="col" className="px-2 py-1.5 font-normal">
                                          {col.header}
                                        </th>
                                      ))}
                                      <th scope="col" className="px-2 py-1.5" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(issue.impactedUrls ?? []).slice(0, 5).map((url) => (
                                      <tr key={url.id} className="border-t border-shade-33 align-top">
                                        <th scope="row" className="px-2 py-2 font-normal">
                                          <button
                                            type="button"
                                            onClick={() => openInspection(url.id, target.tab, target.section)}
                                            className="max-w-[220px] truncate text-left font-mono text-xs text-foreground hover:text-primary-ink sm:text-sm"
                                          >
                                            {url.path}
                                          </button>
                                        </th>
                                        {columns.map((col) => (
                                          <td key={col.header} className="px-2 py-2">
                                            {col.render(url)}
                                          </td>
                                        ))}
                                        <td className="px-2 py-2 text-right">
                                          <button
                                            type="button"
                                            onClick={() => openInspection(url.id, target.tab, target.section)}
                                            className="text-xs text-primary-ink hover:underline"
                                          >
                                            Inspecter
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="pt-3 text-right">
                                <Link
                                  href={`/projets/${projectId}/global-issues/${issue.id}`}
                                  className="inline-flex items-center gap-1 text-sm text-primary-ink hover:underline"
                                >
                                  Voir les {issue.impactedUrls?.length} page{(issue.impactedUrls?.length ?? 0) > 1 ? 's' : ''}
                                  <ArrowUpRight className="size-4" aria-hidden="true" />
                                </Link>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}

      <PageInspectionSheet />
    </div>
  )
}
