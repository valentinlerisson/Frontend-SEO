'use client'

import { useState } from 'react'
import { ExternalLink, Info, Loader2, Search } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import { useSettings } from '@/components/providers/settings-provider'
import type { BacklinkReport } from '@/core/domain/types'
import { planBacklinkSearches } from '@/core/domain/backlink-discovery'
import { ANCHOR_TYPE_LABEL, LOCATION_LABEL, discoveryInterrupted, discoverySummary } from '@/lib/backlink-labels'

const chip = 'inline-flex items-center rounded-full border border-shade-44 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground'

/**
 * Liens précis : un bouton, à part de l'audit, qui cherche dans Google les pages qui parlent de la marque du site
 * (plusieurs pages de résultats défilées), lit chacune en direct et relève le lien exact. Tout ce qui est affiché est
 * mesuré par le code ; ce que Google ne remonte pas n'est pas vu.
 */
export function BacklinksDiscoveryPanel({ report, domain, projectId }: { report: BacklinkReport; domain: string; projectId: string }) {
  const { refreshAudit } = useAudit()
  const { serpPerRun, serpPerDay } = useSettings()
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const discovery = report.discovery
  const interrupted = discovery ? discoveryInterrupted(discovery) : false
  const running = discovery?.status === 'RUNNING' && !interrupted
  const summary = discovery ? discoverySummary(discovery) : undefined
  // Pages de résultats prévues : le nom de marque (avec et sans espace) défilé sur 9 pages, dans la limite du budget par lancement
  const planned = Math.min(
    serpPerRun,
    planBacklinkSearches(domain).reduce((sum, search) => sum + search.pages, 0),
  )

  const launch = async () => {
    setLaunching(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/backlinks/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget: { perRun: serpPerRun, perDay: serpPerDay } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lancement impossible')
    } finally {
      setLaunching(false)
    }
  }

  return (
    <section aria-labelledby="discovery-title" className="glass-card flex flex-col gap-4 rounded-2xl border p-5 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h2 id="discovery-title" className="text-lg font-bold text-foreground">
            Liens précis
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cherche dans Google les pages qui parlent de la marque de {domain} (le nom sans le site, sur plusieurs pages de
            résultats), puis lit chacune pour relever le lien exact : page source, texte du lien, nofollow et emplacement dans
            la page. Lancé à la demande, séparément de l’audit.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void launch()}
          disabled={launching || running}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
        >
          {launching || running ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
          {running ? 'Recherche en cours…' : discovery ? 'Relancer la recherche' : 'Chercher les liens précis'}
        </button>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-[#38bdf8]/40 bg-tint-indigo p-3 text-xs text-sky-soft">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Jusqu’à {planned} pages de résultats Google (budget des Paramètres : {serpPerRun} par lancement, {serpPerDay} par jour),
          lues trois par trois et espacées de quelques secondes ; une réponse en cache de moins de 24 h ne compte pas. Google ne
          remonte pas tous les liens, et le nom de marque peut aussi désigner d’autres entreprises. La recherche s’arrête si Google
          demande un captcha.
        </span>
      </p>

      {error && (
        <p role="alert" className="rounded-xl border border-[#38bdf8]/40 bg-tint-indigo p-3 text-sm text-sky-soft">
          {error}
        </p>
      )}

      {discovery && (
        <>
          {running && (
            <p role="status" className="text-sm text-foreground">
              Google : {discovery.searches.requests} page(s) de résultats lue(s) ({discovery.searches.done} lot(s) sur{' '}
              {discovery.searches.planned})
              {discovery.pages.found > 0 && (
                <>
                  {' · '}pages lues : {discovery.pages.read + discovery.pages.unreachable} sur {discovery.pages.found}
                </>
              )}
              {' · '}liens trouvés : {discovery.links.length}
            </p>
          )}
          {interrupted && (
            <p className="rounded-xl border border-[#38bdf8]/40 bg-tint-indigo p-3 text-sm text-sky-soft">
              La recherche précédente a été interrompue (serveur arrêté ou bloqué) : relancez-la. Les liens déjà trouvés sont gardés
              ci-dessous.
            </p>
          )}
          {discovery.message && discovery.status !== 'RUNNING' && (
            <p className="rounded-xl border border-[#38bdf8]/40 bg-tint-indigo p-3 text-sm text-sky-soft">{discovery.message}</p>
          )}

          {summary && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'liens trouvés', value: summary.links, hint: `${summary.inContent} dans le contenu` },
                { label: 'sites', value: summary.sites, hint: `${summary.outsideCommonCrawl} absents de Common Crawl` },
                { label: 'nofollow, sponsored ou ugc', value: summary.nofollow, hint: 'le reste est suivi par Google' },
                { label: 'mentions sans lien', value: summary.mentions, hint: 'pistes de prospection' },
              ].map((tile) => (
                <div key={tile.label} className="rounded-xl border border-shade-33 p-3">
                  <dd className="text-2xl font-extrabold text-foreground">{tile.value}</dd>
                  <dt className="text-xs font-semibold text-foreground">{tile.label}</dt>
                  <p className="text-[11px] text-muted-foreground">{tile.hint}</p>
                </div>
              ))}
            </dl>
          )}

          {discovery.pages.found > 0 && (
            <p className="text-xs text-muted-foreground">
              {discovery.pages.found} page(s) trouvée(s) par Google, {discovery.pages.read} lue(s)
              {discovery.pages.unreachable > 0
                ? `, ${discovery.pages.unreachable} injoignable(s)${
                    discovery.pages.unreachableReasons
                      ? ` (${Object.entries(discovery.pages.unreachableReasons)
                          .sort((a, b) => b[1] - a[1])
                          .map(([reason, count]) => `${reason} ×${count}`)
                          .join(', ')})`
                      : ''
                  }`
                : ''}
              . Mesure du{' '}
              {new Date(discovery.finishedAt ?? discovery.startedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}{' '}
              ({discovery.provider === 'serper' ? 'API Serper' : 'Chrome local'}).
            </p>
          )}

          {discovery.links.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr className="text-sm text-foreground">
                    <th scope="col" className="rounded-l-xl bg-shade-38 px-4 py-3 font-normal">Page source</th>
                    <th scope="col" className="bg-shade-38 px-4 py-3 font-normal">Lien</th>
                    <th scope="col" className="bg-shade-38 px-4 py-3 font-normal">Emplacement</th>
                    <th scope="col" className="rounded-r-xl bg-shade-38 px-4 py-3 font-normal">Page du site liée</th>
                  </tr>
                </thead>
                <tbody>
                  {discovery.links.map((link) => (
                    <tr key={`${link.sourceUrl}|${link.targetUrl}|${link.anchor}`} className="border-b border-shade-3e align-top hover:bg-shade-33/40">
                      <td className="px-4 py-3">
                        <a
                          href={link.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-primary-ink"
                        >
                          {link.sourceDomain}
                          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                        </a>
                        <span className="block max-w-[300px] truncate font-mono text-xs text-muted-foreground" title={link.sourceUrl}>
                          {link.sourceUrl.replace(/^https?:\/\/(www\.)?/, '')}
                        </span>
                        {!link.inCommonCrawl && <span className={`${chip} mt-1 border-[#38bdf8]/50 text-sky-soft`}>Absent de Common Crawl</span>}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="block max-w-[260px] font-semibold text-foreground">
                          {link.anchor ? `« ${link.anchor} »` : 'Lien sans texte'}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <span className={chip}>{ANCHOR_TYPE_LABEL[link.anchorType]}</span>
                          {link.nofollow || link.sponsored || link.ugc ? (
                            <span className={chip}>{[link.nofollow && 'nofollow', link.sponsored && 'sponsored', link.ugc && 'ugc'].filter(Boolean).join(' · ')}</span>
                          ) : (
                            <span className={chip}>Suivi</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={chip}>{LOCATION_LABEL[link.location]}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {link.externalLinksInContent} lien(s) externe(s) dans le contenu
                        </span>
                        {link.context && (
                          <details className="mt-1 max-w-[280px] text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Voir le texte autour</summary>
                            <p className="mt-1 leading-relaxed text-foreground/90">{link.context}</p>
                          </details>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        <span className="block max-w-[220px] truncate" title={link.targetUrl}>
                          {link.targetUrl.replace(/^https?:\/\/(www\.)?/, '')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {discovery.status !== 'RUNNING' && discovery.links.length === 0 && !discovery.message && (
            <p className="rounded-xl border border-shade-33 p-4 text-center text-sm text-muted-foreground">
              Aucun lien vers {domain} n’a été relevé sur les pages que Google a remontées.
            </p>
          )}

          {discovery.mentions.length > 0 && (
            <details className="rounded-xl border border-shade-33 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-foreground">
                {discovery.mentions.length} page(s) qui citent {domain} sans lien
              </summary>
              <p className="mt-1 text-xs text-muted-foreground">
                Le nom du site ou de la marque est écrit dans la page sans lien : une piste pour demander un lien. À confirmer, le
                nom de marque peut désigner une autre entreprise.
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {discovery.mentions.map((mention) => (
                  <li key={mention.url}>
                    <a href={mention.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground hover:text-primary-ink">
                      {mention.title || mention.domain}
                    </a>
                    <span className="block max-w-[640px] truncate font-mono text-xs text-muted-foreground" title={mention.url}>
                      {mention.url.replace(/^https?:\/\/(www\.)?/, '')}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}
