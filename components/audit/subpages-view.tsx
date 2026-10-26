'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ExternalLink, Sparkles, Check, CheckSquare, Square, FileText } from 'lucide-react'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'
import { type SubpageItem } from '@/lib/audit-data'

export function SubpagesView({ projectId = 'big-happy' }: { projectId?: string }) {
  const router = useRouter()
  const { openInspection } = useInspection()
  const { audit, savePillars } = useAudit()

  const [subpages, setSubpages] = useState<SubpageItem[]>(audit.subpages || [])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'indexable' | 'not-indexable'>('all')
  const [aiLaunched, setAiLaunched] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (audit.subpages && audit.subpages.length > 0) {
      setSubpages(audit.subpages)
      const existingPillars = audit.subpages.filter((p) => p.isPillar).map((p) => p.id)
      if (existingPillars.length > 0) {
        setSelectedIds(existingPillars)
      } else if (selectedIds.length === 0) {
        setSelectedIds(audit.subpages.slice(0, 10).map((p) => p.id))
      }
    }
  }, [audit.subpages])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id)
      } else {
        if (prev.length >= 20) return prev
        return [...prev, id]
      }
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredPages.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredPages.slice(0, 20).map((p) => p.id))
    }
  }

  const handleKeywordChange = (id: string, keyword: string) => {
    setSubpages((prev) =>
      prev.map((item) => (item.id === id ? { ...item, targetKeyword: keyword } : item)),
    )
  }

  const handleLaunchAi = async () => {
    setAiLaunched(true)
    try {
      await savePillars(selectedIds)
    } catch (err) {
      console.error('Erreur sauvegarde des piliers:', err)
    } finally {
      setAiLaunched(false)
      router.push(`/projets/${projectId}/seo-editorial`)
    }
  }

  const filteredPages = subpages.filter((page) => {
    if (filterType === 'indexable' && !page.indexable) return false
    if (filterType === 'not-indexable' && page.indexable) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return page.path.toLowerCase().includes(q) || page.title.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Subpages" />

      {/* Main Table Card */}
      <section className="rounded-2xl border border-[#3e3e3e] bg-[#222222] p-5 md:p-6 shadow-md">
        {/* Top Header: Title, Selection Counter, Export PDF */}
        <div className="flex flex-col gap-4 border-b border-[#333333] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">Subpages</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              87 URL indexables trouvées lors du crawl
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-[#eab308]/60 bg-[#292411] px-5 py-2 text-sm md:text-base font-bold text-[#f5e400]">
              {selectedIds.length} / 20 sélectionnées
            </div>
            <ExportPdfButton />
          </div>
        </div>

        {/* Action Controls Bar */}
        <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative min-w-[260px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher une URL..."
                className="w-full rounded-xl border border-[#444444] bg-[#161616] py-2 pl-10 pr-4 text-sm text-white placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center rounded-xl bg-[#141414] p-1 border border-[#383838]">
              <button
                type="button"
                onClick={() => setFilterType('all')}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  filterType === 'all'
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-white'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterType('indexable')}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  filterType === 'indexable'
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-white'
                }`}
              >
                Indexable
              </button>
              <button
                type="button"
                onClick={() => setFilterType('not-indexable')}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  filterType === 'not-indexable'
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-white'
                }`}
              >
                Not indexable
              </button>
            </div>
          </div>

          {/* Yellow Action Button: Lancer l'analyse IA */}
          <button
            type="button"
            onClick={handleLaunchAi}
            disabled={selectedIds.length === 0 || aiLaunched}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm md:text-base font-bold text-primary-foreground shadow transition-transform hover:scale-[1.02] hover:bg-[#e0d100] active:scale-[0.98] disabled:opacity-50"
          >
            <Sparkles className="size-4" />
            {aiLaunched ? 'Analyse Claude 3.5 en cours...' : 'Lancer l’analyse IA'}
          </button>
        </div>

        {/* Data Table */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-base text-foreground">
                <th scope="col" className="bg-[#383838] px-4 py-4 font-normal rounded-l-xl w-12">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    aria-label="Tout sélectionner"
                    className="flex items-center justify-center text-primary"
                  >
                    {selectedIds.length > 0 && selectedIds.length === filteredPages.length ? (
                      <CheckSquare className="size-5 fill-primary text-black" />
                    ) : (
                      <Square className="size-5 text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th scope="col" className="bg-[#383838] px-4 py-4 font-normal">
                  URL
                </th>
                <th scope="col" className="bg-[#383838] px-4 py-4 font-normal">
                  Badge
                </th>
                <th scope="col" className="bg-[#383838] px-4 py-4 font-normal">
                  Texte
                </th>
                <th scope="col" className="bg-[#383838] px-4 py-4 font-normal">
                  Profondeur
                </th>
                <th scope="col" className="bg-[#383838] px-4 py-4 font-normal">
                  Inlinks
                </th>
                <th scope="col" className="bg-[#383838] px-4 py-4 font-normal">
                  Mot-clé cible
                </th>
                <th scope="col" className="bg-[#383838] px-4 py-4 font-normal rounded-r-xl">
                  Page Details
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredPages.map((page, index) => {
                const isSelected = selectedIds.includes(page.id)
                const isLast = index === filteredPages.length - 1
                const cellClass = `px-4 py-4 align-middle ${isLast ? '' : 'border-b border-[#333333]'}`

                return (
                  <tr
                    key={page.id}
                    className={`transition-colors hover:bg-[#282828]/60 ${
                      isSelected ? 'bg-[#292716]/30' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <td className={cellClass}>
                      <button
                        type="button"
                        onClick={() => toggleSelect(page.id)}
                        aria-label={`Sélectionner ${page.path}`}
                        className="flex size-5 items-center justify-center rounded border border-[#666666] transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {isSelected ? (
                          <div className="flex size-5 items-center justify-center rounded bg-primary text-black">
                            <Check className="size-3.5 stroke-[3]" />
                          </div>
                        ) : null}
                      </button>
                    </td>

                    {/* URL */}
                    <th scope="row" className={`${cellClass} font-normal`}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openInspection(page.id, 'tech')}
                          className="text-base font-semibold text-white hover:text-primary transition-colors text-left cursor-pointer"
                        >
                          {page.path}
                        </button>
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary transition-colors"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      </div>
                    </th>

                    {/* Badge HTTP */}
                    <td className={cellClass}>
                      <span className="inline-flex rounded-full bg-[#12b10f] px-3 py-0.5 text-xs font-bold text-white">
                        {page.statusLabel}
                      </span>
                    </td>

                    {/* Texte (Word count) */}
                    <td className={cellClass}>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-white">{page.wordCount} mots</span>
                        <span
                          className={`size-2.5 rounded-full ${
                            page.wordCountStatus === 'good'
                              ? 'bg-[#12b10f]'
                              : page.wordCountStatus === 'warning'
                              ? 'bg-[#eab308]'
                              : 'bg-[#ef4444]'
                          }`}
                        />
                        {page.wordCountStatus === 'critical' && (
                          <span className="text-xs text-muted-foreground">
                            (critères + 500 mots)
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Profondeur */}
                    <td className={`${cellClass} text-sm text-foreground`}>{page.depth}</td>

                    {/* Inlinks */}
                    <td className={`${cellClass} text-sm text-foreground font-semibold`}>
                      {page.inlinks}
                    </td>

                    {/* Mot-clé cible input */}
                    <td className={cellClass}>
                      <input
                        type="text"
                        value={page.targetKeyword}
                        onChange={(e) => handleKeywordChange(page.id, e.target.value)}
                        placeholder="Laissez vide pour auto-détection"
                        className="w-full max-w-xs rounded-xl border border-[#444444] bg-[#181818] px-3.5 py-1.5 text-xs text-white placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>

                    {/* Page Details / Actions */}
                    <td className={cellClass}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openInspection(page.id, 'tech')}
                          title="Inspecter la page (Page Details)"
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

        {/* Pagination Nav */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-[#333333] pt-4 text-xs text-muted-foreground">
          <span>1-10 sur 87 URL</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg px-2.5 py-1 hover:bg-[#333333] hover:text-white transition-colors"
            >
              Précédent
            </button>
            <span className="rounded-lg bg-primary px-2.5 py-1 font-bold text-black">1</span>
            <button type="button" className="rounded-lg px-2.5 py-1 hover:bg-[#333333] hover:text-white">
              2
            </button>
            <button type="button" className="rounded-lg px-2.5 py-1 hover:bg-[#333333] hover:text-white">
              3
            </button>
            <span>...</span>
            <button type="button" className="rounded-lg px-2.5 py-1 hover:bg-[#333333] hover:text-white">
              9
            </button>
            <button
              type="button"
              className="rounded-lg px-2.5 py-1 hover:bg-[#333333] hover:text-white transition-colors"
            >
              Suivant
            </button>
          </div>
        </div>
      </section>

      {/* Inspection Sheet */}
      <PageInspectionSheet />
    </div>
  )
}
