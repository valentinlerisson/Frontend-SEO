'use client'

import { useMemo, useState } from 'react'
import { Search, AlertTriangle, FileText, ExternalLink, PenLine, RefreshCw, Target, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { SemiCircleGauge } from './score-gauges'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useInspection, useInspectionNavigation } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'
import { AuditStateGate, PhaseLockBanner } from './audit-state-gate'
import Link from 'next/link'
import { ImpactBadge } from './impact-badge'
import { describePagePosition } from '@/lib/serp-labels'
import { type PillarPage } from '@/lib/audit-data'
import { CustomizableTable, type ColumnSpec } from '@/components/table/customizable-table'
import { TableLayoutFooter, TableLayoutToolbar } from '@/components/table/table-layout-controls'
import { useTableLayout } from '@/components/table/use-table-layout'
import { usePageMetricColumns } from '@/components/table/page-metrics'
import type { TableColumn } from '@/lib/table-layout'
import { SelectionBar, useSelectionToast, type SelectionConfirm } from '@/components/table/selection-bar'
import { SelectionCheckbox, useRowSelection } from '@/components/table/use-row-selection'
import { usePageBulkActions } from './use-page-bulk-actions'

/** Colonnes du tableau (largeurs par défaut) : ordre, affichage, épinglage, largeur et densité choisis par chacun */
const EDITORIAL_COLUMNS: TableColumn[] = [
  { id: 'select', label: 'Sélection', width: 48, fixed: true },
  { id: 'page', label: 'Page pilier', width: 192, minWidth: 160 },
  { id: 'queries', label: 'Requêtes notées', width: 200, minWidth: 160 },
  { id: 'score', label: 'Score éditorial', width: 120, minWidth: 110 },
  { id: 'intent', label: 'Intent Match', width: 110, minWidth: 100 },
  { id: 'coverage', label: 'Couverture des recherches', width: 140, minWidth: 120 },
  { id: 'cannibal', label: 'Cannibalisation', width: 150, minWidth: 130 },
  { id: 'actions', label: 'Actions', width: 110, minWidth: 100 },
]

export function SeoEditorialView({ projectId }: { projectId: string }) {
  const { openInspection, activeId } = useInspection()
  const { audit, state, auditDbId, refreshAudit, savePillars } = useAudit()
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  // Pages piliers sélectionnées : actions de la barre flottante (IA, Google, fiches PDF, plan d'action)
  const selection = useRowSelection()
  const { selected } = selection
  const [toast, setToast] = useSelectionToast()
  const [confirm, setConfirm] = useState<SelectionConfirm | null>(null)
  const [progress, setProgress] = useState<{ id: string; done: number; total: number } | null>(null)
  const bulk = usePageBulkActions({ projectId, audit, setToast })
  // Métriques ajoutables (masquées par défaut), sauf celles que le tableau montre déjà
  const metricColumns = usePageMetricColumns<PillarPage>(audit, (page) => page.id, [
    'm:editorial', 'm:intent-match', 'm:hot-zones', 'm:cannibal', 'm:main-query',
  ])
  const tableColumns = useMemo(() => [...EDITORIAL_COLUMNS, ...metricColumns], [metricColumns])
  const tableLayout = useTableLayout('seo-editorial', tableColumns)

  // Fiche à côté de la liste : ↑ ↓ et J / K parcourent les pages piliers affichées (filtre de recherche compris)
  const pillarQuery = searchQuery.trim().toLowerCase()
  useInspectionNavigation(
    (audit?.pillarPages ?? [])
      .filter((p) => !pillarQuery || p.title.toLowerCase().includes(pillarQuery) || p.path.toLowerCase().includes(pillarQuery) || p.targetKeyword.toLowerCase().includes(pillarQuery))
      .map((p) => p.id),
  )

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="SEO" />

  const coherenceIssues = audit.globalIssues.filter((issue) => issue.code.startsWith('SITE_'))

  const filteredPillars = audit.pillarPages.filter((p) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.targetKeyword.toLowerCase().includes(q)
  })

  /** Une requête par page, l'une après l'autre (l'IA et le serveur ne sont pas sollicités en parallèle) */
  const runEach = async (actionId: string, ids: string[], request: (id: string) => Promise<Response | null>, done: string) => {
    setConfirm(null)
    setProgress({ id: actionId, done: 0, total: ids.length })
    let failed = 0
    for (const [index, id] of ids.entries()) {
      const res = await request(id).catch(() => null)
      if (!res?.ok) failed++
      setProgress({ id: actionId, done: index + 1, total: ids.length })
    }
    setProgress(null)
    await refreshAudit()
    setToast({ text: failed ? `${done} : ${ids.length - failed} sur ${ids.length}, ${failed} en échec` : `${done} : ${ids.length} page${ids.length > 1 ? 's' : ''}` })
  }
  const post = (path: string, body: object) =>
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  // Réécritures à rédiger : absentes ou périmées (les autres sont rendues sans appel à l'IA)
  const rewriteNeeded = selected.filter((id) => {
    const rewrite = audit.inspections[id]?.editorial.rewrite
    return !rewrite || rewrite.outdated
  })
  const pillarIds = audit.pillarPages.map((page) => page.id)
  const keptPillars = pillarIds.filter((id) => !selected.includes(id))
  const busy = progress !== null
  const progressLabel = (actionId: string, label: string) =>
    progress?.id === actionId ? `${label} ${progress.done}/${progress.total}` : label

  // En-tête et cellule de chaque colonne du tableau, puis les métriques ajoutables
  const visibleIds = filteredPillars.map((page) => page.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const columnCells: Record<string, Omit<ColumnSpec<PillarPage>, keyof TableColumn>> = {
    select: {
      header: (
        <input
          type="checkbox"
          aria-label="Tout sélectionner"
          checked={allSelected}
          onChange={() => selection.setSelected(allSelected ? [] : visibleIds)}
          className="size-4 accent-[#f5e400]"
        />
      ),
      cell: (page) => <SelectionCheckbox selection={selection} id={page.id} order={visibleIds} label={`Sélectionner ${page.path}`} />,
    },
    page: {
      rowHeader: true,
      cell: (page) => (
        <button type="button" onClick={() => openInspection(page.id, 'editorial')} className="group max-w-full cursor-pointer text-left">
          <span className="block truncate text-base font-semibold text-foreground transition-colors group-hover:text-primary-ink">{page.title}</span>
          <span className="block truncate text-sm text-muted-foreground">{page.path}</span>
          <span className="mt-0.5 inline-block rounded-full border border-shade-44 px-2 py-0.5 text-[11px] text-muted-foreground">{page.roleLabel}</span>
        </button>
      ),
    },
    // Requêtes notées : la plus lourde, puis le nombre d'autres et le volume total
    queries: {
      cellClassName: 'text-sm text-foreground',
      cell: (page) => (
        <>
          {page.querySet && page.querySet.length > 1 ? (
            <span className="block min-w-0">
              <strong className="block truncate text-foreground">{page.querySet[0].query}</strong>
              <span className="block text-xs text-muted-foreground">
                +{page.querySet.length - 1} requête{page.querySet.length > 2 ? 's' : ''}
                {page.querySet.some((entry) => entry.volume !== undefined)
                  ? ` · ${page.querySet.reduce((sum, entry) => sum + (entry.volume ?? 0), 0).toLocaleString('fr-FR')}/mois`
                  : ''}
              </span>
            </span>
          ) : page.isAutoDetectedKeyword ? (
            <span className="italic text-muted-foreground">
              Auto détection : <strong className="text-foreground">{page.targetKeyword}</strong>
            </span>
          ) : (
            <span>{page.targetKeyword}</span>
          )}
          {page.serp?.status === 'DONE' && (
            <Link href={`/projets/${projectId}/positionnement`} className="mt-1 block text-xs font-semibold text-primary-ink hover:underline">
              {`${describePagePosition(page.serp).badge} sur Google`}
            </Link>
          )}
        </>
      ),
    },
    score: {
      cell: (page) =>
        page.editorialScore === null ? (
          // Page de contact, légale ou utilitaire : exclue de la note éditoriale
          <span className="inline-flex rounded-full border border-shade-44 px-3 py-1 text-xs font-semibold text-muted-foreground">Non notée</span>
        ) : (
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
              page.editorialScore >= 80 ? 'bg-[#12b10f] text-white' : page.editorialScore >= 60 ? 'bg-primary text-primary-foreground' : 'bg-[#ef4444] text-white'
            }`}
          >
            {page.editorialScore}/100
          </span>
        ),
    },
    intent: { cellClassName: 'text-sm font-semibold text-foreground', cell: (page) => `${page.intentMatchScore}/20` },
    coverage: { cellClassName: 'text-sm font-semibold text-foreground', cell: (page) => `${page.hotZonesScore}/15` },
    cannibal: {
      cell: (page) => (
        <div className="flex items-start gap-2 text-sm">
          <span
            className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
              page.cannibalizationStatus === 'none' ? 'bg-[#12b10f]' : page.cannibalizationStatus === 'partial' ? 'bg-[#eab308]' : 'bg-[#ef4444]'
            }`}
          />
          <span className="min-w-0 text-foreground">
            {page.cannibalizationStatus === 'none' ? (
              'Aucune'
            ) : (
              <>
                {page.cannibalizationStatus === 'partial' ? 'Recoupement partiel avec ' : 'Conflit avec '}
                <span className="font-mono text-xs">{page.cannibalizationTarget}</span>
                {page.cannibalizationQuery && (
                  <span className="block text-xs text-muted-foreground">Requête commune : « {page.cannibalizationQuery} »</span>
                )}
                <span className="block text-xs text-muted-foreground">Estimation IA</span>
              </>
            )}
          </span>
        </div>
      ),
    },
    actions: {
      cell: (page) => (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => openInspection(page.id, 'editorial')}
            title="Inspecter le contenu de la page"
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
            <ExternalLink className="size-5" />
          </a>
        </div>
      ),
    },
  }
  const columns: ColumnSpec<PillarPage>[] = [...EDITORIAL_COLUMNS.map((column) => ({ ...column, ...columnCells[column.id] })), ...metricColumns]

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

        {/* Pages piliers : tableau personnalisable (colonnes, métriques, largeurs, densité) */}
        <div className="glass-card rounded-2xl border p-4 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Cochez des pages (glisser sur les cases, Maj + clic pour une plage) : les actions s’affichent en bas. Glissez
              un en-tête pour déplacer sa colonne ; « Colonnes » ajoute n’importe quelle métrique.
            </p>
            <TableLayoutToolbar api={tableLayout} columns={tableColumns} />
          </div>
          <CustomizableTable
            api={tableLayout}
            columns={columns}
            rows={filteredPillars}
            rowKey={(page) => page.id}
            rowSelected={(page) => selected.includes(page.id)}
            rowActive={(page) => page.id === activeId}
            onRowClick={(page) => openInspection(page.id, 'editorial')}
            rowClassName={(page) => `transition-colors hover:bg-shade-33/40 ${selected.includes(page.id) ? 'bg-tint-yellow-4/30' : ''}`}
            ariaLabel="Pages piliers"
            empty={
              <p className="py-10 text-center text-sm text-muted-foreground">
                Aucune page pilier analysée. Sélectionnez vos piliers dans Subpages.
              </p>
            }
          />
          <div className="mt-4">
            <TableLayoutFooter api={tableLayout} />
          </div>
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
      <SelectionBar
        count={selected.length}
        noun={['page sélectionnée', 'pages sélectionnées']}
        onClear={() => selection.setSelected([])}
        toast={toast}
        confirm={confirm}
        onCancelConfirm={() => setConfirm(null)}
        actions={[
          {
            id: 'reanalyze',
            label: progressLabel('reanalyze', 'Ré-analyser'),
            icon: <RefreshCw className="size-4" aria-hidden="true" />,
            busy: progress?.id === 'reanalyze',
            disabled: busy || !auditDbId,
            title: 'Nouvelle analyse IA complète de chaque page (mots-clés, tri, notation)',
            onClick: () =>
              setConfirm({
                text: `Ré-analyser ${selected.length} page${selected.length > 1 ? 's' : ''} : au moins ${selected.length} appel${selected.length > 1 ? 's' : ''} à l’IA, environ une minute par page`,
                confirmLabel: 'Ré-analyser',
                onConfirm: () =>
                  void runEach('reanalyze', selected, (id) => post(`/api/audits/${auditDbId}/pages/${id}/editorial`, { force: true }), 'Pages ré-analysées'),
              }),
          },
          {
            id: 'rewrite',
            label: progressLabel('rewrite', 'Proposer une réécriture'),
            icon: <PenLine className="size-4" aria-hidden="true" />,
            busy: progress?.id === 'rewrite',
            disabled: busy || !auditDbId,
            title: 'Title, méta, H1 et sous-titres rédigés avec les requêtes notées ; les réécritures à jour ne sont pas refaites',
            onClick: () =>
              rewriteNeeded.length === 0
                ? setToast({ text: 'Les réécritures de ces pages sont déjà à jour' })
                : setConfirm({
                    text: `${rewriteNeeded.length} réécriture${rewriteNeeded.length > 1 ? 's' : ''} à rédiger : ${rewriteNeeded.length} appel${rewriteNeeded.length > 1 ? 's' : ''} à l’IA${
                      rewriteNeeded.length < selected.length ? ` (${selected.length - rewriteNeeded.length} déjà à jour)` : ''
                    }`,
                    confirmLabel: 'Rédiger',
                    onConfirm: () =>
                      void runEach('rewrite', rewriteNeeded, (id) => post(`/api/audits/${auditDbId}/pages/${id}/rewrite`, { force: false }), 'Réécritures proposées'),
                  }),
          },
          {
            id: 'google',
            label: 'Mesurer dans Google',
            icon: <Target className="size-4" aria-hidden="true" />,
            title: 'Ouvre Positionnement avec ces pages cochées',
            disabled: busy,
            onClick: () => router.push(`/projets/${projectId}/positionnement?pages=${selected.join(',')}`),
          },
          ...bulk.actionsFor(selected),
          {
            id: 'remove',
            label: 'Retirer des piliers',
            icon: <Trash2 className="size-4" aria-hidden="true" />,
            disabled: busy || keptPillars.length === 0,
            title: keptPillars.length === 0 ? 'Gardez au moins une page stratégique' : 'Ces pages ne sont plus des pages stratégiques',
            onClick: () =>
              setConfirm({
                text: `Retirer ${selected.length} page${selected.length > 1 ? 's' : ''} des pages stratégiques : notes recalculées, une relecture IA de la cohérence du site`,
                confirmLabel: 'Retirer',
                onConfirm: async () => {
                  setConfirm(null)
                  setProgress({ id: 'remove', done: 0, total: 1 })
                  const ok = await savePillars(keptPillars, {})
                  setProgress(null)
                  selection.setSelected([])
                  setToast({ text: ok ? `${pillarIds.length - keptPillars.length} page${pillarIds.length - keptPillars.length > 1 ? 's' : ''} retirée${pillarIds.length - keptPillars.length > 1 ? 's' : ''} des pages stratégiques` : 'Retrait impossible : réessayez' })
                },
              }),
          },
        ]}
      />

      {bulk.sheets}

      <PageInspectionSheet />
    </div>
  )
}
