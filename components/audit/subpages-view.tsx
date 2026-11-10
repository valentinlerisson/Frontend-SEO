'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ExternalLink, Sparkles, CheckSquare, Square, FileText } from 'lucide-react'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection, useInspectionNavigation } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'
import { useSettings } from '@/components/providers/settings-provider'
import { AuditStateGate } from './audit-state-gate'
import { type SubpageItem } from '@/lib/audit-data'
import { LOW_SEARCH_POTENTIAL_ROLES } from '@/core/domain/scoring/page-role'
import { PageRoleFamily } from './page-role-family'
import { CustomizableTable, type ColumnSpec } from '@/components/table/customizable-table'
import { TableLayoutFooter, TableLayoutToolbar } from '@/components/table/table-layout-controls'
import { useTableLayout } from '@/components/table/use-table-layout'
import { usePageMetricColumns } from '@/components/table/page-metrics'
import type { TableColumn } from '@/lib/table-layout'
import { SelectionBar, useSelectionToast } from '@/components/table/selection-bar'
import { SelectionCheckbox, useRowSelection } from '@/components/table/use-row-selection'
import { usePageBulkActions } from './use-page-bulk-actions'

const PAGE_SIZE = 10

/** Colonnes du tableau (largeurs par défaut) : ordre, affichage, épinglage, largeur et densité choisis par chacun */
const SUBPAGE_COLUMNS: TableColumn[] = [
  { id: 'select', label: 'Sélection', width: 56, fixed: true },
  { id: 'url', label: 'URL', width: 300, minWidth: 160 },
  { id: 'role', label: 'Rôle et famille', width: 240, minWidth: 190 },
  { id: 'status', label: 'Statut HTTP', width: 130, minWidth: 96 },
  { id: 'tech', label: 'Score tech', width: 120, minWidth: 96 },
  { id: 'words', label: 'Texte', width: 120, minWidth: 96 },
  { id: 'links', label: 'Maillage', width: 130, minWidth: 104 },
  { id: 'queries', label: 'Requêtes notées', width: 240, minWidth: 140 },
  { id: 'details', label: 'Détails', width: 100, minWidth: 88 },
]

export function SubpagesView({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { openInspection, activeId } = useInspection()
  const { audit, state, savePillars, auditDbId, refreshAudit } = useAudit()
  const { maxAiPages } = useSettings()

  const [subpages, setSubpages] = useState<SubpageItem[]>(audit?.subpages ?? [])
  // Pages sélectionnées : actions de la barre flottante (analyse IA, fiches PDF, plan d'action)
  const selection = useRowSelection()
  const { selected: selectedIds, setSelected: setSelectedIds } = selection
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'indexable' | 'not-indexable'>('all')
  const [aiLaunched, setAiLaunched] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  // Barre d'actions sur la sélection : message après une action, fiches PDF et ajout au plan communs aux pages
  const [toast, setToast] = useSelectionToast()
  const bulk = usePageBulkActions({ projectId, audit, setToast })
  // Métriques ajoutables (masquées par défaut), sauf celles que le tableau montre déjà
  const metricColumns = usePageMetricColumns<SubpageItem>(audit, (page) => page.id, [
    'm:role', 'm:family', 'm:http', 'm:tech', 'm:words', 'm:depth', 'm:inlinks', 'm:main-query',
  ])
  const tableColumns = useMemo(() => [...SUBPAGE_COLUMNS, ...metricColumns], [metricColumns])
  const tableLayout = useTableLayout('sous-pages', tableColumns)

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

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredPages.length) setSelectedIds([])
    else setSelectedIds(filteredPages.map((p) => p.id))
  }

  const handleLaunchAi = async () => {
    setAiLaunched(true)
    setLaunchError(null)
    // Plus de requête saisie : l'IA choisit les mots-clés de chaque page, Keyword Planner donne leurs volumes
    const ok = await savePillars(selectedIds, {})
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

  // Fiche à côté de la liste : ↑ ↓ et J / K parcourent les pages filtrées, dans leur ordre
  useInspectionNavigation(filteredPages.map((page) => page.id))

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

  const allSelected = selectedIds.length > 0 && selectedIds.length === filteredPages.length
  // En-tête et cellule de chaque colonne, repris de l'ancien tableau
  const columnCells: Record<string, Omit<ColumnSpec<SubpageItem>, keyof TableColumn>> = {
    select: {
      header: (
        <button type="button" onClick={toggleSelectAll} aria-label="Tout sélectionner" className="flex items-center justify-center text-primary-ink">
          {allSelected ? <CheckSquare className="size-5 fill-primary text-black" /> : <Square className="size-5 text-muted-foreground" />}
        </button>
      ),
      cell: (page) => (
        <SelectionCheckbox selection={selection} id={page.id} order={pagedPages.map((item) => item.id)} label={`Sélectionner ${page.path}`} />
      ),
    },
    // URL : tronquée si trop longue, chemin complet au survol
    url: {
      rowHeader: true,
      cell: (page) => (
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openInspection(page.id)}
            title={page.path}
            className="min-w-0 cursor-pointer truncate text-left text-base font-semibold text-foreground transition-colors hover:text-primary-ink"
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
      ),
    },
    // Rôle (modifiable, avec son origine) et famille qui en découle
    role: {
      cell: (page) => (
        <PageRoleFamily
          pageId={page.id}
          path={page.path}
          role={page.role}
          roleSource={page.roleSource}
          roleReason={page.roleReason}
          family={page.family}
          familyStale={page.familyStale}
          variant="compact"
          onError={setLaunchError}
        />
      ),
    },
    status: {
      cell: (page) => (
        <span
          className={`inline-flex whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-bold text-white ${
            page.httpStatus >= 400 ? 'bg-[#ef4444]' : 'bg-[#12b10f]'
          }`}
        >
          {page.statusLabel}
        </span>
      ),
    },
    tech: {
      cell: (page) => (
        <span
          className={`inline-flex whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-bold ${
            page.techScore >= 80 ? 'bg-[#12b10f] text-white' : page.techScore >= 60 ? 'bg-primary text-primary-foreground' : 'bg-[#ef4444] text-white'
          }`}
        >
          {page.techScore}/100
        </span>
      ),
    },
    words: {
      cell: (page) => (
        <div className="flex items-center gap-2 text-sm">
          <span className="whitespace-nowrap font-semibold text-foreground">{page.wordCount} mots</span>
          <span
            className={`size-2.5 rounded-full ${
              page.wordCountStatus === 'good' ? 'bg-[#12b10f]' : page.wordCountStatus === 'warning' ? 'bg-[#eab308]' : 'bg-[#ef4444]'
            }`}
          />
        </div>
      ),
    },
    // Maillage : profondeur et liens entrants regroupés
    links: {
      cellClassName: 'whitespace-nowrap text-xs text-foreground',
      header: <span title="Profondeur de clic depuis l'accueil · liens internes entrants">Maillage</span>,
      cell: (page) => (
        <span>
          <span title={page.depth === 'Sitemap' ? 'Page atteinte seulement par le sitemap : aucun lien depuis les pages explorées' : 'Profondeur de clic'}>
            {page.depth}
          </span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span title="Liens internes entrants" className="font-semibold">
            {page.inlinks} lien{page.inlinks > 1 ? 's' : ''}
          </span>
        </span>
      ),
    },
    // Requêtes notées : choisies par l'IA et Keyword Planner, modifiables dans le tiroir de la page
    queries: {
      cellClassName: 'text-sm text-foreground',
      cell: (page) =>
        page.querySet && page.querySet.length > 0 ? (
          <span className="block min-w-0">
            <strong className="block truncate">{page.querySet[0].query}</strong>
            {page.querySet.length > 1 && (
              <span className="block text-xs text-muted-foreground">
                +{page.querySet.length - 1} requête{page.querySet.length > 2 ? 's' : ''}
                {page.querySet.some((entry) => entry.volume !== undefined)
                  ? ` · ${page.querySet.reduce((sum, entry) => sum + (entry.volume ?? 0), 0).toLocaleString('fr-FR')}/mois`
                  : ''}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{page.isPillar ? 'Après l’analyse IA' : 'Page non analysée par l’IA'}</span>
        ),
    },
    details: {
      cell: (page) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openInspection(page.id)}
            title="Inspecter la page"
            aria-label={`Inspecter ${page.path}`}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-shade-38 hover:text-foreground"
          >
            <FileText className="size-5" />
          </button>
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Visiter la page"
            aria-label={`Visiter ${page.path}`}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-shade-38 hover:text-primary-ink"
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
      ),
    },
  }
  const columns: ColumnSpec<SubpageItem>[] = [...SUBPAGE_COLUMNS.map((column) => ({ ...column, ...columnCells[column.id] })), ...metricColumns]

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Subpages" />

      {audit.interruptionNotice && (
        <p role="status" className="rounded-xl border border-line-indigo bg-tint-indigo p-3 text-sm text-sky-soft">
          {audit.interruptionNotice}
        </p>
      )}

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

        </div>

        {launchError && (
          <p role="status" className="mt-3 text-sm text-amber-ink">
            {launchError}
          </p>
        )}

        {subpages.length === 0 && (
          <p className="mt-6 py-10 text-center text-sm text-muted-foreground">
            Aucune page n’a été extraite lors du crawl.
          </p>
        )}

        {/* Disposition du tableau : colonnes, densité, retour au défaut */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Glissez sur les cases pour sélectionner plusieurs pages, Maj + clic pour une plage : les actions s’affichent
            en bas. Glissez un en-tête pour déplacer sa colonne ; « Colonnes » ajoute n’importe quelle métrique.
          </p>
          <TableLayoutToolbar api={tableLayout} columns={tableColumns} />
        </div>

        <div className="mt-3">
          <CustomizableTable
            api={tableLayout}
            columns={columns}
            rows={pagedPages}
            rowKey={(page) => page.id}
            rowSelected={(page) => selectedIds.includes(page.id)}
            rowActive={(page) => page.id === activeId}
            onRowClick={(page) => openInspection(page.id)}
            rowClassName={(page) => `transition-colors hover:bg-shade-28/60 ${selectedIds.includes(page.id) ? 'bg-tint-yellow-4/30' : ''}`}
            ariaLabel="Pages explorées"
          />
        </div>

        <div className="mt-4">
          <TableLayoutFooter api={tableLayout} />
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

      {/* Actions sur la sélection : barre flottante en bas de l'écran */}
      <SelectionBar
        count={selectedIds.length}
        noun={['page sélectionnée', 'pages sélectionnées']}
        info={overLimit ? `${maxAiPages} au plus pour l’analyse IA` : `analyse IA : ${maxAiPages} au plus`}
        onClear={() => setSelectedIds([])}
        toast={toast}
        actions={[
          ...bulk.actionsFor(selectedIds),
          {
            id: 'ai',
            label: aiLaunched ? 'Analyse en cours…' : 'Lancer l’analyse IA',
            icon: <Sparkles className="size-4" aria-hidden="true" />,
            primary: true,
            busy: aiLaunched,
            disabled: overLimit,
            title: overLimit
              ? `${maxAiPages} pages au plus pour l’analyse IA : retirez-en ${selectedIds.length - maxAiPages}`
              : 'Ces pages deviennent les pages stratégiques analysées par l’IA',
            onClick: handleLaunchAi,
          },
        ]}
      />

      {/* Fiches PDF des pages sélectionnées, imprimées ensemble (une page par fiche) */}
      {bulk.sheets}

      {/* Inspection Sheet */}
      <PageInspectionSheet />
    </div>
  )
}
