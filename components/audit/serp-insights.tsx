'use client'

import { useMemo, useState } from 'react'
import { Bot, ChevronDown, ExternalLink, Loader2, Target } from 'lucide-react'
import type { SubpageItem } from '@/lib/audit-data'
import type { SerpAnalysis } from '@/core/domain/types'
import { describePagePosition, peopleAlsoAsk } from '@/lib/serp-labels'
import { interpretSerp, topTenLandscape } from '@/core/domain/serp-insights'
import { PositionScale, TopTenBar } from './serp-charts'

const urlKey = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase()

function measureLabel(serp: SerpAnalysis) {
  return `« ${serp.query} »${serp.zone ? ` · ${serp.zone.city}` : ''}`
}

/**
 * Résultats Google d'une page, interprétés : lecture en quelques phrases et une priorité (règles du code, chaque
 * affirmation vient d'une mesure), avis rédigé par l'IA à la demande, trois graphiques, puis le détail replié.
 * Utilisé sous la ligne de la page dans Positionnement et dans l'onglet Positionnement du tiroir d'inspection.
 */
export function SerpInsights({
  page,
  domain,
  auditDbId,
  onRefresh,
}: {
  page: SubpageItem
  domain: string
  auditDbId: string | null
  onRefresh: () => Promise<void> | void
}) {
  const measures = useMemo(() => {
    const list = (page.serpQueries?.length ? page.serpQueries : page.serp ? [page.serp] : []).filter(
      (serp) => serp.status === 'DONE',
    )
    return [...list].sort((a, b) => Number(b === page.serp) - Number(a === page.serp))
  }, [page])
  const [selected, setSelected] = useState(0)
  const [showDetail, setShowDetail] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (measures.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune mesure Google terminée pour cette page : lancez l’analyse dans Positionnement.</p>
  }
  const serp = measures[Math.min(selected, measures.length - 1)]
  const reading = interpretSerp({ measures, main: page.serp ?? measures[0], pageUrl: page.url, ownDomain: domain, pageWords: page.wordCount })
  const top = topTenLandscape(serp.results, domain)
  const questions = peopleAlsoAsk(serp)

  const askAi = async () => {
    if (!auditDbId) return
    setAsking(true)
    setError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${page.id}/serp-opinion`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Avis indisponible')
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Lecture et priorité */}
      <section aria-label="Ce que montrent les résultats" className="rounded-xl border border-line-indigo bg-tint-indigo p-4">
        <h3 className="text-sm font-bold text-foreground">Ce que montrent les résultats</h3>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-foreground">
          {reading.sentences.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-inset p-3 text-sm font-semibold text-foreground">
          <Target className="mt-0.5 size-4 shrink-0 text-primary-ink" aria-hidden="true" />
          <span>Priorité : {reading.priority}</span>
        </p>

        <div className="mt-3 border-t border-line-indigo pt-3">
          {page.serpOpinion ? (
            <div className="text-sm">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-pale">
                <Bot className="size-3.5" aria-hidden="true" />
                Avis de l’IA ({page.serpOpinion.model}, {new Date(page.serpOpinion.createdAt).toLocaleDateString('fr-FR')})
              </p>
              <p className="mt-1 whitespace-pre-line text-foreground">{page.serpOpinion.text}</p>
              {page.serpOpinion.outdated && (
                <p className="mt-1 text-xs text-sky-soft">Des mesures ont changé depuis cet avis.</p>
              )}
            </div>
          ) : null}
          <button
            type="button"
            onClick={askAi}
            disabled={asking || !auditDbId}
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-line-indigo px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-inset disabled:opacity-50"
          >
            {asking ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Bot className="size-3.5" aria-hidden="true" />}
            {page.serpOpinion ? 'Demander un nouvel avis de l’IA' : 'Demander l’avis de l’IA'}
          </button>
          <p role="status" className="mt-1 text-xs text-muted-foreground">
            {asking ? 'Rédaction en cours, quelques secondes…' : error ? '' : 'Un appel au modèle, à partir des seules mesures ci-dessous.'}
          </p>
          {error && <p role="alert" className="text-xs text-red-soft">{error}</p>}
        </div>
      </section>

      {/* Graphiques ; min-w-0 : un texte long ne doit jamais élargir le bloc au-delà de l'écran */}
      <div className="grid min-w-0 gap-3 xl:grid-cols-[3fr_2fr] [&>*]:min-w-0">
        <PositionScale measures={measures} />
        <TopTenBar items={top} query={serp.query} />
      </div>

      {/* Mesure détaillée */}
      {measures.length > 1 && (
        <div role="tablist" aria-label="Recherche détaillée" className="flex flex-wrap gap-1.5">
          {measures.map((item, index) => (
            <button
              key={`${item.query}-${item.zone?.id ?? 'z'}`}
              type="button"
              role="tab"
              aria-selected={index === selected}
              onClick={() => setSelected(index)}
              className={`rounded-full border px-3 py-1 text-xs ${
                index === selected ? 'border-primary bg-primary/15 font-semibold text-foreground' : 'border-shade-44 text-muted-foreground hover:text-foreground'
              }`}
            >
              {measureLabel(item)} · {describePagePosition(item).badge}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowDetail((value) => !value)}
        aria-expanded={showDetail}
        className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-primary-ink hover:underline"
      >
        {showDetail ? 'Masquer le détail' : `Détail de ${measureLabel(serp)} : résultats, concurrents, questions`}
        <ChevronDown className={`size-3.5 transition-transform ${showDetail ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {showDetail && (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[3fr_2fr] [&>*]:min-w-0">
          <ol className="flex flex-col gap-1.5">
            {serp.results.map((result) => {
              const own = serp.ownUrls.some((item) => urlKey(item.url) === urlKey(result.url))
              const isPage = urlKey(result.url) === urlKey(page.url)
              return (
                <li
                  key={`${result.position}-${result.url}`}
                  className={`flex gap-3 rounded-lg border p-2.5 ${own ? 'border-primary/60 bg-primary/5' : 'border-shade-3a'}`}
                >
                  <span className="w-6 shrink-0 text-sm font-bold text-muted-foreground">{result.position}</span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-1.5 text-sm font-semibold hover:text-primary-ink"
                    >
                      <span className="truncate">{result.title}</span>
                      <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                    </a>
                    <p className="truncate text-xs text-muted-foreground">{result.domain}</p>
                    {result.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-foreground/80">{result.snippet}</p>}
                  </div>
                  {own && (
                    <span className="shrink-0 self-start rounded-md bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                      {isPage ? 'Cette page' : 'Votre site'}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
          <div className="flex flex-col gap-3 text-xs">
            {serp.competitors.length > 0 && (
              <div>
                <h4 className="text-sm font-bold text-foreground">Concurrents lus</h4>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {serp.competitors.map((competitor) => (
                    <li key={competitor.url} className="rounded-lg border border-shade-3a p-2.5">
                      <span className="font-semibold text-foreground">
                        n°{competitor.position} · {competitor.domain}
                      </span>
                      <span className="text-muted-foreground"> · {competitor.wordCount.toLocaleString('fr-FR')} mots</span>
                      {competitor.headings.length > 0 && (
                        <p className="mt-1 text-muted-foreground">{competitor.headings.slice(0, 6).join(' · ')}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {questions.length > 0 && (
              <div>
                <h4 className="text-sm font-bold text-foreground">Questions des internautes</h4>
                <ul className="mt-1 list-disc pl-4 text-foreground">
                  {questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
