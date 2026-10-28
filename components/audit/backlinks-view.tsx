'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ExternalLink, Info } from 'lucide-react'
import { AuditHeader } from './audit-header'
import { AuditStateGate } from './audit-state-gate'
import { useAudit } from '@/components/providers/audit-provider'
import type { ReferringDomain } from '@/core/domain/types'
import { backlinkSummary, releaseLabel } from '@/lib/backlink-labels'

function VerificationCell({ item }: { item: ReferringDomain }) {
  const verification = item.verification
  if (!verification) return <span className="text-xs text-muted-foreground">Non vérifié</span>
  if (verification.status === 'FOUND') {
    return <span className="text-xs font-semibold text-green-soft">Lien retrouvé</span>
  }
  if (verification.status === 'UNREACHABLE') {
    return <span className="text-xs text-muted-foreground">Site injoignable</span>
  }
  return (
    <span
      title="Aucun lien sur l’accueil ni sur les pages de partenaires, références ou mentions lues : il est probablement sur une page plus profonde, ou a été retiré depuis l’exploration de Common Crawl."
      className="text-xs text-sky-soft"
    >
      Non retrouvé sur {verification.pagesChecked} page(s) lue(s)
    </span>
  )
}

export function BacklinksView() {
  const { audit, state } = useAudit()
  const [expanded, setExpanded] = useState<string | null>(null)

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="Backlinks" />

  const report = audit.backlinks
  const domains = report?.referringDomains ?? []
  const summary = report ? backlinkSummary(report) : undefined

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Backlinks" />

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Backlinks</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Sites qui font un lien vers {audit.domain}, relevés pendant le crawl. Hors score.
        </p>
      </div>

      {!report && (
        <p className="rounded-xl border border-[#38bdf8]/40 bg-tint-indigo p-3 text-sm text-sky-soft">
          Cet audit a été lancé avant l’ajout des backlinks : relancez un audit pour les obtenir.
        </p>
      )}
      {report && report.status !== 'DONE' && (
        <p className="rounded-xl border border-[#38bdf8]/40 bg-tint-indigo p-3 text-sm text-sky-soft">
          {report.message ?? 'Backlinks indisponibles pour cet audit.'}
        </p>
      )}

      {report?.status === 'DONE' && (
        <>
          <div className="flex items-start gap-2 rounded-xl border border-[#38bdf8]/40 bg-tint-indigo p-3 text-xs text-sky-soft sm:text-sm">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              Source : graphe de liens public de Common Crawl, exploration de {releaseLabel(report.release)}. Il ne
              couvre qu’une partie du web et donne seulement les domaines : les vrais totaux sont sans doute plus
              élevés. Les {Math.min(20, domains.length)} premiers domaines ont été vérifiés en lisant leur accueil et
              leurs pages de partenaires, références ou mentions légales.
            </p>
          </div>

          <section aria-label="Résumé" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                label: 'Domaines référents',
                value: String(domains.length),
                hint: report.domainInGraph === false ? 'site absent du graphe Common Crawl' : 'liens observés par Common Crawl',
              },
              {
                label: 'Liens vérifiés',
                value: `${summary?.found ?? 0} / ${summary?.verified ?? 0}`,
                hint:
                  summary && summary.links > 0
                    ? `${summary.links} lien(s), dont ${summary.nofollow} en nofollow`
                    : 'domaines dont le lien a été retrouvé',
              },
              {
                label: 'Depuis l’audit précédent',
                value: report.changes ? `+${report.changes.added.length} / −${report.changes.lost.length}` : '—',
                hint: report.changes
                  ? `domaines gagnés / perdus depuis le ${new Date(report.changes.previousDate).toLocaleDateString('fr-FR')}`
                  : 'premier relevé du projet',
              },
            ].map((tile) => (
              <div key={tile.label} className="glass-card glass-lift rounded-2xl border p-5">
                <span className="block text-3xl font-extrabold tracking-tight text-foreground">{tile.value}</span>
                <span className="mt-1 block text-sm font-semibold text-foreground">{tile.label}</span>
                <span className="block text-xs text-muted-foreground">{tile.hint}</span>
              </div>
            ))}
          </section>

          {report.changes && (report.changes.added.length > 0 || report.changes.lost.length > 0) && (
            <section className="glass-card rounded-2xl border p-5 text-sm">
              <h2 className="text-base font-bold text-foreground">Évolution</h2>
              {report.changes.previousRelease && report.changes.previousRelease !== report.release && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Les deux relevés viennent de deux explorations différentes de Common Crawl : une partie de l’écart peut
                  venir de l’exploration elle-même.
                </p>
              )}
              {report.changes.added.length > 0 && (
                <p className="mt-2">
                  <span className="font-semibold text-green-soft">Nouveaux : </span>
                  {report.changes.added.join(', ')}
                </p>
              )}
              {report.changes.lost.length > 0 && (
                <p className="mt-1">
                  <span className="font-semibold text-sky-soft">Plus observés : </span>
                  {report.changes.lost.join(', ')}
                </p>
              )}
            </section>
          )}

          <section className="glass-card rounded-2xl border p-4 md:p-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr className="text-sm text-foreground">
                    <th scope="col" className="rounded-l-xl bg-shade-38 px-4 py-3 font-normal">Domaine référent</th>
                    <th
                      scope="col"
                      title="Nombre d’hôtes du site référent dans le graphe : sa taille, pas le nombre de liens"
                      className="bg-shade-38 px-4 py-3 font-normal"
                    >
                      Taille du site
                    </th>
                    <th scope="col" className="bg-shade-38 px-4 py-3 font-normal">Vérification</th>
                    <th scope="col" className="rounded-r-xl bg-shade-38 px-4 py-3 font-normal">Lien retrouvé</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((item) => {
                    const first = item.verification?.links[0]
                    const more = (item.verification?.links.length ?? 0) - 1
                    const isOpen = expanded === item.domain
                    return (
                      <Fragment key={item.domain}>
                        <tr className="border-b border-shade-3e hover:bg-shade-33/40">
                          <th scope="row" className="px-4 py-3 font-normal">
                            <a
                              href={`https://${item.domain}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-primary-ink"
                            >
                              {item.domain}
                              <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                            </a>
                          </th>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {item.hosts} hôte{item.hosts > 1 ? 's' : ''}
                          </td>
                          <td className="px-4 py-3">
                            <VerificationCell item={item} />
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {first ? (
                              <div className="flex flex-col gap-0.5">
                                <a
                                  href={first.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="max-w-[340px] truncate font-mono text-foreground hover:text-primary-ink"
                                >
                                  {first.sourceUrl}
                                </a>
                                <span className="text-muted-foreground">
                                  {first.anchor ? `« ${first.anchor} »` : 'Lien sans texte (image)'} →{' '}
                                  {first.targetUrl.replace(/^https?:\/\//, '')}
                                  {first.nofollow ? ' · nofollow' : ' · suivi'}
                                </span>
                                {more > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setExpanded(isOpen ? null : item.domain)}
                                    aria-expanded={isOpen}
                                    className="inline-flex w-fit items-center gap-1 text-muted-foreground hover:text-foreground"
                                  >
                                    {more} autre(s) lien(s)
                                    <ChevronDown className={`size-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                        {isOpen &&
                          item.verification?.links.slice(1).map((link) => (
                            <tr key={`${link.sourceUrl}-${link.targetUrl}`}>
                              <td colSpan={3} />
                              <td className="px-4 py-2 text-xs text-muted-foreground">
                                <span className="font-mono text-foreground">{link.sourceUrl}</span>{' '}
                                {link.anchor ? `« ${link.anchor} »` : '(image)'} → {link.targetUrl.replace(/^https?:\/\//, '')}
                                {link.nofollow ? ' · nofollow' : ' · suivi'}
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    )
                  })}
                  {domains.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                        Aucun domaine référent observé dans cette exploration de Common Crawl.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
