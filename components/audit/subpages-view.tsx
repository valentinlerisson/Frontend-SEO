'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ExternalLink, Sparkles, Check, CheckSquare, Square, FileText } from 'lucide-react'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'
import { useSettings } from '@/components/providers/settings-provider'
import { AuditStateGate } from './audit-state-gate'
import { type SubpageItem } from '@/lib/audit-data'
import { LOW_SEARCH_POTENTIAL_ROLES, PAGE_ROLES, ROLE_LABEL } from '@/core/domain/scoring/page-role'
import type { PageRole } from '@/core/domain/types'

const PAGE_SIZE = 10

export function SubpagesView({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { openInspection } = useInspection()
  const { audit, state, savePillars, auditDbId, refreshAudit } = useAudit()
  const { maxAiPages } = useSettings()

  const [subpages, setSubpages] = useState<SubpageItem[]>(audit?.subpages ?? [])
  // Requêtes saisies à la main (identifiant de page vers requête), envoyées au lancement de l'analyse
  const [typedKeywords, setTypedKeywords] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'indexable' | 'not-indexable'>('all')
  const [aiLaunched, setAiLaunched] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [limitMessage, setLimitMessage] = useState<string | null>(null)
  const limitText = `Limite atteinte : maximum ${maxAiPages} pages analysables par IA`
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (audit?.subpages && audit.subpages.length > 0) {
      setSubpages(audit.subpages)
      const existingPillars = audit.subpages.filter((p) => p.isPillar).map((p) => p.id)
      if (existingPillars.length > 0) {
        setSelectedIds(existingPillars)
      } else if (selectedIds.length === 0) {
        setSelectedIds(audit.subpages.slice(0, Math.min(10, maxAiPages)).map((p) => p.id))
      }
    }
  }, [audit?.subpages])

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id))
      setLimitMessage(null)
      return
    }
    if (selectedIds.length >= maxAiPages) {
      setLimitMessage(limitText)
      return
    }
    setLimitMessage(null)
    setSelectedIds([...selectedIds, id])
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredPages.length) {
      setSelectedIds([])
      setLimitMessage(null)
    } else {
      setSelectedIds(filteredPages.slice(0, maxAiPages).map((p) => p.id))
      setLimitMessage(filteredPages.length > maxAiPages ? limitText : null)
    }
  }

  const handleKeywordChange = (id: string, keyword: string) => {
    setSubpages((prev) =>
      prev.map((item) => (item.id === id ? { ...item, targetKeyword: keyword } : item)),
    )
    setTypedKeywords((prev) => ({ ...prev, [id]: keyword }))
  }

  // Correction manuelle du rôle d'une page : enregistrée, puis les scores concernés sont recalculés
  const handleRoleChange = async (pageId: string, role: PageRole) => {
    if (!auditDbId) return
    setLaunchError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`)
      await refreshAudit()
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Correction du rôle impossible')
    }
  }

  const handleLaunchAi = async () => {
    setAiLaunched(true)
    setLaunchError(null)
    // Seules les requêtes saisies des pages sélectionnées sont envoyées ; une saisie vide laisse l'auto-détection
    const queries = Object.fromEntries(
      Object.entries(typedKeywords).filter(([id, value]) => selectedIds.includes(id) && value.trim()),
    )
    const ok = await savePillars(selectedIds, queries)
    setAiLaunched(false)
    if (ok) {
      router.push(`/projets/${projectId}/seo-editorial`)
    } else {
      setLaunchError('La sauvegarde des pages piliers a échoué. Réessayez.')
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

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="Subpages" />

  const overLimit = selectedIds.length > maxAiPages
  const selectedPages = subpages.filter((page) => selectedIds.includes(page.id))
  const lowPotentialShare =
    selectedPages.length === 0
      ? 0
      : selectedPages.filter((page) => LOW_SEARCH_POTENTIAL_ROLES.includes(page.role)).length / selectedPages.length
  const showCompositionWarning = selectedPages.length >= 3 && lowPotentialShare >= 0.75
  const totalPagesCount = Math.max(1, Math.ceil(filteredPages.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPagesCount)
  const pagedPages = filteredPages.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const rangeStart = filteredPages.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filteredPages.length)

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Subpages" />

      {/* Main Table Card */}
      <section className="glass-card rounded-2xl border p-5 md:p-6">
        {/* Top Header: Title, Selection Counter, Export PDF */}
        <div className="flex flex-col gap-4 border-b border-shade-33 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight sm:text-3xl">Subpages</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {subpages.filter((p) => p.indexable).length} URL indexables trouvées lors du crawl
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-[#eab308]/60 bg-tint-yellow-2 px-5 py-2 text-sm md:text-base font-bold text-primary-ink">
              {selectedIds.length} / {maxAiPages} sélectionnées
            </div>
            <ExportPdfButton />
          </div>
        </div>

        {showCompositionWarning && (
          <p className="mt-4 rounded-xl border border-[#eab308]/60 bg-tint-yellow-2 p-3 text-sm text-yellow-pale">
            Vos pages sélectionnées sont surtout des pages d’accueil, de marque ou de contact, qui visent peu de
            requêtes de recherche. Ajoutez des pages d’offre, de service ou d’information pour obtenir une analyse
            utile au classement, et pour détecter les pages qui se concurrencent entre elles.
          </p>
        )}

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
                className="w-full rounded-xl border border-shade-44 bg-shade-16 py-2 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center rounded-xl bg-shade-14 p-1 border border-shade-38">
              <button
                type="button"
                onClick={() => setFilterType('all')}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  filterType === 'all'
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground'
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
                    : 'text-muted-foreground hover:text-foreground'
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
                    : 'text-muted-foreground hover:text-foreground'
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
            disabled={selectedIds.length < 1 || overLimit || aiLaunched}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm md:text-base font-bold text-primary-foreground shadow transition-transform hover:scale-[1.02] hover:bg-[#e0d100] active:scale-[0.98] disabled:opacity-50"
          >
            <Sparkles className="size-4" />
            {aiLaunched ? 'Analyse en cours...' : 'Lancer l’analyse IA'}
          </button>
        </div>

        <div
          role="progressbar"
          aria-label="Pages sélectionnées pour l’analyse IA"
          aria-valuenow={selectedIds.length}
          aria-valuemin={0}
          aria-valuemax={maxAiPages}
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-shade-33"
        >
          <div
            className={`h-full rounded-full transition-all ${overLimit ? 'bg-[#ef4444]' : 'bg-primary'}`}
            style={{ width: `${Math.min(100, (selectedIds.length / maxAiPages) * 100)}%` }}
          />
        </div>

        {(limitMessage || overLimit || selectedIds.length < 1 || launchError) && (
          <p role="status" className="mt-3 text-sm text-amber-ink">
            {launchError ??
              (overLimit ? limitText : limitMessage) ??
              'Sélectionnez au moins 1 page pour lancer l’analyse.'}
          </p>
        )}

        {subpages.length === 0 && (
          <p className="mt-6 py-10 text-center text-sm text-muted-foreground">
            Aucune page n’a été extraite lors du crawl.
          </p>
        )}

        {/* Data Table */}
        <div className="mt-6 overflow-x-auto">
          {/* Largeurs fixes : les colonnes restent alignées quelle que soit la longueur des URL */}
          <table className="w-full min-w-[1410px] table-fixed border-separate border-spacing-0 text-left">
            <colgroup>
              <col className="w-14" />
              <col className="w-[300px]" />
              <col className="w-[230px]" />
              <col className="w-[150px]" />
              <col className="w-[115px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col />
              <col className="w-[120px]" />
            </colgroup>
            <thead>
              <tr className="text-base text-foreground">
                <th scope="col" className="bg-shade-38 px-4 py-4 font-normal rounded-l-xl w-12">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    aria-label="Tout sélectionner"
                    className="flex items-center justify-center text-primary-ink"
                  >
                    {selectedIds.length > 0 && selectedIds.length === filteredPages.length ? (
                      <CheckSquare className="size-5 fill-primary text-black" />
                    ) : (
                      <Square className="size-5 text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th scope="col" className="bg-shade-38 px-4 py-4 font-normal">
                  URL
                </th>
                <th scope="col" className="bg-shade-38 px-4 py-4 font-normal">
                  Rôle
                </th>
                <th scope="col" className="bg-shade-38 px-4 py-4 font-normal">
                  Badge
                </th>
                <th scope="col" className="bg-shade-38 px-4 py-4 font-normal">
                  Score tech
                </th>
                <th scope="col" className="bg-shade-38 px-4 py-4 font-normal">
                  Texte
                </th>
                <th
                  scope="col"
                  title="Profondeur de clic depuis l'accueil · liens internes entrants"
                  className="bg-shade-38 px-4 py-4 font-normal"
                >
                  Maillage
                </th>
                <th scope="col" className="bg-shade-38 px-4 py-4 font-normal">
                  Mot-clé cible
                </th>
                <th scope="col" className="bg-shade-38 px-4 py-4 font-normal rounded-r-xl">
                  Page Details
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedPages.map((page, index) => {
                const isSelected = selectedIds.includes(page.id)
                const isLast = index === pagedPages.length - 1
                const cellClass = `px-4 py-4 align-middle ${isLast ? '' : 'border-b border-shade-33'}`

                return (
                  <tr
                    key={page.id}
                    className={`transition-colors hover:bg-shade-28/60 ${
                      isSelected ? 'bg-tint-yellow-4/30' : ''
                    }`}
                  >
                    {/* Checkbox */}
                    <td className={cellClass}>
                      <button
                        type="button"
                        onClick={() => toggleSelect(page.id)}
                        aria-label={`Sélectionner ${page.path}`}
                        className="flex size-5 items-center justify-center rounded border border-shade-66 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {isSelected ? (
                          <div className="flex size-5 items-center justify-center rounded bg-primary text-black">
                            <Check className="size-3.5 stroke-[3]" />
                          </div>
                        ) : null}
                      </button>
                    </td>

                    {/* URL : tronquée si trop longue, chemin complet au survol */}
                    <th scope="row" className={`${cellClass} font-normal`}>
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openInspection(page.id, 'tech')}
                          title={page.path}
                          className="min-w-0 truncate text-left text-base font-semibold text-foreground transition-colors hover:text-primary-ink cursor-pointer"
                        >
                          {page.path}
                        </button>
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Ouvrir ${page.path} dans un nouvel onglet`}
                          className="shrink-0 text-muted-foreground transition-colors hover:text-primary-ink"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      </div>
                    </th>

                    {/* Rôle : modifiable, avec son origine */}
                    <td className={cellClass}>
                      <select
                        value={page.role}
                        onChange={(e) => handleRoleChange(page.id, e.target.value as PageRole)}
                        aria-label={`Rôle de ${page.path}`}
                        title={page.roleReason ?? 'Rôle de la page : modifiable'}
                        className="w-full truncate rounded-lg border border-shade-44 bg-shade-18 px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
                      >
                        {PAGE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                      {page.roleSource !== 'auto' && (
                        <span className="mt-1 block text-[11px] text-primary-ink">
                          {page.roleSource === 'manual' ? 'Modifié par vous' : 'Corrigé par l’IA'}
                        </span>
                      )}
                    </td>

                    {/* Badge HTTP */}
                    <td className={cellClass}>
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-bold text-white ${
                          page.httpStatus >= 400 ? 'bg-[#ef4444]' : 'bg-[#12b10f]'
                        }`}
                      >
                        {page.statusLabel}
                      </span>
                    </td>

                    {/* Score technique */}
                    <td className={cellClass}>
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-bold ${
                          page.techScore >= 80
                            ? 'bg-[#12b10f] text-white'
                            : page.techScore >= 60
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-[#ef4444] text-white'
                        }`}
                      >
                        {page.techScore}/100
                      </span>
                    </td>

                    {/* Texte (Word count) */}
                    <td className={cellClass}>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="whitespace-nowrap font-semibold text-foreground">{page.wordCount} mots</span>
                        <span
                          className={`size-2.5 rounded-full ${
                            page.wordCountStatus === 'good'
                              ? 'bg-[#12b10f]'
                              : page.wordCountStatus === 'warning'
                              ? 'bg-[#eab308]'
                              : 'bg-[#ef4444]'
                          }`}
                        />
                      </div>
                    </td>

                    {/* Maillage : profondeur et liens entrants regroupés */}
                    <td className={`${cellClass} whitespace-nowrap text-xs text-foreground`}>
                      <span title={page.depth === 'Sitemap' ? "Page atteinte seulement par le sitemap : aucun lien depuis les pages explorées" : "Profondeur de clic"}>{page.depth}</span>
                      <span className="mx-1.5 text-muted-foreground">·</span>
                      <span title="Liens internes entrants" className="font-semibold">
                        {page.inlinks} lien{page.inlinks > 1 ? 's' : ''}
                      </span>
                    </td>

                    {/* Mot-clé cible input */}
                    <td className={cellClass}>
                      <input
                        type="text"
                        value={page.targetKeyword}
                        onChange={(e) => handleKeywordChange(page.id, e.target.value)}
                        placeholder="Laissez vide pour auto-détection"
                        className="w-full rounded-xl border border-shade-44 bg-shade-18 px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>

                    {/* Page Details / Actions */}
                    <td className={cellClass}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openInspection(page.id, 'tech')}
                          title="Inspecter la page (Page Details)"
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

        {/* Pagination Nav */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-shade-33 pt-4 text-xs text-muted-foreground">
          <span>
            {rangeStart}-{rangeEnd} sur {filteredPages.length} URL
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
              disabled={safePage === 1}
              className="rounded-lg px-2.5 py-1 hover:bg-shade-33 hover:text-foreground transition-colors disabled:opacity-40"
            >
              Précédent
            </button>
            <span className="rounded-lg bg-primary px-2.5 py-1 font-bold text-black">
              {safePage} / {totalPagesCount}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage(Math.min(totalPagesCount, safePage + 1))}
              disabled={safePage === totalPagesCount}
              className="rounded-lg px-2.5 py-1 hover:bg-shade-33 hover:text-foreground transition-colors disabled:opacity-40"
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
