'use client'

import { createPortal } from 'react-dom'
import type { GlobalIssue, ProjectAuditData, SubpageItem } from '@/lib/audit-data'
import { pickPriorities } from '@/lib/issue-impact'
import { describePagePosition } from '@/lib/serp-labels'
import { backlinkSummary, releaseLabel } from '@/lib/backlink-labels'
import { Gauge, INK, SectionTitle, tone } from './print-kit'
import { describeCrawlScope } from '@/core/domain/crawl-scope'
import { packText } from './local-visibility-section'

export type ReportMode = 'client' | 'complete'

export const SEVERITY: Record<GlobalIssue['severity'], { label: string; color: string }> = {
  critical: { label: 'Critique', color: INK.bad },
  warning: { label: 'À corriger', color: INK.mid },
  passed: { label: 'Mineur', color: INK.info },
}

export const IMPACT: Record<string, string> = { high: 'Impact fort', medium: 'Impact moyen', low: 'Impact faible' }

/** Position la plus utile d'un relevé, en mots (« n° 4 (site) », « absente du Top 30 ») */
function positionText(serp: NonNullable<SubpageItem['serp']>) {
  return describePagePosition(serp).badge
}

/**
 * Rapport d'audit imprimable (Enregistrer au format PDF depuis la fenêtre d'impression). Monté dans <body> le temps de
 * l'impression : la feuille `@media print` de globals.css masque tout le reste. Texte réel et titres structurés : le PDF
 * reste lisible par un lecteur d'écran et la recherche de texte.
 */
export function ReportPrintSheet({ audit, mode }: { audit: ProjectAuditData; mode: ReportMode }) {
  if (typeof document === 'undefined') return null
  const complete = mode === 'complete'
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const priorities = pickPriorities(audit.globalIssues, complete ? 8 : 5)
  const pillars = audit.pillarPages.filter((page) => page.indexable && page.httpStatus < 400)
  const measured = audit.subpages.filter((page) => page.serp?.status === 'DONE')
  const backlinks = audit.backlinks?.status === 'DONE' ? audit.backlinks : undefined
  const summary = backlinks ? backlinkSummary(backlinks) : undefined
  let section = 0

  return createPortal(
    <article id="report-print-sheet" className="print-sheet text-[#111]" lang="fr">
      {/* ------------------------------------------------ Couverture */}
      <section className="report-cover flex flex-col">
        <p className="text-sm font-bold uppercase tracking-[0.2em]" style={{ color: INK.muted }}>
          Auditly · Rapport d’audit SEO{complete ? ' complet' : ''}
        </p>
        <h1 className="mt-3 text-4xl font-extrabold leading-tight">{audit.domain}</h1>
        <p className="mt-1 text-base" style={{ color: INK.muted }}>
          {date} · {audit.crawlStats.crawledPages} pages explorées
          {!audit.isLocked && ` · ${audit.pillarPages.length} pages stratégiques analysées`}
        </p>
        {audit.crawlScope && (
          <p className="mt-1 text-sm" style={{ color: INK.muted }}>
            Périmètre exploré : {describeCrawlScope(audit.crawlScope)}
          </p>
        )}
        <div className="mt-2 h-2 w-24 rounded-full" style={{ background: INK.brand }} />

        <div className="mt-10 flex flex-wrap items-center justify-center gap-10">
          {audit.scores.global !== null && <Gauge score={audit.scores.global} size={190} label="Note globale" />}
          <div className="flex gap-8">
            <Gauge score={audit.scores.tech} label="Technique" />
            {audit.scores.editorial !== null && <Gauge score={audit.scores.editorial} label="Contenu" />}
            {audit.scores.geo !== null && <Gauge score={audit.scores.geo} label="Moteurs IA" />}
          </div>
        </div>

        <dl className="mt-10 grid grid-cols-3 gap-3 text-center">
          {[
            { label: 'Problèmes critiques', value: audit.kpis.criticalIssuesCount, color: INK.bad },
            { label: 'Points à corriger', value: audit.kpis.warningsCount, color: INK.mid },
            { label: 'Améliorations mineures', value: audit.kpis.goodPracticesCount, color: INK.info },
          ].map((kpi) => (
            <div key={kpi.label} className="flex flex-col-reverse rounded-xl border p-3" style={{ borderColor: INK.line, borderTop: `4px solid ${kpi.color}` }}>
              <dt className="text-xs font-semibold" style={{ color: INK.muted }}>{kpi.label}</dt>
              <dd className="text-3xl font-extrabold">{kpi.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-8 rounded-xl p-4 text-sm" style={{ background: INK.soft }}>
          <strong>Comment lire ce rapport.</strong> La note globale combine la technique (40 %), le contenu des pages
          stratégiques (35 %) et leur capacité à être reprises par les moteurs IA (25 %). Au-dessus de 80 : solide ;
          de 60 à 79 : à consolider ; sous 60 : à corriger. Les positions Google et les liens reçus sont donnés à
          titre indicatif et n’entrent pas dans la note.
        </p>
      </section>

      {/* ------------------------------------------------ Résumé */}
      {audit.advice && (
        <section className="report-section">
          <SectionTitle number={++section} title="En résumé" />
          <p className="text-lg font-semibold">{audit.advice.headline}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {audit.advice.points.map((point) => (
              <li key={point.label} className="break-inside-avoid rounded-lg border-l-4 p-3 text-sm" style={{ borderColor: INK.brand, background: INK.soft }}>
                <span className="block text-xs font-bold uppercase tracking-wide" style={{ color: INK.muted }}>{point.label}</span>
                {point.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------ Priorités */}
      <section className="report-section">
        <SectionTitle
          number={++section}
          title="Vos priorités"
          intro="Les problèmes qui pèsent le plus sur le classement Google, du plus important au moins important."
        />
        {priorities.length === 0 ? (
          <p className="text-sm">Aucun problème à fort ou moyen impact.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {priorities.map((issue, index) => (
              <li key={issue.id} className="break-inside-avoid rounded-xl border p-4" style={{ borderColor: INK.line, borderLeft: `5px solid ${SEVERITY[issue.severity].color}` }}>
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-lg font-extrabold">{index + 1}.</span>
                  <span className="font-bold">{issue.title}</span>
                  <span className="text-xs font-semibold" style={{ color: SEVERITY[issue.severity].color }}>
                    {SEVERITY[issue.severity].label} · {IMPACT[issue.impact] ?? ''} · {issue.impactCount ?? 0} page(s)
                  </span>
                </p>
                {issue.recommendation && <p className="mt-1 text-sm"><strong>À faire : </strong>{issue.recommendation}</p>}
                {complete && issue.steps && issue.steps.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {issue.steps.slice(0, 4).map((step) => <li key={step}>{step}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ------------------------------------------------ Pages stratégiques */}
      {pillars.length > 0 && (
        <section className="report-section">
          <SectionTitle
            number={++section}
            title="Pages stratégiques"
            intro="Les pages choisies comme prioritaires, la recherche Google qu’elles visent, leurs notes et leur position mesurée."
          />
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ background: INK.soft }}>
                {['Page', 'Recherche visée', 'Contenu', 'Moteurs IA', 'Position Google'].map((head) => (
                  <th key={head} scope="col" className="border px-2 py-1.5 text-left" style={{ borderColor: INK.line }}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pillars.map((page) => {
                const sub = audit.subpages.find((item) => item.id === page.id)
                const confidence = audit.inspections[page.id]?.editorial.queryConfidence
                return (
                  <tr key={page.id} className="break-inside-avoid">
                    <th scope="row" className="border px-2 py-1.5 text-left align-top font-normal" style={{ borderColor: INK.line }}>
                      <span className="block font-semibold">{page.title}</span>
                      <span className="block font-mono text-xs" style={{ color: INK.muted }}>{page.path} · {page.roleLabel}</span>
                    </th>
                    <td className="border px-2 py-1.5 align-top" style={{ borderColor: INK.line }}>
                      « {page.targetKeyword} »
                      <span className="block text-xs" style={{ color: INK.muted }}>
                        {confidence === 'MANUAL' ? 'saisie' : confidence === 'CONFIRMED' ? 'confirmée par Google' : 'non confirmée'}
                      </span>
                    </td>
                    {[page.editorialScore, page.geoScore].map((score, i) => (
                      <td key={i} className="border px-2 py-1.5 align-top" style={{ borderColor: INK.line }}>
                        <strong style={{ color: tone(score).color }}>{score}</strong>/100
                        <span className="block text-xs" style={{ color: INK.muted }}>{tone(score).label}</span>
                      </td>
                    ))}
                    <td className="border px-2 py-1.5 align-top" style={{ borderColor: INK.line }}>
                      {sub?.serp?.status === 'DONE' ? positionText(sub.serp) : 'Non mesurée'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ------------------------------------------------ Visibilité dans Google */}
      {measured.length > 0 && (
        <section className="report-section">
          <SectionTitle
            number={++section}
            title="Visibilité dans Google"
            intro="Position mesurée sur google.fr, sur la recherche visée et sur d’autres recherches génériques de vos prospects (sans le nom de la marque). Indicatif : les positions varient selon le lieu et le moment."
          />
          <div className="flex flex-col gap-3">
            {measured.map((page) => {
              const queries = (page.serpQueries?.length ? page.serpQueries : [page.serp!]).filter((serp) => serp.status === 'DONE')
              const visible = queries.filter((serp) => describePagePosition(serp).rank !== null).length
              return (
                <div key={page.id} className="break-inside-avoid rounded-xl border p-3" style={{ borderColor: INK.line }}>
                  <p className="font-semibold">
                    {page.title} <span className="font-mono text-xs font-normal" style={{ color: INK.muted }}>{page.path}</span>
                  </p>
                  <p className="text-xs" style={{ color: INK.muted }}>Le site sort sur {visible} recherche(s) sur {queries.length}.</p>
                  <ul className="mt-1 text-sm">
                    {queries.map((serp) => (
                      <li key={serp.query}>
                        « {serp.query} » : <strong>{positionText(serp)}</strong>
                        <span style={{ color: INK.muted }}> · {describePagePosition(serp).detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ------------------------------------------------ Visibilité par zone */}
      {audit.localVisibility && audit.localVisibility.zones.length + audit.localVisibility.establishments.length > 0 && (
        <section className="report-section">
          <SectionTitle
            number={++section}
            title="Visibilité par zone"
            intro="Positions mesurées comme si l’internaute cherchait depuis chaque zone, et pages qui ciblent chaque zone. Indicatif : n’entre pas dans la note."
          />
          {audit.localVisibility.zones.length > 0 && (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ background: INK.soft }}>
                  {['Zone', 'Pages dédiées', 'Visible dans Google', 'Meilleure position', 'Pack local'].map((head) => (
                    <th key={head} scope="col" className="border px-2 py-1.5 text-left" style={{ borderColor: INK.line }}>
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {audit.localVisibility.zones.map(({ zone, coverage, measures }) => (
                  <tr key={zone.id} className="break-inside-avoid">
                    <th scope="row" className="border px-2 py-1.5 text-left align-top" style={{ borderColor: INK.line }}>
                      {zone.label}
                      <span className="block text-xs font-normal" style={{ color: INK.muted }}>depuis {zone.city.name}</span>
                    </th>
                    <td className="border px-2 py-1.5 align-top" style={{ borderColor: INK.line, color: coverage.length === 0 ? INK.info : undefined }}>
                      {coverage.length === 0 ? 'Aucune page dédiée' : coverage.slice(0, 3).map((page) => page.path).join(', ')}
                    </td>
                    <td className="border px-2 py-1.5 align-top" style={{ borderColor: INK.line }}>
                      {measures.measured === 0 ? 'Non mesurée' : `${measures.visible} sur ${measures.measured}`}
                    </td>
                    <td className="border px-2 py-1.5 align-top" style={{ borderColor: INK.line }}>
                      {measures.best ? `n°${measures.best.rank} sur « ${measures.best.query} »` : '—'}
                    </td>
                    <td className="border px-2 py-1.5 align-top" style={{ borderColor: INK.line }}>
                      {packText(measures)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {audit.localVisibility.establishments.length > 0 && (
            <p className="mt-3 text-sm">
              <strong>{audit.localVisibility.establishments.length} établissement(s) repéré(s)</strong>, dont{' '}
              {audit.localVisibility.establishments.filter((item) => item.schemaConsistent === false).length} avec des
              coordonnées différentes du balisage
              {complete
                ? ` : ${audit.localVisibility.establishments.map((item) => `${item.city} (${item.postalCode})`).join(', ')}.`
                : '.'}
            </p>
          )}
        </section>
      )}

      {/* ------------------------------------------------ Popularité */}
      {backlinks && summary && (
        <section className="report-section">
          <SectionTitle
            number={++section}
            title="Popularité du site"
            intro={`Sites qui font un lien vers le vôtre, d’après l’exploration publique Common Crawl de ${releaseLabel(backlinks.release)}. Relevé partiel : les vrais totaux sont plus élevés. N’entre pas dans la note.`}
          />
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="flex flex-col-reverse rounded-xl border p-3" style={{ borderColor: INK.line }}>
              <dt className="text-xs" style={{ color: INK.muted }}>sites qui font un lien</dt>
              <dd className="text-2xl font-extrabold">{summary.domains}</dd>
            </div>
            <div className="flex flex-col-reverse rounded-xl border p-3" style={{ borderColor: INK.line }}>
              <dt className="text-xs" style={{ color: INK.muted }}>liens retrouvés sur les sites vérifiés</dt>
              <dd className="text-2xl font-extrabold">{summary.found} / {summary.verified}</dd>
            </div>
            <div className="flex flex-col-reverse rounded-xl border p-3" style={{ borderColor: INK.line }}>
              <dt className="text-xs" style={{ color: INK.muted }}>pages du site avec un lien vérifié</dt>
              <dd className="text-2xl font-extrabold">{summary.targets > 0 ? summary.targets : '—'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm">
            <strong>Principaux sites : </strong>
            {backlinks.referringDomains.slice(0, complete ? 30 : 12).map((item) => item.domain).join(', ')}
            {backlinks.referringDomains.length > (complete ? 30 : 12) ? '…' : ''}
          </p>
          {summary.found > 0 && (
            <ul className="mt-2 text-sm">
              {backlinks.referringDomains
                .filter((item) => item.verification?.status === 'FOUND')
                .map((item) => {
                  const link = item.verification!.links[0]
                  return (
                    <li key={item.domain} className="break-inside-avoid">
                      <strong>{item.domain}</strong> : <span className="font-mono text-xs">{link.sourceUrl}</span>
                      {link.anchor ? ` « ${link.anchor} »` : ' (lien sur une image)'}
                      {link.nofollow ? ' · non suivi par Google' : ' · suivi par Google'}
                    </li>
                  )
                })}
            </ul>
          )}
        </section>
      )}

      {/* ------------------------------------------------ Toutes les anomalies (rapport complet) */}
      {complete && (
        <section className="report-section">
          <SectionTitle number={++section} title="Toutes les anomalies" intro="Liste complète, par gravité, avec le nombre de pages concernées." />
          {(['critical', 'warning', 'passed'] as const).map((severity) => {
            const issues = audit.globalIssues.filter((issue) => issue.severity === severity)
            if (issues.length === 0) return null
            return (
              <div key={severity} className="mt-3">
                <h3 className="text-base font-bold" style={{ color: SEVERITY[severity].color }}>
                  {SEVERITY[severity].label} ({issues.length})
                </h3>
                <ul className="mt-1 flex flex-col gap-1.5 text-sm">
                  {issues.map((issue) => (
                    <li key={issue.id} className="break-inside-avoid">
                      <strong>{issue.title}</strong> · {issue.impactCount ?? 0} page(s)
                      {issue.recommendation && <span className="block" style={{ color: INK.muted }}>{issue.recommendation}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </section>
      )}

      {/* ------------------------------------------------ Méthode */}
      <section className="report-section">
        <SectionTitle number={++section} title="Méthode et limites" />
        <ul className="list-disc pl-5 text-sm">
          <li>Le robot d’Auditly a exploré le site comme Google, en suivant les liens depuis la page d’accueil.</li>
          <li>Les vitesses d’affichage viennent de Google PageSpeed Insights. Les recherches visées sont vérifiées dans les suggestions Google.</li>
          <li>Le contenu des pages stratégiques est jugé par une IA avec des grilles fixes ; quand c’est possible, le code vérifie et compte lui-même.</li>
          <li>Un critère impossible à mesurer est retiré du calcul au lieu d’être compté juste ou faux.</li>
          <li>Une bonne note améliore le site ; elle ne garantit pas une place en première page, qui dépend aussi des concurrents et de la popularité.</li>
        </ul>
        {complete && (
          <dl className="mt-3 grid grid-cols-[160px_1fr] gap-x-4 gap-y-1 text-sm">
            {[
              ['Recherche visée', 'La recherche Google sur laquelle une page doit se positionner.'],
              ['Title', 'Le titre affiché en bleu dans les résultats Google.'],
              ['Méta description', 'Le court texte sous le titre dans les résultats Google.'],
              ['LCP', 'Temps d’affichage du contenu principal ; bon sous 2,5 secondes.'],
              ['Moteurs IA (GEO)', 'ChatGPT, Perplexity, Google AI Overviews : leur capacité à citer vos pages.'],
              ['Lien suivi / non suivi', 'Un lien « non suivi » (nofollow) transmet peu de popularité aux yeux de Google.'],
            ].map(([term, definition]) => (
              <div key={term} className="contents">
                <dt className="font-semibold">{term}</dt>
                <dd style={{ color: INK.muted }}>{definition}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-4 text-xs" style={{ color: INK.muted }}>Rapport généré par Auditly le {date}.</p>
      </section>
    </article>,
    document.body,
  )
}
