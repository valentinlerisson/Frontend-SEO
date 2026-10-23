'use client'

import { useState } from 'react'
import { Search, FileText, ExternalLink } from 'lucide-react'
import { SemiCircleGauge, TrendAreaChart } from './score-gauges'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection } from '@/components/providers/inspection-provider'
import { bigHappyAuditData } from '@/lib/audit-data'

export function GeoView({ projectId = 'big-happy' }: { projectId?: string }) {
  const { openInspection } = useInspection()
  const audit = bigHappyAuditData
  const [searchQuery, setSearchQuery] = useState('')

  const filteredPillars = audit.pillarPages.filter((p) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="GEO Editorial" />

      {/* Main Container */}
      <section className="flex flex-col gap-6">
        {/* Header Bar */}
        <div className="flex flex-col gap-4 border-b border-[#333333] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">GEO</h1>
              <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                3 pages piliers analysées
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Analyse qualitative et sémantique générée par IA (Claude 3.5 Sonnet) sur vos pages stratégiques
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
                className="w-full rounded-xl border border-[#444444] bg-[#161616] py-2 pl-10 pr-4 text-sm text-white placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <ExportPdfButton />
          </div>
        </div>

        {/* KPI's Globaux */}
        <div>
          <h2 className="text-xl font-bold text-white mb-4">KPI's Globaux</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* KPI 1: Score GEO Moyen */}
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 text-center shadow-md">
              <SemiCircleGauge
                score={audit.kpis.geoMean}
                size={160}
                label="Score GEO Moyen"
              />
            </div>

            {/* KPI 2: Statut /llms.txt */}
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 text-center shadow-md">
              <span className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                /llms.txt
              </span>
              <span className="mt-3 inline-flex rounded-full bg-[#ef4444] px-4 py-1 text-xs font-bold text-white">
                Manquant
              </span>
              <span className="mt-2 text-xs text-muted-foreground">Statut racine</span>
            </div>

            {/* KPI 3: Citabilité Moyenne */}
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 text-center shadow-md">
              <div className="flex items-center justify-center gap-4">
                <span className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
                  {audit.kpis.citabilityMean}
                  <span className="text-2xl font-bold">%</span>
                </span>
                <TrendAreaChart />
              </div>
              <span className="mt-3 text-base font-semibold text-white">
                Citabilité Moyenne
              </span>
            </div>
          </div>
        </div>

        {/* Table of Pillar Pages */}
        <div className="rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-4 md:p-6 shadow-md overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-base text-foreground">
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal rounded-l-xl">
                  Page Pillier /
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Score GEO
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Accessibilité
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Citabilité
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Schema.org
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal rounded-r-xl">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredPillars.map((page, index) => {
                const isLast = index === filteredPillars.length - 1
                const cellClass = `px-6 py-5 align-middle ${isLast ? '' : 'border-b border-[#3e3e3e]'}`

                return (
                  <tr key={page.id} className="hover:bg-[#333333]/40 transition-colors">
                    {/* Page Pillier */}
                    <th scope="row" className={`${cellClass} font-normal`}>
                      <button
                        type="button"
                        onClick={() => openInspection(page.id, 'geo')}
                        className="text-left group cursor-pointer"
                      >
                        <span className="block text-base font-semibold text-white group-hover:text-primary transition-colors">
                          {page.id === 'wine-and-spirit'
                            ? 'Spécialiste Vin'
                            : page.id === 'accueil'
                            ? 'Agence marke..'
                            : 'A propos'}
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
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-[#383838] hover:text-white transition-colors cursor-pointer"
                        >
                          <FileText className="size-5" />
                        </button>
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Visiter la page"
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-[#383838] hover:text-primary transition-colors"
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

      {/* Inspection Sheet */}
      <PageInspectionSheet />
    </div>
  )
}
