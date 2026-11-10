'use client'

import { useEffect, useRef, useState } from 'react'
import {
  X,
  Bot,
  Check,
  ChevronUp,
  Link2,
  ExternalLink,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  Sparkles,
  Printer,
} from 'lucide-react'
import { PagePrintSheet } from './page-print-sheet'
import { SerpInsights } from './serp-insights'
import { InspectionEssentials } from './inspection-essentials'
import { scoreTone } from '@/lib/score-tone'
import { describePagePosition } from '@/lib/serp-labels'
import { EditorialSearchPanel, type EditorialPart } from './editorial-search-panel'
import { InspectionItemRow } from './inspection-item-row'
import { PriorityList } from './priority-list'
import { EditorialBlock, EditorialNote } from './editorial-block'
import { SchemaSnippetBlock } from './schema-snippet-block'
import { MIN_PANEL_WIDTH, useInspection, type InspectionTab } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'
import { GEO_ENABLED } from '@/core/domain/features'

/** Note d'un pilier en une ligne : chiffre, niveau écrit, points réellement mesurés */
function PillarHeader({ label, score, coverage }: { label: string; score: number | null; coverage?: { measured: number; total: number } }) {
  // Page non notée (contact, légale, utilitaire) : pas de note éditoriale
  if (score === null) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-shade-33 bg-shade-1e px-4 py-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-lg font-bold text-foreground">Non notée</span>
        <span className="text-xs text-muted-foreground">
          Page de contact, légale ou utilitaire : exclue de la note éditoriale du site. Les constats restent affichés.
        </span>
      </div>
    )
  }
  const tone = scoreTone(score)
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-shade-33 bg-shade-1e px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-extrabold tabular-nums" style={{ color: tone.textColor }}>
        {score}
        <span className="text-sm font-normal text-muted-foreground">/100</span>
      </span>
      <span className="text-sm font-semibold" style={{ color: tone.textColor }}>
        {tone.label}
      </span>
      {coverage && coverage.measured < coverage.total && (
        <span className="text-xs text-muted-foreground">
          calculée sur {coverage.measured} des {coverage.total} points (critères non mesurables retirés)
        </span>
      )}
    </div>
  )
}

/**
 * Fiche d'une page : panneau collé à droite, côte à côte avec la liste (écran large ; le contenu lui laisse la
 * place), sans voile : la liste reste lisible et cliquable. En-tête compact (deux lignes et les onglets) : titre,
 * chemin, état, position dans la liste ; copier le lien, PDF, ↑ ↓ pour la page précédente ou suivante (touches J / K),
 * fermer (Échap). Onglet Contenu en trois vues : Notes, Mots-clés, Réécriture. Bord gauche à tirer pour la largeur.
 * Petit écran : la fiche couvre la page, sur un voile.
 */
export function PageInspectionSheet() {
  const { isOpen, pageId, tab, section, closeInspection, setTab, width, setWidth, navigation, step, setPanelPresent } = useInspection()
  const { audit, state, getInspection, auditDbId, refreshAudit } = useAudit()

  // La fiche est affichée par cet écran : le contenu lui laisse la place (retirée à la fermeture ou au changement d'écran)
  const visible = Boolean(isOpen && pageId && state === 'SUCCESS' && audit)
  useEffect(() => {
    if (!visible) return
    setPanelPresent(true)
    return () => setPanelPresent(false)
  }, [visible, setPanelPresent])

  // Fiche imprimable montée seulement le temps de l'impression (sinon elle serait imprimée avec le rapport d'audit)
  const [printing, setPrinting] = useState(false)
  const [copied, setCopied] = useState(false)
  // Vue de l'onglet Contenu, gardée d'une page à l'autre (↑ ↓, J / K)
  const [contentView, setContentView] = useState<EditorialPart>('summary')
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])
  // Largeur du panneau, réglable par la poignée de gauche (souris ou flèches du clavier) et mémorisée dans le navigateur
  const resize = (next: number) => setWidth(next)
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const move = (e: PointerEvent) => resize(window.innerWidth - e.clientX - 12)
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const previousTitle = useRef('')
  useEffect(() => {
    if (!printing) return
    const timer = window.setTimeout(() => {
      window.print()
      document.title = previousTitle.current
      setPrinting(false)
    }, 50)
    return () => window.clearTimeout(timer)
  }, [printing])

  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({
    '0': true,
    '1': true,
    '2': false,
    '3': false,
  })

  // Ouverture ciblée : n'ouvre que l'accordéon demandé par ?section= et le fait défiler à l'écran
  useEffect(() => {
    if (!isOpen || section === null) return
    setOpenAccordions({ [String(section)]: true })
    setContentView('summary')
    const timer = window.setTimeout(() => {
      document.getElementById(`inspection-acc-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [isOpen, pageId, tab, section])

  if (!isOpen || !pageId || state !== 'SUCCESS' || !audit) return null

  // Recherche dans les sous-pages réelles
  const subpage = audit.subpages.find((p) => p.id === pageId)
  const isPillar = Boolean(subpage?.isPillar)
  const inspection = getInspection(pageId)

  // Panneau collé à droite (écran large), plein écran sur un voile sinon
  const PANEL =
    'fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-hidden border-l glass-panel text-foreground animate-in slide-in-from-right duration-300 lg:inset-y-3 lg:right-3 lg:w-[var(--panel-width)] lg:rounded-[28px] lg:border lg:shadow-[0_24px_60px_-24px_rgb(0_0_0/0.55)]'
  const panelStyle = { '--panel-width': `${width}px` } as React.CSSProperties

  if (!inspection) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" onClick={closeInspection} />
        <aside aria-label="Fiche de la page" className={`${PANEL} items-center justify-center gap-4 p-8 text-center`} style={panelStyle}>
          <p className="text-sm text-muted-foreground">Aucune donnée d’inspection pour cette page.</p>
          <button
            type="button"
            onClick={closeInspection}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-[#e0d100]"
          >
            Fermer
          </button>
        </aside>
      </>
    )
  }

  // Position dans la liste affichée (↑ ↓, J / K) et lien direct vers la fiche
  const index = navigation.indexOf(pageId)
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé) : l'adresse reste dans la barre du navigateur
    }
  }

  // Export PDF : la boîte de dialogue d'impression native utilise le titre du document comme nom de fichier
  const handleExportPdf = () => {
    previousTitle.current = document.title
    document.title = `Fiche ${subpage?.path ?? inspection.url} - ${audit.domain}`
    setPrinting(true)
  }

  // Depuis la liste des points à traiter : ouvre le bloc détaillé concerné et l'amène à l'écran
  const goToSection = (index: number) => {
    setContentView('summary')
    setOpenAccordions((prev) => ({ ...prev, [String(index)]: true }))
    window.setTimeout(() => {
      document.getElementById(`inspection-acc-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  const toggleAccordion = (key: string) => {
    setOpenAccordions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <>
      {printing && <PagePrintSheet audit={audit} inspection={inspection} isPillar={isPillar} />}

      {/* Petit écran : la fiche couvre la page, sur un voile qui la ferme */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" onClick={closeInspection} />

      <aside aria-label="Fiche de la page" className={PANEL} style={panelStyle}>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Largeur de la fiche : flèches gauche et droite pour la changer"
          aria-valuenow={width}
          aria-valuemin={MIN_PANEL_WIDTH}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') resize(width + 40)
            if (event.key === 'ArrowRight') resize(width - 40)
          }}
          className="absolute inset-y-6 left-0 z-20 hidden w-1.5 cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-primary/50 focus-visible:bg-primary/60 focus-visible:outline-none lg:block"
        />
        {/* En-tête compact : titre et actions, puis chemin et état, puis onglets (le contenu garde la place) */}
        <div className="flex flex-col border-b border-shade-33 bg-inset px-5 pt-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-lg leading-snug font-bold tracking-tight text-foreground" title={subpage?.title || inspection.title}>
                {subpage?.title || inspection.title}
              </h2>
              <p className="mt-2 flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
                <a
                  href={inspection.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${inspection.url} (nouvel onglet)`}
                  className="inline-flex min-w-0 items-center gap-1 font-mono transition-colors hover:text-primary-ink"
                >
                  <span className="truncate">{subpage?.path ?? inspection.url}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
                <span aria-hidden="true">·</span>
                <span className={`inline-flex shrink-0 items-center gap-1 font-semibold ${inspection.httpStatus >= 400 ? 'text-red-soft' : 'text-green-soft'}`}>
                  <span className={`size-1.5 rounded-full ${inspection.httpStatus >= 400 ? 'bg-[#ef4444]' : 'bg-[#12b10f]'}`} aria-hidden="true" />
                  {inspection.httpStatus >= 400 ? `Erreur ${inspection.httpStatus}` : inspection.httpStatus}
                </span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">{inspection.indexable ? 'Indexable' : 'Exclue (noindex)'}</span>
                {index >= 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0 tabular-nums" title="Position dans la liste">
                      {index + 1} / {navigation.length}
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="-mr-1 flex shrink-0 items-center gap-0.5">
              {copied && (
                <span role="status" className="mr-1 text-xs font-semibold text-green-soft">
                  Lien copié
                </span>
              )}
              <button type="button" onClick={copyLink} aria-label="Copier le lien de la fiche" title="Copier le lien de la fiche" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-shade-2b hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30">
                {copied ? <Check className="size-4 text-green-soft" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}
              </button>
              <button type="button" onClick={handleExportPdf} aria-label="Exporter la fiche en PDF" title="Exporter la fiche en PDF" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-shade-2b hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30">
                <Printer className="size-4" aria-hidden="true" />
              </button>
              <span className="mx-0.5 h-4 w-px bg-shade-44" aria-hidden="true" />
              <button type="button" onClick={() => step(-1)} disabled={index <= 0} aria-label="Page précédente (K)" title="Page précédente (K)" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-shade-2b hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30">
                <ChevronUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={index < 0 || index >= navigation.length - 1}
                aria-label="Page suivante (J)"
                title="Page suivante (J)"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-shade-2b hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={closeInspection} aria-label="Fermer la fiche (Échap)" title="Fermer (Échap)" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-shade-2b hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Onglets sur une ligne (défilent si la fiche est étroite) */}
          <div
            role="tablist"
            aria-label="Rubriques de la page"
            className="mt-4 flex items-end gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {(
              [
                { key: 'essentials', label: 'L’essentiel', badge: null },
                { key: 'editorial', label: 'Contenu', badge: isPillar && !audit.isLocked ? `${inspection.editorial.score ?? '—'}` : null },
                { key: 'tech', label: 'Technique', badge: `${inspection.tech.score}` },
                // GEO mis de côté (GEO_ENABLED) : onglet masqué
                ...(GEO_ENABLED
                  ? [{ key: 'geo' as const, label: 'Moteurs IA', badge: isPillar && !audit.isLocked ? `${inspection.geo.score}` : null }]
                  : []),
                {
                  key: 'serp',
                  label: 'Positionnement',
                  badge: subpage?.serp?.status === 'DONE' ? describePagePosition(subpage.serp).badge : null,
                },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
                className={`relative shrink-0 pb-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  tab === item.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
                {item.badge && (
                  <span className="ml-1 rounded-full bg-shade-3a px-1.5 py-px text-[11px] font-semibold text-foreground tabular-nums">{item.badge}</span>
                )}
                {tab === item.key && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto p-5">
          {/* If not a pillar page and user accesses editorial or geo */}
          {(!isPillar || audit.isLocked) && (tab === 'editorial' || tab === 'geo') ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-shade-2a text-primary-ink mb-4">
                <Lock className="size-8" />
              </div>
              <h3 className="text-xl font-bold text-foreground">
                {audit.isLocked ? 'Analyse sémantique verrouillée' : 'Page non sélectionnée comme Page Pilier'}
              </h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                {audit.isLocked
                  ? 'Sélectionnez des pages piliers dans l’onglet Sous-pages pour lancer l’analyse sémantique.'
                  : 'L’analyse IA est réservée aux pages piliers sélectionnées.'}
              </p>
              <button
                type="button"
                onClick={() => setTab('tech')}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-[#e0d100]"
              >
                Consulter l’audit Technique & Meta
              </button>
            </div>
          ) : tab === 'essentials' ? (
            <InspectionEssentials
              inspection={inspection}
              subpage={subpage}
              aiAvailable={isPillar && !audit.isLocked && inspection.httpStatus < 400 && inspection.indexable}
              onOpen={(target, targetSection) => {
                setTab(target)
                if (target === 'editorial') setContentView('summary')
                if (targetSection !== undefined) goToSection(targetSection)
              }}
            />
          ) : tab === 'serp' ? (
            /* Résultats Google de la page, interprétés */
            subpage ? (
              <SerpInsights page={subpage} domain={audit.domain} auditDbId={auditDbId} onRefresh={refreshAudit} />
            ) : null
          ) : tab === 'tech' ? (
            /* TAB 1: TECHNIQUE & META */
            <>
              <PillarHeader label="Technique" score={inspection.tech.score} coverage={inspection.tech.coverage} />

              {/* Priorités (To-Do) */}
              <div className="rounded-2xl border border-line-yellow bg-tint-yellow p-4 text-sm">
                <h4 className="font-semibold text-foreground mb-2">À corriger</h4>
                <PriorityList items={inspection.tech.priorities} onGo={goToSection} />
              </div>

              {/* Blocs : ceux qui ont un point à revoir d'abord ; les blocs sans problème tiennent sur une ligne */}
              <div className="space-y-2.5">
                {(() => {
                  const fine = inspection.tech.accordions
                    .map((acc, index) => ({ acc, index }))
                    .filter(({ acc, index }) => !acc.items.some((item) => item.status === 'warning' || item.status === 'error') && !openAccordions[String(index)])
                  return fine.length > 0 ? (
                    <p className="flex flex-wrap items-center gap-1.5 rounded-xl border border-shade-33 bg-shade-1e px-4 py-3 text-xs text-muted-foreground">
                      <span className="font-semibold text-green-soft">Ce qui va bien :</span>
                      {fine.map(({ acc, index }) => (
                        <button
                          key={acc.title}
                          type="button"
                          onClick={() => toggleAccordion(String(index))}
                          className="rounded-md border border-shade-44 px-2 py-0.5 hover:border-primary hover:text-foreground"
                        >
                          {acc.title}
                        </button>
                      ))}
                    </p>
                  ) : null
                })()}
                {inspection.tech.accordions.map((acc, index) => {
                  const hasIssue = acc.items.some((item) => item.status === 'warning' || item.status === 'error')
                  if (!hasIssue && !openAccordions[String(index)]) return null
                  const isOpen = !!openAccordions[String(index)]
                  return (
                    <div key={acc.title} id={`inspection-acc-${index}`} className="rounded-xl border border-shade-33 bg-shade-1e overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleAccordion(String(index))}
                        className="flex w-full items-center justify-between p-4 text-left font-semibold text-foreground hover:bg-shade-25 transition-colors"
                      >
                        <span>
                          {acc.title} ({acc.scoreText})
                        </span>
                        <ChevronDown
                          className={`size-4 text-muted-foreground transition-transform ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      {isOpen && (
                        <div className="border-t border-shade-33 p-4 space-y-2.5 text-xs sm:text-sm bg-shade-19">
                          {acc.items.map((item, i) => (
                            <InspectionItemRow key={i} item={item} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : tab === 'editorial' ? (
            /* Contenu : trois vues (notes, mots-clés et volumes, réécriture) au lieu d'une longue page */
            <>
              <div
                role="tablist"
                aria-label="Parties du contenu"
                className="sticky -top-5 z-10 -mx-5 -mt-5 flex gap-1.5 overflow-x-auto border-b border-shade-33 bg-card px-5 py-3 [scrollbar-width:none]"
              >
                {(
                  [
                    { key: 'summary', label: 'Notes', badge: inspection.editorial.score === null ? 'non notée' : `${inspection.editorial.score}/100` },
                    {
                      key: 'keywords',
                      label: 'Mots-clés',
                      badge: inspection.editorial.querySet?.length
                        ? `${inspection.editorial.querySet.length} notée${inspection.editorial.querySet.length > 1 ? 's' : ''}`
                        : null,
                    },
                    {
                      key: 'rewrite',
                      label: 'Réécriture',
                      badge: inspection.editorial.rewrite ? (inspection.editorial.rewrite.outdated ? 'à refaire' : 'prête') : null,
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={contentView === item.key}
                    onClick={() => setContentView(item.key)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                      contentView === item.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-shade-2b hover:text-foreground'
                    }`}
                  >
                    {item.label}
                    {item.badge && (
                      <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${contentView === item.key ? 'bg-black/15' : 'bg-shade-33'}`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {contentView !== 'summary' ? (
                <EditorialSearchPanel
                  key={`${pageId}-${contentView}`}
                  pageId={pageId}
                  editorial={inspection.editorial}
                  part={contentView}
                  headings={inspection.details.headings}
                  url={inspection.url}
                />
              ) : (
              <>
              <PillarHeader label="Contenu" score={inspection.editorial.score} coverage={inspection.editorial.coverage} />

              <EditorialSearchPanel key={pageId} pageId={pageId} editorial={inspection.editorial} part="summary" url={inspection.url} />

              {/* Points à traiter : ceux qui font varier le score, puis les autres */}
              <div className="rounded-2xl border border-line-yellow bg-tint-yellow p-4 text-sm">
                <h4 className="font-semibold text-foreground mb-2">À corriger</h4>
                <PriorityList items={inspection.editorial.priorities} onGo={goToSection} />
              </div>

              {(() => {
                const blocks = inspection.editorial.accordions.map((block, index) => ({ block, index }))
                const visible = blocks.filter(({ block }) => !block.hidden)
                const scoredBlocks = visible.filter(({ block }) => block.group === 'scored')
                const googleBlocks = visible.filter(({ block }) => block.group === 'google')
                const diagnostics = visible.filter(({ block }) => block.group === 'diagnostic')
                const quietDiagnostics = diagnostics.filter(
                  ({ block, index }) => (block.scoreText === 'RAS' || block.scoreText === 'Non disponible') && !openAccordions[String(index)]
                )
                const shownDiagnostics = diagnostics.filter((entry) => !quietDiagnostics.includes(entry))
                const renderBlock = ({ block, index }: (typeof blocks)[number]) => (
                  <EditorialBlock
                    key={block.title}
                    block={block}
                    index={index}
                    open={!!openAccordions[String(index)]}
                    onToggle={() => toggleAccordion(String(index))}
                  />
                )
                const renderNote = ({ block, index }: (typeof blocks)[number]) => (
                  <EditorialNote
                    key={block.title}
                    block={block}
                    index={index}
                    open={!!openAccordions[String(index)]}
                    onToggle={() => toggleAccordion(String(index))}
                  />
                )
                const eeatExcluded = blocks.some(({ block }) => block.hidden && block.group === 'scored')

                return (
                  <>
                    {scoredBlocks.length > 0 ? (
                      <section className="space-y-2.5">
                        <div>
                          <h3 className="text-base font-semibold text-foreground">Critères du score</h3>
                          <p className="text-xs text-muted-foreground">
                            Chaque critère rapporte des points sur 100.
                            {eeatExcluded && ' Auteur, date et sources ne comptent que pour un article : le score est ramené sur 100 sans ce critère.'}
                          </p>
                        </div>
                        {scoredBlocks.map(renderBlock)}
                      </section>
                    ) : (
                      <p className="rounded-xl border border-shade-33 bg-shade-1e px-4 py-3 text-xs text-muted-foreground sm:text-sm">
                        Page non notée (contact, légale ou utilitaire) : ses constats restent lisibles ci-dessous, sans effet sur la note du site.
                      </p>
                    )}

                    {googleBlocks.length > 0 && (
                      <section className="space-y-2.5">
                        <h3 className="text-base font-semibold text-foreground">Ce que montre Google</h3>
                        {googleBlocks.map(renderBlock)}
                      </section>
                    )}

                    {/* Hors note : en texte, sans pastille ni carte par constat (rien n'y retire de points) */}
                    {diagnostics.length > 0 && (
                      <section className="space-y-2">
                        <div>
                          <h3 className="text-base font-semibold text-foreground">Indications hors note</h3>
                          <p className="text-xs text-muted-foreground">À lire, sans effet sur la note : pas forcément à corriger.</p>
                        </div>
                        {shownDiagnostics.length > 0 && <div>{shownDiagnostics.map(renderNote)}</div>}
                        {quietDiagnostics.length > 0 && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            <span className="font-semibold text-green-soft">Rien à signaler : </span>
                            {quietDiagnostics.map(({ block, index }, position) => (
                              <span key={block.title}>
                                <button
                                  type="button"
                                  onClick={() => toggleAccordion(String(index))}
                                  className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                                >
                                  {block.title.replace(' (hors score)', '')}
                                  {block.scoreText === 'Non disponible' ? ' (non disponible)' : ''}
                                </button>
                                {position < quietDiagnostics.length - 1 ? ', ' : '.'}
                              </span>
                            ))}
                          </p>
                        )}
                      </section>
                    )}
                  </>
                )
              })()}
              </>
              )}
            </>
        ) : (
          /* TAB 3: GEO (IA) */
          <>
            {/* Context Banner */}
            <div className="flex items-center gap-3 rounded-xl border border-line-orange bg-tint-orange p-3.5 text-xs sm:text-sm text-foreground">
              <span className="flex size-7 items-center justify-center rounded-lg bg-chip-orange text-primary-ink shrink-0">
                <Sparkles className="size-4" />
              </span>
              <p>
                Les moteurs IA (ChatGPT, Perplexity, résumés de Google) peuvent-ils lire cette page et en citer des passages ?
              </p>
            </div>

            <PillarHeader label="Moteurs IA" score={inspection.geo.score} coverage={inspection.geo.coverage} />

            {/* Points de blocage IA (To-Do GEO) */}
            <div className="rounded-2xl border border-line-yellow bg-tint-yellow p-4 text-sm">
              <h4 className="font-semibold text-foreground mb-2">À corriger</h4>
              <PriorityList items={inspection.geo.priorities} onGo={goToSection} />
            </div>

            {/* Accordéons GEO */}
            <div className="space-y-2.5">
              {inspection.geo.accordions.map((acc, index) => {
                const isOpen = !!openAccordions[String(index)]
                return (
                  <div key={acc.title} id={`inspection-acc-${index}`} className="rounded-xl border border-shade-33 bg-shade-1e overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleAccordion(String(index))}
                      className="flex w-full items-center justify-between p-4 text-left font-semibold text-foreground hover:bg-shade-25 transition-colors"
                    >
                      <span>
                        {acc.title} ({acc.scoreText})
                      </span>
                      <ChevronDown
                        className={`size-4 text-muted-foreground transition-transform ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {isOpen && (
                      <div className="border-t border-shade-33 p-4 space-y-3 text-xs sm:text-sm bg-shade-19">
                        {/* Chain of Thought Box */}
                        <div className="rounded-lg border border-line-orange/50 bg-tint-orange/40 p-3 text-xs italic text-orange-soft leading-relaxed flex items-start gap-2.5">
                          <Bot className="size-4 shrink-0 text-orange-ink mt-0.5" />
                          <span>{acc.aiReasoning}</span>
                        </div>

                        <div className="space-y-2 pt-1">
                          {acc.items.map((item, i) => (
                            <InspectionItemRow key={i} item={item} />
                          ))}
                            {acc.schemaSnippet && <SchemaSnippetBlock snippet={acc.schemaSnippet} />}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
        </div>

      </aside>
    </>
  )
}
