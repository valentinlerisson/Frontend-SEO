'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { CircularGauge } from './score-gauges'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { bigHappyAuditData } from '@/lib/audit-data'

export function SynthesisView({ projectId = 'big-happy' }: { projectId?: string }) {
  const audit = bigHappyAuditData

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Synthèse" />

      {/* Titre et Exporter PDF */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
          Synthèse de l’audit - {audit.domain}
        </h1>
        <ExportPdfButton />
      </div>

      {/* Bloc Score Global */}
      <section
        aria-labelledby="score-global-title"
        className="rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 shadow-md"
      >
        <h2 id="score-global-title" className="text-xl font-bold text-white mb-6">
          Score Global
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Jauge circulaire gauche */}
          <div className="lg:col-span-4 flex flex-col items-center justify-center">
            <CircularGauge score={audit.scores.global} size={160} strokeWidth={16} accentColor="#f5e400" />
            <span className="mt-3 text-base text-muted-foreground font-medium">Desktop</span>
          </div>

          {/* 3 Bannières d'alertes droites */}
          <div className="lg:col-span-8 flex flex-col gap-3.5">
            <Link
              href={`/projets/${projectId}/global-issues?filter=critical`}
              className="group flex items-center justify-between rounded-xl bg-white px-5 py-4 text-black font-semibold shadow transition-all hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="flex items-center gap-3">
                <span className="size-3.5 rounded-full bg-[#ef4444] shrink-0" />
                <span className="text-base sm:text-lg">
                  {audit.kpis.criticalIssuesCount} erreurs critiques bloquantes
                </span>
              </div>
              <ArrowUpRight className="size-5 text-[#ef4444] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.5} />
            </Link>

            <Link
              href={`/projets/${projectId}/global-issues?filter=warning`}
              className="group flex items-center justify-between rounded-xl bg-white px-5 py-4 text-black font-semibold shadow transition-all hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="flex items-center gap-3">
                <span className="size-3.5 rounded-full bg-[#eab308] shrink-0" />
                <span className="text-base sm:text-lg">
                  {audit.kpis.warningsCount} avertissements
                </span>
              </div>
              <ArrowUpRight className="size-5 text-[#eab308] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.5} />
            </Link>

            <Link
              href={`/projets/${projectId}/global-issues?filter=passed`}
              className="group flex items-center justify-between rounded-xl bg-white px-5 py-4 text-black font-semibold shadow transition-all hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="flex items-center gap-3">
                <span className="size-3.5 rounded-full bg-[#12b10f] shrink-0" />
                <span className="text-base sm:text-lg">
                  {audit.kpis.goodPracticesCount} bonnes pratiques
                </span>
              </div>
              <ArrowUpRight className="size-5 text-[#12b10f] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </section>

      {/* Details des Scores et Conseils */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 flex flex-col gap-4">
          <h2 className="text-xl font-bold text-white">Details des Scores</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Card 1: SEO Technique */}
            <Link
              href={`/projets/${projectId}/subpages`}
              className="flex flex-col items-center rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 text-center shadow-md transition-colors hover:border-primary/50"
            >
              <h3 className="text-base font-semibold text-white mb-4">SEO Technique</h3>
              <CircularGauge
                score={audit.scores.tech}
                size={120}
                strokeWidth={13}
                accentColor="#c026d3"
                displayFormat="fraction"
              />
              <span className="mt-4 text-xs sm:text-sm text-muted-foreground">
                Basé sur le crawl de 87 pages
              </span>
            </Link>

            {/* Card 2: SEO Editorial */}
            <Link
              href={`/projets/${projectId}/seo-editorial`}
              className="flex flex-col items-center rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 text-center shadow-md transition-colors hover:border-primary/50"
            >
              <h3 className="text-base font-semibold text-white mb-4">SEO Editorial</h3>
              <CircularGauge
                score={audit.scores.editorial}
                size={120}
                strokeWidth={13}
                accentColor="#f97316"
                displayFormat="fraction"
              />
              <span className="mt-4 text-xs sm:text-sm text-muted-foreground">
                Basé sur vos 10 pages piliers
              </span>
            </Link>

            {/* Card 3: GEO */}
            <Link
              href={`/projets/${projectId}/geo`}
              className="flex flex-col items-center rounded-2xl border border-[#3e3e3e] bg-[#2b2b2b] p-6 text-center shadow-md transition-colors hover:border-primary/50"
            >
              <h3 className="text-base font-semibold text-white mb-4">GEO</h3>
              <CircularGauge
                score={audit.scores.geo}
                size={120}
                strokeWidth={13}
                accentColor="#84cc16"
                displayFormat="fraction"
              />
              <span className="mt-4 text-xs sm:text-sm text-muted-foreground">
                Basé sur vos 10 pages piliers
              </span>
            </Link>
          </div>
        </div>

        {/* Colonne Conseils */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <h2 className="text-xl font-bold text-white">Conseils</h2>

          <div className="relative flex-1 overflow-hidden rounded-2xl bg-gradient-to-br from-[#f95738] via-[#ea580c] to-[#dc2626] p-6 text-white shadow-lg">
            {/* Logo Watermark */}
            <span
              aria-hidden="true"
              className="absolute right-4 top-4 text-8xl font-black text-black/15 select-none pointer-events-none"
            >
              B
            </span>

            <h3 className="text-xl font-extrabold tracking-tight mb-3">Titre Lorem ipsum</h3>
            <p className="text-sm sm:text-base leading-relaxed text-white/95">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea
            </p>
          </div>
        </div>
      </section>

      {/* Tiroir latéral d'inspection */}
      <PageInspectionSheet />
    </div>
  )
}
