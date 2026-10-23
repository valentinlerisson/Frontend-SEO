'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Search, FileText, ExternalLink } from 'lucide-react'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection } from '@/components/providers/inspection-provider'
import { bigHappyAuditData } from '@/lib/audit-data'

export function IndividualIssueView({
  projectId = 'big-happy',
  issueId = 'thin-content',
}: {
  projectId?: string
  issueId?: string
}) {
  const { openInspection } = useInspection()
  const audit = bigHappyAuditData
  const issue =
    audit.globalIssues.find((i) => i.id === issueId) ||
    audit.globalIssues.find((i) => i.id === 'thin-content')!

  const [searchQuery, setSearchQuery] = useState('')

  const impactedUrls = issue.impactedUrls || []
  const filteredUrls = impactedUrls.filter(
    (item) =>
      item.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.fullUrl.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle={`Issues & Tips / ${issue.title.split('(')[0].trim()}`} />

      {/* Main Container */}
      <section className="rounded-2xl border border-[#3e3e3e] bg-[#222222] p-5 md:p-6 shadow-md">
        {/* Top bar with Back button, Title, Search, Export */}
        <div className="flex flex-col gap-4 border-b border-[#333333] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <Link
              href={`/projets/${projectId}/global-issues`}
              className="inline-flex items-center gap-1.5 text-base font-semibold text-primary transition-opacity hover:opacity-80"
            >
              <ChevronLeft className="size-5" />
              Retour aux erreurs
            </Link>

            <div>
              <h1 className="text-xl font-bold text-white tracking-tight sm:text-2xl">
                Thin Content
              </h1>
              <p className="text-xs text-muted-foreground">{issue.impactSummary || '34 URL thin content'}</p>
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
                className="w-full rounded-xl border border-[#444444] bg-[#161616] py-2 pl-10 pr-4 text-sm text-white placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <ExportPdfButton />
          </div>
        </div>

        {/* Issue Explanation Box */}
        <div className="mt-6 rounded-xl border border-[#3e3e3e] bg-[#1c1c1c] p-5">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-lg font-bold text-white">Thin Content</h2>
            <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
              {issue.impactCount} pages impactées
            </span>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed max-w-4xl">
            {issue.description}
          </p>
        </div>

        {/* Impacted URLs Table */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-base text-foreground">
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal rounded-l-xl">
                  URL
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Thin Content
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Profondeur
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal">
                  Inlinks
                </th>
                <th scope="col" className="bg-[#383838] px-6 py-4 font-normal rounded-r-xl">
                  Page Details
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUrls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    Aucune URL trouvée pour cette recherche.
                  </td>
                </tr>
              ) : (
                filteredUrls.map((item, index) => {
                  const isLast = index === filteredUrls.length - 1
                  const cellClass = `px-6 py-5 align-middle ${isLast ? '' : 'border-b border-[#333333]'}`
                  const isCritical = (item.wordCount || 0) < 400

                  return (
                    <tr key={item.id} className="hover:bg-[#282828]/50 transition-colors">
                      <th scope="row" className={`${cellClass} font-normal`}>
                        <button
                          type="button"
                          onClick={() => openInspection(item.id, 'tech')}
                          className="block text-left text-base font-semibold text-white hover:text-primary transition-colors cursor-pointer"
                        >
                          {item.path}
                        </button>
                      </th>
                      <td className={cellClass}>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold text-white">{item.wordCount} mots</span>
                          <span
                            className={`size-2.5 rounded-full ${
                              isCritical ? 'bg-[#ef4444]' : 'bg-[#eab308]'
                            }`}
                          />
                          <span className="text-xs text-muted-foreground">
                            (critères + 500 mots)
                          </span>
                        </div>
                      </td>
                      <td className={`${cellClass} text-sm text-foreground`}>{item.depth}</td>
                      <td className={`${cellClass} text-sm text-foreground font-semibold`}>
                        {item.inlinks}
                      </td>
                      <td className={cellClass}>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openInspection(item.id)}
                            title="Ouvrir l'inspection de la page"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-[#383838] hover:text-white transition-colors"
                          >
                            <FileText className="size-5" />
                          </button>
                          <a
                            href={item.fullUrl}
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
