'use client'

import { useState } from 'react'
import { Search, AlertTriangle, FileText, ExternalLink } from 'lucide-react'
import { SemiCircleGauge } from './score-gauges'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'
import { AuditStateGate, PhaseLockBanner } from './audit-state-gate'
import Link from 'next/link'
import { ImpactBadge } from './impact-badge'
import { describePagePosition } from '@/lib/serp-labels'
import { type PillarPage } from '@/lib/audit-data'

export function SeoEditorialView({ projectId }: { projectId: string }) {
  const { openInspection } = useInspection()
  const { audit, state } = useAudit()
  const [searchQuery, setSearchQuery] = useState('')

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="SEO" />

  const coherenceIssues = audit.globalIssues.filter((issue) => issue.code.startsWith('SITE_'))

  const filteredPillars = audit.pillarPages.filter((p) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.targetKeyword.toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="SEO" />

      {audit.isLocked && (
        <>
          <h1 className="text-2xl font-bold text-foreground tracking-tight sm:text-3xl">SEO Editorial</h1>
          <PhaseLockBanner projectId={projectId} />
        </>
      )}

      {/* Main Container */}
      {!audit.isLocked && (
      <section className="flex flex-col gap-6">
        {/* Header Bar */}
        <div className="flex flex-col gap-4 border-b border-shade-33 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground tracking-tight sm:text-3xl">
                SEO Editorial
              </h1>
              <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                {audit.pillarPages.length} pages piliers analysées
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Analyse éditoriale de vos pages piliers stratégiques
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
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
            <ExportPdfButton />
          </div>
        </div>

        {/* KPI's Globaux */}
        <div>
          <h2 className="text-xl font-bold text-foreground mb-4">KPI's Globaux</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* KPI 1: Score éditorial moyen */}
            <div className="flex flex-col items-center justify-center glass-card glass-lift rounded-2xl border p-6 text-center">
              <SemiCircleGauge
                score={audit.kpis.editorialMean}
                size={160}
                label="Score éditorial moyen"
              />
            </div>

            {/* KPI 2: Cannibalisation détectée */}
            <div className="flex flex-col items-center justify-center glass-card glass-lift rounded-2xl border p-6 text-center">
              <div className="flex items-center gap-2 text-2xl font-extrabold text-foreground sm:text-3xl">
                <AlertTriangle className="size-7 text-[#ef4444] fill-[#ef4444]/20" />
                <span>
                  {audit.kpis.cannibalizationConflicts}{' '}
                  {audit.kpis.cannibalizationConflicts > 1 ? 'Conflits' : 'Conflit'}
                </span>
              </div>
              <span className="mt-2 text-sm text-muted-foreground font-medium">
                Cannibalisation détectée
              </span>
            </div>

            {/* KPI 3: Intent Match Global */}
            <div className="flex flex-col items-center justify-center glass-card glass-lift rounded-2xl border p-6 text-center">
              <span className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
                {audit.kpis.intentMatchGlobal}
                <span className="text-2xl font-bold">%</span>
              </span>
              <span className="mt-2 text-base font-semibold text-foreground">
                Intent Match Global
              </span>
              <span className="text-xs text-muted-foreground">
                (Adéquation de l’intention)
              </span>
            </div>
          </div>
        </div>

        {/* Table of Pillar Pages */}
        <div className="glass-card rounded-2xl border p-4 md:p-6 overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-base text-foreground">
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal rounded-l-xl">
                  Page Pillier /
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                  Mots-clé Cible
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                  Score éditorial
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                  Intent Match
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                  Zones Chaudes
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                  Cannibalisation
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal rounded-r-xl">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredPillars.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    Aucune page pilier analysée. Sélectionnez vos piliers dans Subpages.
                  </td>
                </tr>
              )}
              {filteredPillars.map((page, index) => {
                const isLast = index === filteredPillars.length - 1
                const cellClass = `px-6 py-5 align-middle ${isLast ? '' : 'border-b border-shade-3e'}`

                return (
                  <tr key={page.id} className="hover:bg-shade-33/40 transition-colors">
                    {/* Page Pillier */}
                    <th scope="row" className={`${cellClass} font-normal`}>
                      <button
                        type="button"
                        onClick={() => openInspection(page.id, 'editorial')}
                        className="text-left group cursor-pointer"
                      >
                        <span className="block max-w-xs truncate text-base font-semibold text-foreground group-hover:text-primary-ink transition-colors">
                          {page.title}
                        </span>
                        <span className="block text-sm text-muted-foreground">{page.path}</span>
                        <span className="mt-0.5 inline-block rounded-full border border-shade-44 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {page.roleLabel}
                        </span>
                      </button>
                    </th>

                    {/* Mots-clé Cible */}
                    <td className={`${cellClass} text-sm text-foreground`}>
                      {page.isAutoDetectedKeyword ? (
                        <span className="italic text-muted-foreground">
                          Auto détection : <strong className="text-foreground">{page.targetKeyword}</strong>
                        </span>
                      ) : (
                        <span>{page.targetKeyword}</span>
                      )}
                      {page.serp?.status === 'DONE' && (
                        <Link
                          href={`/projets/${projectId}/positionnement`}
                          className="mt-1 block text-xs font-semibold text-primary-ink hover:underline"
                        >
                          {`${describePagePosition(page.serp).badge} sur Google`}
                        </Link>
                      )}
                    </td>

                    {/* Score éditorial badge */}
                    <td className={cellClass}>
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                          page.editorialScore >= 80
                            ? 'bg-[#12b10f] text-white'
                            : page.editorialScore >= 60
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-[#ef4444] text-white'
                        }`}
                      >
                        {page.editorialScore}/100
                      </span>
                    </td>

                    {/* Intent Match */}
                    <td className={`${cellClass} text-sm font-semibold text-foreground`}>
                      {page.intentMatchScore}/20
                    </td>

                    {/* Zones Chaudes */}
                    <td className={`${cellClass} text-sm font-semibold text-foreground`}>
                      {page.hotZonesScore}/15
                    </td>

                    {/* Cannibalisation */}
                    <td className={cellClass}>
                      <div className="flex items-start gap-2 text-sm">
                        <span
                          className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                            page.cannibalizationStatus === 'none'
                              ? 'bg-[#12b10f]'
                              : page.cannibalizationStatus === 'partial'
                              ? 'bg-[#eab308]'
                              : 'bg-[#ef4444]'
                          }`}
                        />
                        <span className="text-foreground">
                          {page.cannibalizationStatus === 'none' ? (
                            'Aucune'
                          ) : (
                            <>
                              {page.cannibalizationStatus === 'partial' ? 'Recoupement partiel avec ' : 'Conflit avec '}
                              <span className="font-mono text-xs">{page.cannibalizationTarget}</span>
                              {page.cannibalizationQuery && (
                                <span className="block text-xs text-muted-foreground">
                                  Requête commune : « {page.cannibalizationQuery} »
                                </span>
                              )}
                              <span className="block text-xs text-muted-foreground">Estimation IA</span>
                            </>
                          )}
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className={cellClass}>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openInspection(page.id, 'editorial')}
                          title="Inspecter le SEO Éditorial (Page Details)"
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-shade-38 hover:text-foreground transition-colors cursor-pointer"
                        >
                          <FileText className="size-5" />
                        </button>
                        <a
                          href={page.url}
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
              })}
            </tbody>
          </table>
        </div>

        {/* Cohérence du site : incohérences relevées en comparant les pages */}
        <div className="glass-card rounded-2xl border p-4 md:p-6">
          <h2 className="text-xl font-bold text-foreground">Cohérence du site</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Incohérences relevées en comparant vos pages entre elles. Les constats de l’IA sont des estimations à vérifier.
          </p>
          {coherenceIssues.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Aucune incohérence détectée entre vos pages.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {coherenceIssues.map((issue) => (
                <li key={issue.id} className="rounded-xl border border-shade-3e bg-shade-24 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{issue.title}</span>
                    <ImpactBadge impact={issue.impact} />
                  </div>
                  {issue.description && <p className="mt-1.5 text-sm text-foreground">{issue.description}</p>}
                  {issue.recommendation && (
                    <p className="mt-1.5 text-xs text-muted-foreground">Conseil : {issue.recommendation}</p>
                  )}
                  {issue.impactedUrls && issue.impactedUrls.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {issue.impactedUrls.slice(0, 8).map((url) => (
                        <button
                          key={url.id}
                          type="button"
                          onClick={() => openInspection(url.id, 'editorial')}
                          className="rounded-md border border-shade-44 px-2 py-0.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                        >
                          {url.path}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      )}

      {/* Inspection Sheet */}
      <PageInspectionSheet />
    </div>
  )
}
