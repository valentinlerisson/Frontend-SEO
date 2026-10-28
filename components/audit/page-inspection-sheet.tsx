'use client'

import { useEffect, useState } from 'react'
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
import { SemiCircleGauge } from './score-gauges'
import { PagePrintSheet } from './page-print-sheet'
import { EditorialSearchPanel } from './editorial-search-panel'
import { InspectionItemRow } from './inspection-item-row'
import { PriorityList } from './priority-list'
import { EditorialBlock } from './editorial-block'
import { SchemaSnippetBlock } from './schema-snippet-block'
import { useInspection, type InspectionTab } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'

/** Points sur lesquels le score est calculé : les critères non mesurés ou sans objet sont exclus */
function CoverageNote({ coverage }: { coverage?: { measured: number; total: number } }) {
  if (!coverage || coverage.measured >= coverage.total) return null
  return (
    <p className="mt-1 max-w-[200px] text-center text-[11px] text-muted-foreground">
      Calculé sur {coverage.measured} des {coverage.total} points : critères non mesurés ou sans objet exclus
    </p>
  )
}

export function PageInspectionSheet() {
  const { isOpen, pageId, tab, section, closeInspection, setTab } = useInspection()
  const { audit, state, getInspection } = useAudit()

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
        <div className="relative z-10 flex h-full w-full max-w-2xl flex-col items-center justify-center gap-4 glass-panel border-l p-8 text-center">
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
    const previousTitle = document.title
    document.title = `Fiche ${subpage?.path ?? inspection.url} - ${audit.domain}`
    window.print()
    document.title = previousTitle
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
      <PagePrintSheet audit={audit} inspection={inspection} isPillar={isPillar} />

      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={closeInspection} />

      <div className="relative flex h-full w-full max-w-2xl flex-col glass-panel text-foreground border-l overflow-hidden animate-in slide-in-from-right duration-300 z-10">
        {/* Header */}
        <div className="flex flex-col border-b border-shade-33 bg-inset p-5">
          <div className="flex items-center justify-between text-muted-foreground text-sm font-medium mb-1">
            <span>Page Details</span>
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
              className={`rounded-full border px-2 py-0.5 font-bold ${
                inspection.httpStatus >= 400
                  ? 'bg-[#ef4444]/20 border-[#ef4444]/40 text-[#ef4444]'
                  : 'bg-[#12b10f]/20 border-[#12b10f]/40 text-green-ink'
              }`}
            >
              HTTP {inspection.httpStatus}
            </span>
            <span className="rounded-full bg-tint-blue px-2 py-0.5 text-blue-soft">
              {inspection.indexable ? 'Index' : 'Noindex'}
            </span>
            <span className="rounded-full bg-tint-teal px-2 py-0.5 text-teal-soft">
              {inspection.follow ? 'Follow' : 'Nofollow'}
            </span>
            <span className="rounded-full bg-tint-yellow-3 px-2 py-0.5 text-yellow-soft">
              Temps de réponse ({inspection.responseTime})
            </span>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-5 flex items-center justify-between border-b border-shade-33 pt-1">
            <button
              type="button"
              onClick={() => setTab('editorial')}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                tab === 'editorial' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>SEO Éditorial</span>{' '}
              <span className="ml-1 rounded-full bg-shade-3a px-2 py-0.5 text-xs font-semibold text-foreground">
                {inspection.editorial.score}%
              </span>
              {tab === 'editorial' && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setTab('tech')}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                tab === 'tech' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>Technique & Meta</span>{' '}
              <span className="ml-1 rounded-full bg-shade-3a px-2 py-0.5 text-xs font-semibold text-foreground">
                {inspection.tech.score}%
              </span>
              {tab === 'tech' && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
            </button>

            <button
              type="button"
              onClick={() => setTab('geo')}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                tab === 'geo' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>GEO (IA)</span>{' '}
              <span className="ml-1 rounded-full bg-shade-3a px-2 py-0.5 text-xs font-semibold text-foreground">
                {inspection.geo.score}%
              </span>
              {tab === 'geo' && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
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
          ) : tab === 'tech' ? (
            /* TAB 1: TECHNIQUE & META */
            <>
              {/* Scores Block */}
              <div className="rounded-2xl border border-shade-3a bg-shade-1e p-5">
                <h3 className="text-base font-semibold text-foreground mb-3">Scores</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  <div className="md:col-span-5 flex flex-col items-center justify-center">
                    <SemiCircleGauge
                      score={inspection.tech.score}
                      size={150}
                      label={`Score Technique ${inspection.tech.score}%`}
                    />
                    <CoverageNote coverage={inspection.tech.coverage} />
                  </div>
                  <div className="md:col-span-7 space-y-2">
                    {inspection.tech.categories.map((cat) => (
                      <div key={cat.name} className="flex items-center justify-between text-xs sm:text-sm">
                        <span className="text-muted-foreground w-36 truncate">{cat.name}</span>
                        <div className="flex-1 mx-3 h-2 rounded-full bg-shade-33 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              cat.score >= 80 ? 'bg-[#d8c707]' : cat.score >= 50 ? 'bg-[#eab308]' : 'bg-[#ef4444]'
                            }`}
                            style={{ width: `${cat.score}%` }}
                          />
                        </div>
                        <span className="font-semibold text-foreground tabular-nums w-10 text-right">
                          {cat.score}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Priorités (To-Do) */}
              <div className="rounded-2xl border border-line-yellow bg-tint-yellow p-4 text-sm">
                <h4 className="font-semibold text-foreground mb-2">Points à traiter (triés par impact)</h4>
                <PriorityList items={inspection.tech.priorities} onGo={goToSection} />
              </div>

              {/* Accordéons détaillés */}
              <div className="space-y-2.5">
                {inspection.tech.accordions.map((acc, index) => {
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

              {/* Scores Block */}
              <div className="rounded-2xl border border-shade-3a bg-shade-1e p-5">
                <h3 className="text-base font-semibold text-foreground mb-3">Scores</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  <div className="md:col-span-5 flex flex-col items-center justify-center">
                    <SemiCircleGauge
                      score={inspection.editorial.score}
                      size={150}
                      label={`Score Éditorial ${inspection.editorial.score}%`}
                    />
                    <CoverageNote coverage={inspection.editorial.coverage} />
                  </div>
                  <div className="md:col-span-7 space-y-1.5">
                    {inspection.editorial.categories.map((cat) => (
                      <div key={cat.name} className="flex items-center justify-between text-xs sm:text-sm">
                        <span className="text-muted-foreground w-40 truncate">{cat.name}</span>
                        <div className="flex-1 mx-3 h-2 rounded-full bg-shade-33 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              cat.score >= 80 ? 'bg-[#d8c707]' : cat.score >= 50 ? 'bg-[#eab308]' : 'bg-[#ef4444]'
                            }`}
                            style={{ width: `${cat.score}%` }}
                          />
                        </div>
                        <span className="font-semibold text-foreground tabular-nums w-10 text-right">
                          {cat.score}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Points à traiter : ceux qui font varier le score, puis les autres */}
              <div className="rounded-2xl border border-line-yellow bg-tint-yellow p-4 text-sm">
                <h4 className="font-semibold text-foreground mb-2">Points à traiter (triés par impact)</h4>
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
                <span className="font-bold text-amber-soft">
                  Analyse GEO (Generative Engine Optimization)
                </span>{' '}
                – Évaluation de la citabilité de votre contenu par les moteurs de réponse IA (AI Overviews, Perplexity, SearchGPT).
              </p>
            </div>

            {/* Scores Block */}
            <div className="rounded-2xl border border-shade-3a bg-shade-1e p-5">
              <h3 className="text-base font-semibold text-foreground mb-3">Scores</h3>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                <div className="md:col-span-5 flex flex-col items-center justify-center">
                  <SemiCircleGauge
                    score={inspection.geo.score}
                    size={150}
                    label={`Score GEO (IA)`}
                  />
                  <CoverageNote coverage={inspection.geo.coverage} />
                </div>
                <div className="md:col-span-7 space-y-1.5">
                  {inspection.geo.categories.map((cat) => (
                    <div key={cat.name} className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="text-muted-foreground w-40 truncate">{cat.name}</span>
                      <div className="flex-1 mx-3 h-2 rounded-full bg-shade-33 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            cat.score >= 80 ? 'bg-[#d8c707]' : cat.score >= 50 ? 'bg-[#eab308]' : 'bg-[#ef4444]'
                          }`}
                          style={{ width: `${cat.score}%` }}
                        />
                      </div>
                      <span className="font-semibold text-foreground tabular-nums w-10 text-right">
                        {cat.score}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Points de blocage IA (To-Do GEO) */}
            <div className="rounded-2xl border border-line-yellow bg-tint-yellow p-4 text-sm">
              <h4 className="font-semibold text-foreground mb-2">Points de blocage IA (To-Do GEO)</h4>
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
