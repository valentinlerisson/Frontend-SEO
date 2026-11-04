'use client'

import { useEffect, useRef, useState } from 'react'
import {
  X,
  Bot,
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
import { EditorialSearchPanel } from './editorial-search-panel'
import { InspectionItemRow } from './inspection-item-row'
import { PriorityList } from './priority-list'
import { EditorialBlock } from './editorial-block'
import { SchemaSnippetBlock } from './schema-snippet-block'
import { useInspection, type InspectionTab } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'

/** Note d'un pilier en une ligne : chiffre, niveau écrit, points réellement mesurés */
function PillarHeader({ label, score, coverage }: { label: string; score: number; coverage?: { measured: number; total: number } }) {
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

const DRAWER_WIDTH_KEY = 'auditly:inspection-width'
const DEFAULT_DRAWER_WIDTH = 820
const MIN_DRAWER_WIDTH = 480

export function PageInspectionSheet() {
  const { isOpen, pageId, tab, section, closeInspection, setTab } = useInspection()
  const { audit, state, getInspection, auditDbId, refreshAudit } = useAudit()

  // Fiche imprimable montée seulement le temps de l'impression (sinon elle serait imprimée avec le rapport d'audit)
  const [printing, setPrinting] = useState(false)
  // Largeur du tiroir, réglable par la poignée de gauche (souris ou flèches du clavier) et mémorisée dans le navigateur
  const [width, setWidth] = useState(DEFAULT_DRAWER_WIDTH)
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(DRAWER_WIDTH_KEY))
      if (saved >= MIN_DRAWER_WIDTH) setWidth(saved)
    } catch {
      // stockage indisponible : largeur par défaut
    }
  }, [])
  const resize = (next: number) => {
    const clamped = Math.round(Math.min(window.innerWidth * 0.96, Math.max(MIN_DRAWER_WIDTH, next)))
    setWidth(clamped)
    try {
      window.localStorage.setItem(DRAWER_WIDTH_KEY, String(clamped))
    } catch {
      // stockage indisponible : largeur gardée pour la session
    }
  }
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const move = (e: PointerEvent) => resize(window.innerWidth - e.clientX)
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

  if (!inspection) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      >
        <div className="absolute inset-0" onClick={closeInspection} />
        <div className="relative z-10 flex h-full w-full max-w-4xl flex-col items-center justify-center gap-4 glass-panel border-l p-8 text-center">
          <p className="text-sm text-muted-foreground">Aucune donnée d’inspection pour cette page.</p>
          <button
            type="button"
            onClick={closeInspection}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-[#e0d100]"
          >
            Fermer
          </button>
        </div>
      </div>
    )
  }

  // Export PDF : la boîte de dialogue d'impression native utilise le titre du document comme nom de fichier
  const handleExportPdf = () => {
    previousTitle.current = document.title
    document.title = `Fiche ${subpage?.path ?? inspection.url} - ${audit.domain}`
    setPrinting(true)
  }

  // Depuis la liste des points à traiter : ouvre le bloc détaillé concerné et l'amène à l'écran
  const goToSection = (index: number) => {
    setOpenAccordions((prev) => ({ ...prev, [String(index)]: true }))
    window.setTimeout(() => {
      document.getElementById(`inspection-acc-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  const toggleAccordion = (key: string) => {
    setOpenAccordions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm transition-opacity animate-in fade-in"
    >
      {printing && <PagePrintSheet audit={audit} inspection={inspection} isPillar={isPillar} />}

      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={closeInspection} />

      <div
        className="relative flex h-full max-w-full flex-col glass-panel text-foreground border-l overflow-hidden animate-in slide-in-from-right duration-300 z-10"
        style={{ width }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Largeur du tiroir : flèches gauche et droite pour la changer"
          aria-valuenow={width}
          aria-valuemin={MIN_DRAWER_WIDTH}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') resize(width + 40)
            if (event.key === 'ArrowRight') resize(width - 40)
          }}
          className="absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
        />
        {/* Header */}
        <div className="flex flex-col border-b border-shade-33 bg-inset p-5">
          <div className="flex items-center justify-between text-muted-foreground text-sm font-medium mb-1">
            <span>Fiche de la page</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportPdf}
                title="Exporter la fiche de cette page en PDF"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#f5e400] px-3 py-1 text-xs font-semibold text-primary-ink transition-colors hover:bg-[#f5e400] hover:text-black"
              >
                <Printer className="size-3.5" aria-hidden="true" />
                Exporter en PDF
              </button>
            <button
              type="button"
              onClick={closeInspection}
              aria-label="Fermer le tiroir d'inspection"
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-shade-2b hover:text-foreground"
            >
              <X className="size-5" />
            </button>
            </div>
          </div>

          <h2 className="text-xl font-bold text-foreground tracking-tight leading-snug">
            {subpage?.title || inspection.title}
          </h2>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <a
              href={inspection.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary-ink transition-colors font-mono"
            >
              {inspection.url}
              <ExternalLink className="size-3" />
            </a>
            <span
              className={`rounded-full border px-2 py-0.5 font-semibold ${
                inspection.httpStatus >= 400
                  ? 'border-[#ef4444]/40 bg-[#ef4444]/15 text-red-soft'
                  : 'border-[#12b10f]/40 bg-[#12b10f]/15 text-green-soft'
              }`}
            >
              {inspection.httpStatus >= 400 ? `En erreur (${inspection.httpStatus})` : 'Page accessible'}
            </span>
            <span className="rounded-full border border-shade-44 px-2 py-0.5 text-muted-foreground">
              {inspection.indexable ? 'Visible dans Google' : 'Exclue de Google (noindex)'}
            </span>
          </div>

          {/* Onglets : l'essentiel d'abord, libellés en clair */}
          <div role="tablist" aria-label="Rubriques de la page" className="mt-5 flex flex-wrap items-end gap-x-5 gap-y-2 border-b border-shade-33 pt-1">
            {(
              [
                { key: 'essentials', label: 'L’essentiel', badge: null },
                { key: 'editorial', label: 'Contenu', badge: isPillar && !audit.isLocked ? `${inspection.editorial.score}/100` : null },
                { key: 'tech', label: 'Technique', badge: `${inspection.tech.score}/100` },
                { key: 'geo', label: 'Moteurs IA', badge: isPillar && !audit.isLocked ? `${inspection.geo.score}/100` : null },
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
                className={`relative pb-3 text-sm font-medium transition-colors ${
                  tab === item.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
                {item.badge && (
                  <span className="ml-1.5 rounded-full bg-shade-3a px-2 py-0.5 text-xs font-semibold text-foreground">{item.badge}</span>
                )}
                {tab === item.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
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
                {audit.isLocked ? 'Analyse sémantique et GEO verrouillées' : 'Page non sélectionnée comme Page Pilier'}
              </h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                {audit.isLocked
                  ? 'Sélectionnez des pages piliers dans l’onglet Sous-pages pour lancer l’analyse sémantique et GEO.'
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
            /* TAB 2: SEO ÉDITORIAL */
            <>
              <EditorialSearchPanel key={pageId} pageId={pageId} editorial={inspection.editorial} />

              <PillarHeader label="Contenu" score={inspection.editorial.score} coverage={inspection.editorial.coverage} />

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
                const eeatExcluded = blocks.some(({ block }) => block.hidden && block.group === 'scored')

                return (
                  <>
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

                    {googleBlocks.length > 0 && (
                      <section className="space-y-2.5">
                        <h3 className="text-base font-semibold text-foreground">Ce que montre Google</h3>
                        {googleBlocks.map(renderBlock)}
                      </section>
                    )}

                    {diagnostics.length > 0 && (
                      <section className="space-y-2.5">
                        <div>
                          <h3 className="text-base font-semibold text-foreground">Recommandations hors score</h3>
                          <p className="text-xs text-muted-foreground">Utiles au lecteur, sans effet sur la note.</p>
                        </div>
                        {shownDiagnostics.map(renderBlock)}
                        {quietDiagnostics.length > 0 && (
                          <p className="flex flex-wrap items-center gap-1.5 rounded-xl border border-shade-33 bg-shade-1e px-4 py-3 text-xs text-muted-foreground">
                            <span className="font-semibold text-green-soft">Rien à signaler :</span>
                            {quietDiagnostics.map(({ block, index }) => (
                              <button
                                key={block.title}
                                type="button"
                                onClick={() => toggleAccordion(String(index))}
                                className="rounded-md border border-shade-44 px-2 py-0.5 hover:border-primary hover:text-foreground"
                              >
                                {block.title.replace(' (hors score)', '')}
                                {block.scoreText === 'Non disponible' ? ' (non disponible)' : ''}
                              </button>
                            ))}
                          </p>
                        )}
                      </section>
                    )}
                  </>
                )
              })()}
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
      </div>
    </div>
  )
}
