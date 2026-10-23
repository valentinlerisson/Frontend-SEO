'use client'

import { useState } from 'react'
import { Search, AlertTriangle, FileText, ExternalLink } from 'lucide-react'
import { SemiCircleGauge } from './score-gauges'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection } from '@/components/providers/inspection-provider'
import { bigHappyAuditData, type PillarPage } from '@/lib/audit-data'

export function SeoEditorialView({ projectId = 'big-happy' }: { projectId?: string }) {
  const { openInspection } = useInspection()
  const audit = bigHappyAuditData
  const [searchQuery, setSearchQuery] = useState('')

  const filteredPillars = audit.pillarPages.filter((p) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.targetKeyword.toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="SEO" />

      {/* Main Container */}
      <section className="flex flex-col gap-6">
        {/* Header Bar */}
        <div className="flex flex-col gap-4 border-b border-[#333333] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
                SEO Editorial
              </h1>
              <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                3 pages piliers analysées
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Analyse qualitative générée par IA (Claude 3.5 Sonnet) sur vos pages stratégiques
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
            {/* KPI 1: Score éditorial moyen */}
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 text-center shadow-md">
              <SemiCircleGauge
                score={audit.kpis.editorialMean}
                size={160}
                label="Score éditorial moyen"
              />
            </div>

            {/* KPI 2: Cannibalisation détectée */}
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 text-center shadow-md">
              <div className="flex items-center gap-2 text-2xl font-extrabold text-white sm:text-3xl">
                <AlertTriangle className="size-7 text-[#ef4444] fill-[#ef4444]/20" />
                <span>1 Conflit</span>
              </div>
              <span className="mt-2 text-sm text-muted-foreground font-medium">
                Cannibalisation détectée
              </span>
            </div>

            {/* KPI 3: Intent Match Global */}
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 text-center shadow-md">
              <span className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
                {audit.kpis.intentMatchGlobal}
                <span className="text-2xl font-bold">%</span>
              </span>
              <span className="mt-2 text-base font-semibold text-white">
                Intent Match Global
              </span>
              <span className="text-xs text-muted-foreground">
                (Adéquation de l’intention)
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
                  Mots-clé Cible
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Score éditorial
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Intent Match
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Zones Chaudes
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Cannibalisation
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
                        onClick={() => openInspection(page.id, 'editorial')}
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

                    {/* Mots-clé Cible */}
                    <td className={`${cellClass} text-sm text-foreground`}>
                      {page.isAutoDetectedKeyword ? (
                        <span className="italic text-muted-foreground">
                          Auto détection : <strong className="text-white">{page.targetKeyword}</strong>
                        </span>
                      ) : (
                        <span>{page.targetKeyword}</span>
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
                      <div className="flex items-center gap-2 text-sm">
                        <span
                          className={`size-2.5 rounded-full ${
                            page.cannibalizationStatus === 'none'
                              ? 'bg-[#12b10f]'
                              : 'bg-[#ef4444]'
                          }`}
                        />
                        <span className="text-foreground">
                          {page.cannibalizationStatus === 'none'
                            ? 'Aucune'
                            : `Conflit avec ${page.cannibalizationTarget}`}
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
      </section>

      {/* Inspection Sheet */}
      <PageInspectionSheet />
    </div>
  )
}
