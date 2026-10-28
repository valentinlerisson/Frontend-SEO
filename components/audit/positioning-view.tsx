'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ExternalLink, Loader2, Search, ShieldAlert } from 'lucide-react'
import { AuditHeader } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { AuditStateGate } from './audit-state-gate'
import { useAudit } from '@/components/providers/audit-provider'
import { useInspection } from '@/components/providers/inspection-provider'
import type { SubpageItem } from '@/lib/audit-data'
import { describePagePosition, peopleAlsoAsk } from '@/lib/serp-labels'
import { normalizeText } from '@/core/domain/scoring/autocomplete-relevance'

/** Pages mesurables par lancement (limite de l'API) */
const MAX_PER_RUN = 20

/** Position la plus utile d'un relevé : la page, sinon son lien annexe, sinon le site */
function historyRank(entry: NonNullable<SubpageItem['serpHistory']>[number]) {
  return entry.pagePosition ?? entry.sitelinkOf ?? null
}

function PositionBadge({ serp, history }: { serp?: SubpageItem['serp']; history?: SubpageItem['serpHistory'] }) {
  if (!serp || serp.status !== 'DONE') return <span className="text-muted-foreground">—</span>
  const { rank, badge, detail } = describePagePosition(serp)
  // Relevé précédent sur la même requête (le dernier de l'historique est la mesure affichée)
  const previous = (history ?? []).filter((entry) => entry.query === serp.query && entry.date !== serp.fetchedAt).at(-1)
  const tone =
    rank === null
      ? 'bg-[#ef4444] text-white'
      : rank <= 3
        ? 'bg-[#12b10f] text-white'
        : rank <= 10
          ? 'bg-primary text-primary-foreground'
          : 'bg-[#ef4444] text-white'
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${tone}`}>{badge}</span>
      <span className="max-w-[220px] text-[11px] text-muted-foreground">{detail}</span>
      {serp.retest && (
        <span
          title="La position s'écartait de plus de 3 rangs du relevé précédent : une seconde mesure a été faite et retenue."
          className="text-[11px] text-muted-foreground"
        >
          Re-mesurée (1re mesure : {serp.retest.firstRank !== null ? `n°${serp.retest.firstRank}` : 'absente'})
        </span>
      )}
      {serp.features?.localPack && (
        <span className="rounded-md border border-[#38bdf8]/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-soft">
          Pack local affiché
        </span>
      )}
      {peopleAlsoAsk(serp).length > 0 && (
        <span title={peopleAlsoAsk(serp).join(' · ')} className="text-[11px] text-muted-foreground">
          {peopleAlsoAsk(serp).length} question(s) « Autres questions posées »
        </span>
      )}
      {previous && (
        <span className="text-[11px] text-muted-foreground">
          Avant : {historyRank(previous) !== null ? `n°${historyRank(previous)}` : 'absent'} le{' '}
          {new Date(previous.date).toLocaleDateString('fr-FR')}
        </span>
      )}
    </div>
  )
}

function StatusCell({ serp }: { serp?: SubpageItem['serp'] }) {
  if (!serp) return <span className="text-xs text-muted-foreground">Non mesuré</span>
  if (serp.status === 'RUNNING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-yellow-pale">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        En cours, résolvez un éventuel captcha dans la fenêtre Chrome
      </span>
    )
  }
  if (serp.status === 'BLOCKED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-soft">
        <ShieldAlert className="size-3.5" aria-hidden="true" />
        Captcha ou blocage : résolution manuelle requise
      </span>
    )
  }
  if (serp.status === 'ERROR') return <span className="text-xs text-red-soft">{serp.message ?? 'Échec'}</span>
  return (
    <span className="text-xs text-muted-foreground">
      {serp.fetchedAt ? `Mesuré le ${new Date(serp.fetchedAt).toLocaleDateString('fr-FR')}` : 'Mesuré'}
    </span>
  )
}

/**
 * Requêtes mesurées pour la page (requête cible puis candidates génériques), avec leur position. La requête cible
 * peut être remplacée par une autre d'un clic : elle devient alors une requête choisie et la page est ré-analysée.
 */
function QueryPositions({
  page,
  busy,
  onChoose,
}: {
  page: SubpageItem
  busy: boolean
  onChoose: (query: string) => void
}) {
  const measured = (page.serpQueries ?? []).filter((serp) => serp.query !== page.serp?.query)
  if (measured.length === 0) return null
  const suggested = (query: string) =>
    page.queryCandidates?.find(
      (candidate) =>
        normalizeText(query) === normalizeText(candidate.query) || normalizeText(query).startsWith(`${normalizeText(candidate.query)} `),
    )?.suggestedByGoogle
  const visible = measured.filter((serp) => serp.status === 'DONE' && describePagePosition(serp).rank !== null).length
  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-shade-3e pt-2">
      <span className="text-[11px] text-muted-foreground">
        Autres requêtes génériques : visible sur {visible} sur {measured.length}
      </span>
      {measured.map((serp) => {
        const position = serp.status === 'DONE' ? describePagePosition(serp) : null
        return (
          <div key={serp.query} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-foreground">« {serp.query} »</span>
            {suggested(serp.query) && (
              <span className="rounded-md border border-[#38bdf8]/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-soft">
                Suggérée par Google
              </span>
            )}
            <span className="font-semibold text-foreground">
              {serp.status === 'RUNNING'
                ? 'En cours'
                : serp.status === 'DONE'
                  ? position?.badge
                  : serp.message ?? 'Échec'}
            </span>
            {page.isPillar && serp.status === 'DONE' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose(serp.query)}
                className="text-[11px] font-semibold text-primary-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                En faire la requête cible
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function PositioningView({ projectId }: { projectId: string }) {
  const { audit, state, auditDbId, refreshAudit } = useAudit()
  const { openInspection } = useInspection()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<'pillars' | 'all'>('pillars')
  const [selected, setSelected] = useState<string[]>([])
  // Requêtes saisies à la main (identifiant de page vers requête)
  const [typedQueries, setTypedQueries] = useState<Record<string, string>>({})

  const allPages = (audit?.subpages ?? []).filter((page) => page.indexable && page.httpStatus < 400)
  const hasPillars = allPages.some((page) => page.isPillar)
  // Sans pilier choisi (avant l'analyse IA), toutes les pages sont proposées
  const effectiveScope = hasPillars ? scope : 'all'
  const pages = effectiveScope === 'pillars' ? allPages.filter((page) => page.isPillar) : allPages
  const running = allPages.some((page) => page.serp?.status === 'RUNNING')

  // Suivi de l'avancement tant qu'une recherche est en cours
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      void refreshAudit()
    }, 3000)
    return () => clearInterval(timer)
  }, [running, refreshAudit])

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="Positionnement" />

  const launch = async (pageIds: string[]) => {
    if (!auditDbId || pageIds.length === 0) return
    setLaunching(true)
    setError(null)
    try {
      const queries = Object.fromEntries(
        Object.entries(typedQueries).filter(([id, value]) => pageIds.includes(id) && value.trim()),
      )
      const res = await fetch(`/api/audits/${auditDbId}/serp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds, queries }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `Erreur ${res.status}`)
      }
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lancement impossible')
    } finally {
      setLaunching(false)
    }
  }

  // Requête mesurée choisie comme cible : saisie manuelle, ré-analyse éditoriale de la page
  const chooseQuery = async (pageId: string, query: string) => {
    if (!auditDbId) return
    setLaunching(true)
    setError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/editorial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetQuery: query }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `Erreur ${res.status}`)
      }
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Changement de requête impossible')
    } finally {
      setLaunching(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  const visibleIds = pages.map((page) => page.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const selectedCount = selected.filter((id) => visibleIds.includes(id) || allPages.some((p) => p.id === id)).length
  const tooMany = selectedCount > MAX_PER_RUN

  const measured = allPages.filter((page) => page.serp?.status === 'DONE')
  const rankOf = (page: SubpageItem) => (page.serp ? describePagePosition(page.serp).rank : null)
  const inTop3 = measured.filter((page) => (rankOf(page) ?? 99) <= 3).length
  const inTop10 = measured.filter((page) => (rankOf(page) ?? 99) <= 10).length

  // Domaines qui reviennent le plus dans les résultats des requêtes mesurées
  const domainCounts = new Map<string, number>()
  for (const page of measured) {
    for (const domain of new Set((page.serp?.results ?? []).map((result) => result.domain))) {
      if (!domain || domain === audit.domain || domain.endsWith(`.${audit.domain}`)) continue
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1)
    }
  }
  const topCompetitors = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Positionnement" />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Positionnement Google</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Position de vos pages dans Google sur leur requête cible et sur 2 autres recherches génériques proposées
            par l’IA, sans le nom de la marque. Mesure faite dans une fenêtre Chrome locale : cochez les pages à
            analyser, quelques-unes à la fois (jusqu’à 3 recherches par page).
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={launching || running || selectedCount === 0 || tooMany}
            onClick={() => launch(selected)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-[#e0d100] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {launching || running ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            Analyser la sélection ({selectedCount})
          </button>
        </div>
      </div>

      <p className="rounded-xl border border-line-yellow bg-tint-yellow p-3 text-xs text-yellow-pale sm:text-sm">
        Les recherches automatisées vont à l’encontre des conditions d’utilisation de Google. Utilisez un profil Chrome
        dédié (jamais connecté à un compte personnel), espacez les lancements ({MAX_PER_RUN} pages au plus à la fois),
        et résolvez vous-même tout captcha dans la fenêtre. Les positions varient selon le lieu et le profil : elles
        donnent une indication.
      </p>

      {tooMany && (
        <p className="text-sm text-red-soft">
          Sélection trop grande : {MAX_PER_RUN} pages au maximum par lancement.
        </p>
      )}
      {error && <p className="text-sm text-red-soft">{error}</p>}

      <section aria-label="Résumé" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Pages mesurées', value: `${measured.length} / ${allPages.length}`, hint: 'pages indexables du site' },
          { label: 'Dans le Top 3', value: String(inTop3), hint: `${inTop10} dans le Top 10` },
          { label: 'Absentes du Top', value: String(measured.length - inTop10), hint: 'pages à renforcer en priorité' },
        ].map((tile) => (
          <div key={tile.label} className="glass-card glass-lift rounded-2xl border p-5">
            <span className="block text-3xl font-extrabold tracking-tight text-foreground">{tile.value}</span>
            <span className="mt-1 block text-sm font-semibold text-foreground">{tile.label}</span>
            <span className="block text-xs text-muted-foreground">{tile.hint}</span>
          </div>
        ))}
      </section>

      {topCompetitors.length > 0 && (
        <section className="glass-card rounded-2xl border p-5">
          <h2 className="text-base font-bold text-foreground">Concurrents qui reviennent</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Domaines présents dans les résultats de plusieurs de vos requêtes.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {topCompetitors.map(([domain, count]) => (
              <span key={domain} className="rounded-full border border-shade-44 px-3 py-1 text-xs text-foreground">
                {domain} <span className="text-muted-foreground">× {count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="glass-card rounded-2xl border p-4 md:p-6">
        {hasPillars && (
          <div className="mb-4 inline-flex rounded-xl border border-shade-38 bg-shade-14 p-1">
            {(
              [
                { key: 'pillars', label: 'Pages piliers' },
                { key: 'all', label: 'Toutes les pages' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setScope(tab.key)}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  effectiveScope === tab.key
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-sm text-foreground">
                <th scope="col" className="w-12 rounded-l-xl bg-shade-38 px-4 py-3 font-normal">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected((current) =>
                        allVisibleSelected
                          ? current.filter((id) => !visibleIds.includes(id))
                          : Array.from(new Set([...current, ...visibleIds])),
                      )
                    }
                    className="size-4 accent-[#f5e400]"
                  />
                </th>
                <th scope="col" className="bg-shade-38 px-4 py-3 font-normal">Page</th>
                <th scope="col" className="min-w-[260px] bg-shade-38 px-4 py-3 font-normal">Requête cible</th>
                <th scope="col" className="min-w-[280px] bg-shade-38 px-4 py-3 font-normal">Position</th>
                <th scope="col" className="bg-shade-38 px-4 py-3 font-normal">Devant vous</th>
                <th scope="col" className="bg-shade-38 px-4 py-3 font-normal">État</th>
                <th scope="col" className="rounded-r-xl bg-shade-38 px-4 py-3 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => {
                const serp = page.serp
                const isOpen = expanded === page.id
                const ahead =
                  serp?.status === 'DONE'
                    ? serp.results
                        .filter((result) => {
                          const rank = describePagePosition(serp).rank
                          return rank === null || result.position < rank
                        })
                        .slice(0, 3)
                    : []
                return (
                  <Fragment key={page.id}>
                    <tr className="border-b border-shade-3e hover:bg-shade-33/40">
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner ${page.path}`}
                          checked={selected.includes(page.id)}
                          onChange={() => toggle(page.id)}
                          className="size-4 accent-[#f5e400]"
                        />
                      </td>
                      <th scope="row" className="px-4 py-4 font-normal">
                        <button
                          type="button"
                          onClick={() => openInspection(page.id, page.isPillar ? 'editorial' : 'tech')}
                          className="text-left"
                        >
                          <span className="block max-w-xs truncate font-semibold text-foreground hover:text-primary-ink">
                            {page.title}
                          </span>
                          <span className="block text-sm text-muted-foreground">{page.path}</span>
                        </button>
                        <span className="mt-1 inline-flex items-center gap-1.5">
                          <span className="rounded-full border border-shade-44 px-2 py-0.5 text-[11px] text-muted-foreground">
                            {page.roleLabel}
                          </span>
                          {page.isPillar && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary-ink">
                              Pilier
                            </span>
                          )}
                        </span>
                      </th>
                      <td className="px-4 py-4">
                        <input
                          type="text"
                          value={typedQueries[page.id] ?? ''}
                          maxLength={120}
                          onChange={(e) => setTypedQueries((prev) => ({ ...prev, [page.id]: e.target.value }))}
                          placeholder={serp?.query || page.targetKeyword || 'Requête à analyser'}
                          aria-label={`Requête pour ${page.path}`}
                          className="w-full min-w-[240px] rounded-xl border border-shade-44 bg-shade-18 px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <PositionBadge serp={serp} history={page.serpHistory} />
                        <QueryPositions
                          page={page}
                          busy={launching || running}
                          onChoose={(query) => chooseQuery(page.id, query)}
                        />
                      </td>
                      <td className="px-4 py-4 text-xs text-muted-foreground">
                        {ahead.length === 0 ? '—' : ahead.map((result) => result.domain).join(', ')}
                      </td>
                      <td className="px-4 py-4">
                        <StatusCell serp={serp} />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={launching || running}
                            onClick={() => launch([page.id])}
                            className="text-xs font-semibold text-primary-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {serp ? 'Relancer' : 'Analyser'}
                          </button>
                          {serp?.status === 'DONE' && (
                            <button
                              type="button"
                              onClick={() => setExpanded(isOpen ? null : page.id)}
                              aria-expanded={isOpen}
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Résultats
                              <ChevronDown className={`size-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && serp?.status === 'DONE' && (
                      <tr>
                        <td colSpan={7} className="bg-shade-24 px-6 py-4">
                          <ol className="flex flex-col gap-2">
                            {serp.results.map((result) => {
                              const own = serp.ownUrls.some((o) => o.url === result.url)
                              return (
                                <li
                                  key={`${result.position}-${result.url}`}
                                  className={`rounded-lg border p-3 ${
                                    own ? 'border-primary/60 bg-primary/5' : 'border-shade-3a'
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <span className="w-6 shrink-0 text-sm font-bold text-muted-foreground">
                                      {result.position}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <a
                                        href={result.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-primary-ink"
                                      >
                                        {result.title}
                                        <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                                      </a>
                                      <p className="truncate font-mono text-xs text-muted-foreground">
                                        {result.url}
                                        {result.urlApproximate ? ' (adresse approximative)' : ''}
                                      </p>
                                      {result.snippet && (
                                        <p className="mt-1 text-xs text-foreground/80">{result.snippet}</p>
                                      )}
                                      {result.sitelinks && result.sitelinks.length > 0 && (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                          Liens annexes : {result.sitelinks.map((link) => link.title).join(' · ')}
                                        </p>
                                      )}
                                    </div>
                                    {own && (
                                      <span className="shrink-0 rounded-md bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                                        Votre site
                                      </span>
                                    )}
                                  </div>
                                </li>
                              )
                            })}
                          </ol>
                          {page.isPillar && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Les écarts de sections et l’intention des résultats sont détaillés dans{' '}
                              <Link href={`/projets/${projectId}/seo-editorial`} className="text-primary-ink hover:underline">
                                SEO Éditorial
                              </Link>
                              , sur la fiche de la page.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {pages.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    Aucune page à afficher.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <PageInspectionSheet />
    </div>
  )
}
