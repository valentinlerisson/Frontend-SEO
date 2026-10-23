'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpRight, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { bigHappyAuditData, type GlobalIssueCategory } from '@/lib/audit-data'

export function GlobalIssuesView({ projectId = 'big-happy' }: { projectId?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const filterParam = searchParams.get('filter')

  const [activeCategory, setActiveCategory] = useState<GlobalIssueCategory>('all')
  const [expandedIssue, setExpandedIssue] = useState<string | null>('thin-content')

  const audit = bigHappyAuditData

  const filterTabs: { label: string; key: GlobalIssueCategory }[] = [
    { label: 'All', key: 'all' },
    { label: 'Tech. & Meta', key: 'tech' },
    { label: 'Structure', key: 'structure' },
    { label: 'Content', key: 'content' },
  ]

  const filteredIssues = audit.globalIssues.filter((issue) => {
    if (filterParam === 'critical' && issue.severity !== 'critical') return false
    if (filterParam === 'warning' && issue.severity !== 'warning') return false
    if (filterParam === 'passed' && issue.severity !== 'passed') return false

    if (activeCategory === 'all') return true
    return issue.categoryKey === activeCategory
  })

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Issues & Tips" />

      {/* Main Container Card */}
      <section className="rounded-2xl border border-[#3e3e3e] bg-[#222222] p-5 md:p-6 shadow-md">
        {/* Top Header: Title, Category Filters, Export PDF */}
        <div className="flex flex-col gap-4 border-b border-[#333333] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
            Global Issues & Tips
          </h1>

          <div className="flex flex-wrap items-center gap-3">
            {/* Category Filter Pills */}
            <div className="flex items-center rounded-xl bg-[#141414] p-1 border border-[#383838]">
              {filterTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveCategory(tab.key)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                    activeCategory === tab.key
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'text-muted-foreground hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <ExportPdfButton />
          </div>
        </div>

        {/* Filter reminder if accessed from Synthèse cards */}
        {filterParam && (
          <div className="mt-4 flex items-center justify-between rounded-xl bg-[#2a2a2a] px-4 py-2 text-xs text-muted-foreground">
            <span>
              Filtre actif : <strong className="text-white capitalize">{filterParam}</strong>
            </span>
            <button
              type="button"
              onClick={() => router.push(`/projets/${projectId}/global-issues`)}
              className="text-primary hover:underline font-medium"
            >
              Réinitialiser les filtres
            </button>
          </div>
        )}

        {/* Issues List */}
        <div className="mt-6 flex flex-col gap-3">
          {filteredIssues.map((issue) => {
            const isExpanded = expandedIssue === issue.id
            const isClickableDetail = issue.impactedUrls && issue.impactedUrls.length > 0

            return (
              <div
                key={issue.id}
                className="overflow-hidden rounded-xl border border-[#3e3e3e] bg-[#2b2b2b] transition-all hover:border-[#555555]"
              >
                {/* Main Item Row */}
                <div
                  onClick={() => {
                    if (isClickableDetail) {
                      setExpandedIssue(isExpanded ? null : issue.id)
                    }
                  }}
                  className={`flex items-center justify-between gap-4 p-4 text-white ${
                    isClickableDetail ? 'cursor-pointer' : ''
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* Severity Dot */}
                    <span
                      className={`size-3.5 rounded-full shrink-0 ${
                        issue.severity === 'critical'
                          ? 'bg-[#ef4444]'
                          : issue.severity === 'warning'
                          ? 'bg-[#eab308]'
                          : 'bg-[#12b10f]'
                      }`}
                    />
                    <span className="text-base sm:text-lg font-medium text-foreground truncate">
                      {issue.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="rounded-md border border-[#4a4a4a] bg-[#383838] px-3 py-1 text-xs text-muted-foreground">
                      {issue.category}
                    </span>

                    {isClickableDetail ? (
                      <ChevronDown
                        className={`size-5 text-[#f5e400] transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    ) : (
                      <ArrowUpRight className="size-5 text-[#ef4444]" />
                    )}
                  </div>
                </div>

                {/* Expanded preview for Thin content or other items with preview */}
                {isExpanded && issue.previewItems && (
                  <div className="border-t border-[#3a3a3a] bg-[#242424] px-6 py-4 space-y-3">
                    <div className="space-y-2">
                      {issue.previewItems.map((prev, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm text-foreground/80">
                          <span className="font-mono text-xs sm:text-sm text-muted-foreground">
                            {prev.path}
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`size-2.5 rounded-full ${
                                prev.severity === 'critical' ? 'bg-[#ef4444]' : 'bg-[#eab308]'
                              }`}
                            />
                            <span className="text-xs sm:text-sm">{prev.note}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 text-center">
                      <Link
                        href={`/projets/${projectId}/global-issues/${issue.id}`}
                        className="text-xs sm:text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-4"
                      >
                        Voir toute les erreurs
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Inspection Sheet */}
      <PageInspectionSheet />
    </div>
  )
}
