'use client'

import { useState } from 'react'
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
} from 'lucide-react'
import { SemiCircleGauge } from './score-gauges'
import { useInspection, type InspectionTab } from '@/components/providers/inspection-provider'
import { useAudit } from '@/components/providers/audit-provider'

export function PageInspectionSheet() {
  const { isOpen, pageId, tab, closeInspection, setTab } = useInspection()
  const { audit, getInspection } = useAudit()

  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({
    '0': true,
    '1': true,
    '2': false,
    '3': false,
  })

  if (!isOpen || !pageId) return null

  // Recherche dans les sous-pages réelles
  const subpage = audit.subpages.find((p) => p.id === pageId)
  const isPillar = Boolean(subpage?.isPillar)
  const inspection = getInspection(pageId)

  const toggleAccordion = (key: string) => {
    setOpenAccordions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in"
    >
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={closeInspection} />

      <div className="relative flex h-full w-full max-w-2xl flex-col bg-[#141414] text-foreground shadow-2xl border-l border-[#3a3a3a] overflow-hidden animate-in slide-in-from-right duration-300 z-10">
        {/* Header */}
        <div className="flex flex-col border-b border-[#333333] bg-[#1a1a1a] p-5">
          <div className="flex items-center justify-between text-muted-foreground text-sm font-medium mb-1">
            <span>Page Details</span>
            <button
              type="button"
              onClick={closeInspection}
              aria-label="Fermer le tiroir d'inspection"
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-[#2b2b2b] hover:text-white"
            >
              <X className="size-5" />
            </button>
          </div>

          <h2 className="text-xl font-bold text-white tracking-tight leading-snug">
            {subpage?.title || inspection.title}
          </h2>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <a
              href={inspection.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors font-mono"
            >
              {inspection.url}
              <ExternalLink className="size-3" />
            </a>
            <span className="rounded-full bg-[#12b10f]/20 border border-[#12b10f]/40 px-2 py-0.5 font-bold text-[#12b10f]">
              HTTP {inspection.httpStatus}
            </span>
            <span className="rounded-full bg-[#2a374a] px-2 py-0.5 text-[#93c5fd]">Index</span>
            <span className="rounded-full bg-[#1e3a3a] px-2 py-0.5 text-[#5eead4]">Follow</span>
            <span className="rounded-full bg-[#3d3215] px-2 py-0.5 text-[#fde047]">
              Temps de réponse ({inspection.responseTime})
            </span>
            <span className="rounded-full bg-[#2b2b2b] px-2 py-0.5 text-muted-foreground">...</span>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-5 flex items-center justify-between border-b border-[#333333] pt-1">
            <button
              type="button"
              onClick={() => setTab('editorial')}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                tab === 'editorial' ? 'text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>SEO Éditorial</span>{' '}
              <span className="ml-1 rounded-full bg-[#3a3a3a] px-2 py-0.5 text-xs font-semibold text-white">
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
                tab === 'tech' ? 'text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>Technique & Meta</span>{' '}
              <span className="ml-1 rounded-full bg-[#3a3a3a] px-2 py-0.5 text-xs font-semibold text-white">
                {inspection.tech.score}%
              </span>
              {tab === 'tech' && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
            </button>

            <button
              type="button"
              onClick={() => setTab('geo')}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                tab === 'geo' ? 'text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>GEO (IA)</span>{' '}
              <span className="ml-1 rounded-full bg-[#3a3a3a] px-2 py-0.5 text-xs font-semibold text-white">
                {inspection.geo.score}%
              </span>
              {tab === 'geo' && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* If not a pillar page and user accesses editorial or geo */}
          {!isPillar && (tab === 'editorial' || tab === 'geo') ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-[#2a2a2a] text-primary mb-4">
                <Lock className="size-8" />
              </div>
              <h3 className="text-xl font-bold text-white">Page non sélectionnée comme Page Pilier</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Conformément au cahier des charges et à la protection des coûts API, l'analyse IA (Claude 3.5 Sonnet) est réservée à l'échantillon des 10 à 20 pages piliers stratégiques.
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
              <div className="rounded-2xl border border-[#3a3a3a] bg-[#1e1e1e] p-5">
                <h3 className="text-base font-semibold text-white mb-3">Scores</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  <div className="md:col-span-5 flex flex-col items-center justify-center">
                    <SemiCircleGauge
                      score={inspection.tech.score}
                      size={150}
                      label={`Score Technique ${inspection.tech.score}%`}
                    />
                  </div>
                  <div className="md:col-span-7 space-y-2">
                    {inspection.tech.categories.map((cat) => (
                      <div key={cat.name} className="flex items-center justify-between text-xs sm:text-sm">
                        <span className="text-muted-foreground w-36 truncate">{cat.name}</span>
                        <div className="flex-1 mx-3 h-2 rounded-full bg-[#333333] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              cat.score >= 80 ? 'bg-[#d8c707]' : cat.score >= 50 ? 'bg-[#eab308]' : 'bg-[#ef4444]'
                            }`}
                            style={{ width: `${cat.score}%` }}
                          />
                        </div>
                        <span className="font-semibold text-white tabular-nums w-10 text-right">
                          {cat.score}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Priorités (To-Do) */}
              <div className="rounded-2xl border border-[#6b5809] bg-[#221f11] p-4 text-sm">
                <h4 className="font-semibold text-white mb-2">Priorités (To-Do)</h4>
                <div className="space-y-1.5 text-xs sm:text-sm">
                  {inspection.tech.priorities.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span
                        className={`font-bold ${
                          item.type === 'alert' ? 'text-[#ef4444]' : 'text-[#f5e400]'
                        }`}
                      >
                        {item.type === 'alert' ? 'Alerte :' : 'Optimisation :'}
                      </span>
                      <span className="text-foreground">{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accordéons détaillés */}
              <div className="space-y-2.5">
                {inspection.tech.accordions.map((acc, index) => {
                  const isOpen = !!openAccordions[String(index)]
                  return (
                    <div key={acc.title} className="rounded-xl border border-[#333333] bg-[#1e1e1e] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleAccordion(String(index))}
                        className="flex w-full items-center justify-between p-4 text-left font-semibold text-white hover:bg-[#252525] transition-colors"
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
                        <div className="border-t border-[#333333] p-4 space-y-2.5 text-xs sm:text-sm bg-[#191919]">
                          {acc.items.map((item, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                              {item.status === 'valid' ? (
                                <CheckCircle2 className="size-4 shrink-0 text-[#12b10f] mt-0.5" />
                              ) : item.status === 'warning' ? (
                                <AlertTriangle className="size-4 shrink-0 text-[#eab308] mt-0.5" />
                              ) : (
                                <XCircle className="size-4 shrink-0 text-[#ef4444] mt-0.5" />
                              )}
                              <span
                                className={
                                  item.status === 'valid'
                                    ? 'text-foreground'
                                    : item.status === 'warning'
                                    ? 'text-yellow-200/90'
                                    : 'text-red-200/90'
                                }
                              >
                                {item.text}
                              </span>
                            </div>
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
              {/* Context Banner */}
              <div className="flex items-center gap-3 rounded-xl border border-[#4338ca] bg-[#1e1b4b] p-3.5 text-xs sm:text-sm text-white">
                <span className="flex size-7 items-center justify-center rounded-lg bg-[#3730a3] text-primary shrink-0">
                  <Bot className="size-4" />
                </span>
                <p>
                  <span className="font-bold text-[#c7d2fe]">Analyse IA (Claude 3.5 Sonnet)</span>{' '}
                  <span className="text-white font-medium">"{inspection.editorial.targetKeyword}"</span>{' '}
                  <span className="text-muted-foreground text-xs">
                    {inspection.editorial.isForcedTarget ? '(Cible forcée)' : '(Auto-détecté)'}
                  </span>
                </p>
              </div>

              {/* Scores Block */}
              <div className="rounded-2xl border border-[#3a3a3a] bg-[#1e1e1e] p-5">
                <h3 className="text-base font-semibold text-white mb-3">Scores</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  <div className="md:col-span-5 flex flex-col items-center justify-center">
                    <SemiCircleGauge
                      score={inspection.editorial.score}
                      size={150}
                      label={`Score Éditorial ${inspection.editorial.score}%`}
                    />
                  </div>
                  <div className="md:col-span-7 space-y-1.5">
                    {inspection.editorial.categories.map((cat) => (
                      <div key={cat.name} className="flex items-center justify-between text-xs sm:text-sm">
                        <span className="text-muted-foreground w-40 truncate">{cat.name}</span>
                        <div className="flex-1 mx-3 h-2 rounded-full bg-[#333333] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              cat.score >= 80 ? 'bg-[#d8c707]' : cat.score >= 50 ? 'bg-[#eab308]' : 'bg-[#ef4444]'
                            }`}
                            style={{ width: `${cat.score}%` }}
                          />
                        </div>
                        <span className="font-semibold text-white tabular-nums w-10 text-right">
                          {cat.score}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recommandations critiques (To-Do de l'IA) */}
              <div className="rounded-2xl border border-[#6b5809] bg-[#221f11] p-4 text-sm">
                <h4 className="font-semibold text-white mb-2">Recommandations critiques (To-Do de l'IA)</h4>
                <div className="space-y-1.5 text-xs sm:text-sm">
                  {inspection.editorial.priorities.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span
                        className={`font-bold ${
                          item.type === 'alert' ? 'text-[#ef4444]' : 'text-[#f5e400]'
                        }`}
                      >
                        {item.type === 'alert' ? 'Alerte :' : 'Optimisation :'}
                      </span>
                      <span className="text-foreground">{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accordéons avec encart Chain of Thought Claude 3.5 */}
              <div className="space-y-2.5">
                {inspection.editorial.accordions.map((acc, index) => {
                  const isOpen = !!openAccordions[String(index)]
                  return (
                    <div key={acc.title} className="rounded-xl border border-[#333333] bg-[#1e1e1e] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleAccordion(String(index))}
                        className="flex w-full items-center justify-between p-4 text-left font-semibold text-white hover:bg-[#252525] transition-colors"
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
                        <div className="border-t border-[#333333] p-4 space-y-3 text-xs sm:text-sm bg-[#191919]">
                          {/* Chain of Thought Box */}
                          <div className="rounded-lg border border-[#3730a3]/50 bg-[#1e1b4b]/40 p-3 text-xs italic text-[#c7d2fe] leading-relaxed flex items-start gap-2.5">
                            <Bot className="size-4 shrink-0 text-[#818cf8] mt-0.5" />
                            <span>{acc.aiReasoning}</span>
                          </div>

                          <div className="space-y-2 pt-1">
                            {acc.items.map((item, i) => (
                              <div key={i} className="flex items-start gap-2.5">
                                {item.status === 'valid' ? (
                                  <CheckCircle2 className="size-4 shrink-0 text-[#12b10f] mt-0.5" />
                                ) : item.status === 'warning' ? (
                                  <AlertTriangle className="size-4 shrink-0 text-[#eab308] mt-0.5" />
                                ) : (
                                  <XCircle className="size-4 shrink-0 text-[#ef4444] mt-0.5" />
                                )}
                                <span
                                  className={
                                    item.status === 'valid'
                                      ? 'text-foreground'
                                      : item.status === 'warning'
                                      ? 'text-yellow-200/90'
                                      : 'text-red-200/90'
                                }
                              >
                                {item.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          /* TAB 3: GEO (IA) */
          <>
            {/* Context Banner */}
            <div className="flex items-center gap-3 rounded-xl border border-[#78350f] bg-[#451a03] p-3.5 text-xs sm:text-sm text-white">
              <span className="flex size-7 items-center justify-center rounded-lg bg-[#92400e] text-primary shrink-0">
                <Sparkles className="size-4" />
              </span>
              <p>
                <span className="font-bold text-[#fde68a]">
                  Analyse GEO (Generative Engine Optimization)
                </span>{' '}
                – Évaluation de la citabilité de votre contenu par les moteurs de réponse IA (AI Overviews, Perplexity, SearchGPT).
              </p>
            </div>

            {/* Scores Block */}
            <div className="rounded-2xl border border-[#3a3a3a] bg-[#1e1e1e] p-5">
              <h3 className="text-base font-semibold text-white mb-3">Scores</h3>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                <div className="md:col-span-5 flex flex-col items-center justify-center">
                  <SemiCircleGauge
                    score={inspection.geo.score}
                    size={150}
                    label={`Score GEO (IA)`}
                  />
                </div>
                <div className="md:col-span-7 space-y-1.5">
                  {inspection.geo.categories.map((cat) => (
                    <div key={cat.name} className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="text-muted-foreground w-40 truncate">{cat.name}</span>
                      <div className="flex-1 mx-3 h-2 rounded-full bg-[#333333] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            cat.score >= 80 ? 'bg-[#d8c707]' : cat.score >= 50 ? 'bg-[#eab308]' : 'bg-[#ef4444]'
                          }`}
                          style={{ width: `${cat.score}%` }}
                        />
                      </div>
                      <span className="font-semibold text-white tabular-nums w-10 text-right">
                        {cat.score}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Points de blocage IA (To-Do GEO) */}
            <div className="rounded-2xl border border-[#6b5809] bg-[#221f11] p-4 text-sm">
              <h4 className="font-semibold text-white mb-2">Points de blocage IA (To-Do GEO)</h4>
              <div className="space-y-1.5 text-xs sm:text-sm">
                {inspection.geo.priorities.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span
                      className={`font-bold ${
                        item.type === 'alert' ? 'text-[#ef4444]' : 'text-[#f5e400]'
                      }`}
                    >
                      {item.type === 'alert' ? 'Alerte :' : 'Optimisation :'}
                    </span>
                    <span className="text-foreground">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Accordéons GEO */}
            <div className="space-y-2.5">
              {inspection.geo.accordions.map((acc, index) => {
                const isOpen = !!openAccordions[String(index)]
                return (
                  <div key={acc.title} className="rounded-xl border border-[#333333] bg-[#1e1e1e] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleAccordion(String(index))}
                      className="flex w-full items-center justify-between p-4 text-left font-semibold text-white hover:bg-[#252525] transition-colors"
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
                      <div className="border-t border-[#333333] p-4 space-y-3 text-xs sm:text-sm bg-[#191919]">
                        {/* Chain of Thought Box */}
                        <div className="rounded-lg border border-[#78350f]/50 bg-[#451a03]/40 p-3 text-xs italic text-[#fed7aa] leading-relaxed flex items-start gap-2.5">
                          <Bot className="size-4 shrink-0 text-[#f59e0b] mt-0.5" />
                          <span>{acc.aiReasoning}</span>
                        </div>

                        <div className="space-y-2 pt-1">
                          {acc.items.map((item, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                              {item.status === 'valid' ? (
                                <CheckCircle2 className="size-4 shrink-0 text-[#12b10f] mt-0.5" />
                              ) : item.status === 'warning' ? (
                                <AlertTriangle className="size-4 shrink-0 text-[#eab308] mt-0.5" />
                              ) : (
                                <XCircle className="size-4 shrink-0 text-[#ef4444] mt-0.5" />
                              )}
                              <span
                                className={
                                  item.status === 'valid'
                                    ? 'text-foreground'
                                    : item.status === 'warning'
                                    ? 'text-yellow-200/90'
                                    : 'text-red-200/90'
                                }
                              >
                                {item.text}
                              </span>
                            </div>
                          ))}
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
