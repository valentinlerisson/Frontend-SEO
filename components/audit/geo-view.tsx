'use client'

import { useState } from 'react'
import { Search, FileText, ExternalLink } from 'lucide-react'
import { SemiCircleGauge } from './score-gauges'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'
import { AuditStateGate, PhaseLockBanner } from './audit-state-gate'

export function GeoView({ projectId }: { projectId: string }) {
  const { openInspection } = useInspection()
  const { audit, state } = useAudit()
  const [searchQuery, setSearchQuery] = useState('')

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="GEO Editorial" />

  const filteredPillars = audit.pillarPages.filter((p) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="GEO Editorial" />

      {audit.isLocked && (
        <>
          <h1 className="text-2xl font-bold text-foreground tracking-tight sm:text-3xl">GEO</h1>
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
              <h1 className="text-2xl font-bold text-foreground tracking-tight sm:text-3xl">GEO</h1>
              <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                {audit.pillarPages.length} pages piliers analysées
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Analyse GEO de vos pages piliers stratégiques
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
            {/* KPI 1: Score GEO Moyen */}
            <div className="flex flex-col items-center justify-center glass-card glass-lift rounded-2xl border p-6 text-center">
              <SemiCircleGauge
                score={audit.kpis.geoMean}
                size={160}
                label="Score GEO Moyen"
              />
            </div>

            {/* KPI 2: Statut /llms.txt */}
            <div className="flex flex-col items-center justify-center glass-card glass-lift rounded-2xl border p-6 text-center">
              <span className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                /llms.txt
              </span>
              <span
                className={`mt-3 inline-flex rounded-full px-4 py-1 text-xs font-bold text-white ${
                  audit.kpis.llmsTxtStatus === 'Present' ? 'bg-[#12b10f]' : 'bg-[#ef4444]'
                }`}
              >
                {audit.kpis.llmsTxtStatus === 'Present' ? 'Présent' : 'Manquant'}
              </span>
              <span className="mt-2 text-xs text-muted-foreground">Statut racine</span>
            </div>

            {/* KPI 3: Citabilité Moyenne */}
            <div className="flex flex-col items-center justify-center glass-card glass-lift rounded-2xl border p-6 text-center">
              <span className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
                {audit.kpis.citabilityMean}
                <span className="text-2xl font-bold">%</span>
              </span>
              <span className="mt-3 text-base font-semibold text-foreground">
                Citabilité Moyenne
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
                  Score GEO
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                  Accessibilité
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                  Citabilité
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal">
                  Schema.org
                </th>
                <th scope="col" className="bg-shade-38 px-6 py-4 font-normal rounded-r-xl">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredPillars.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
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
                        onClick={() => openInspection(page.id, 'geo')}
                        className="text-left group cursor-pointer"
                      >
                        <span className="block max-w-xs truncate text-base font-semibold text-foreground group-hover:text-primary-ink transition-colors">
                          {page.title}
                        </span>
                        <span className="block text-sm text-muted-foreground">{page.path}</span>
                      </button>
                    </th>

                    {/* Score GEO */}
                    <td className={cellClass}>
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                          page.geoScore >= 80
                            ? 'bg-[#12b10f] text-white'
                            : page.geoScore >= 60
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-[#ef4444] text-white'
                        }`}
                      >
                        {page.geoScore}/100
                      </span>
                    </td>

                    {/* Accessibilité */}
                    <td className={cellClass}>
                      <span
                        className={`inline-flex rounded-full px-3 py-0.5 text-xs font-bold ${
                          page.aiAccessibility ? 'bg-[#12b10f] text-white' : 'bg-[#ef4444] text-white'
                        }`}
                      >
                        {page.aiAccessibility ? 'OUI' : 'NON'}
                      </span>
                    </td>

                    {/* Citabilité */}
                    <td className={`${cellClass} text-sm font-semibold text-foreground`}>
                      {page.citability}
                    </td>

                    {/* Schema.org */}
                    <td className={cellClass}>
                      <span
                        className={`inline-flex rounded-full px-3 py-0.5 text-xs font-bold ${
                          page.schemaOrgPresent ? 'bg-[#12b10f] text-white' : 'bg-[#ef4444] text-white'
                        }`}
                      >
                        {page.schemaOrgPresent ? 'Présent' : 'Manquant'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className={cellClass}>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openInspection(page.id, 'geo')}
                          title="Inspecter le diagnostic GEO (Page Details)"
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
                          <ExternalLink className="size-4" />
                        </a>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {/* Inspection Sheet */}
      <PageInspectionSheet />
    </div>
  )
}
