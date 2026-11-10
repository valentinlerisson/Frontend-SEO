'use client'

import { createPortal } from 'react-dom'
import type { GlobalIssue, ProjectAuditData, SubpageItem } from '@/lib/audit-data'
import { pickPriorities } from '@/lib/issue-impact'
import { describePagePosition } from '@/lib/serp-labels'
import { backlinkSummary, releaseLabel } from '@/lib/backlink-labels'
import { Callout, Chip, Gauge, INK, ScoreBar, SectionTitle, count, palette, type Tone } from './print-kit'
import { describeCrawlScope } from '@/core/domain/crawl-scope'
import { packText } from './local-visibility-section'
import { GEO_ENABLED } from '@/core/domain/features'
import { PILLAR_WEIGHTS } from '@/core/domain/scoring/GlobalScoringEngine'

export type ReportMode = 'client' | 'complete'

/** Gravité d'une anomalie : mot, état de la pastille et couleur de la forme (trait, bordure) */
export const SEVERITY: Record<GlobalIssue['severity'], { label: string; tone: Tone; color: string }> = {
  critical: { label: 'Critique', tone: 'bad', color: INK.bad },
  warning: { label: 'À corriger', tone: 'mid', color: INK.mid },
  passed: { label: 'Mineur', tone: 'info', color: INK.info },
}

export const IMPACT: Record<string, string> = { high: 'Impact fort', medium: 'Impact moyen', low: 'Impact faible' }

/** Position la plus utile d'un relevé, en mots (« n° 4 (site) », « absente du Top 30 ») */
function positionText(serp: NonNullable<SubpageItem['serp']>) {
  return describePagePosition(serp).badge
}

/** Styles communs des tableaux : en-tête discret en petites capitales, lignes séparées d'un filet */
const TH = 'px-3 py-2 text-left align-bottom text-[11px] font-bold uppercase tracking-wide'
const TD = 'border-b px-3 py-2.5 align-top'

function Th({ children }: { children: string }) {
  return (
    <th scope="col" className={TH} style={{ color: INK.muted, borderBottom: `2px solid ${INK.line}`, background: INK.soft }}>
      {children}
    </th>
  )
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
    <article id="report-print-sheet" className="print-sheet" lang="fr">
      {/* ------------------------------------------------ Couverture */}
      <section className="report-cover flex flex-col">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em]" style={{ color: INK.muted }}>
          <span aria-hidden="true" className="inline-block size-3 rounded-sm" style={{ background: INK.brand }} />
          Auditly · Rapport d’audit SEO{complete ? ' complet' : ''}
        </p>
        <h1 className="mt-4 text-5xl font-extrabold leading-[1.05] tracking-tight">{audit.domain}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <Chip>{date}</Chip>
          <Chip>{audit.crawlStats.crawledPages} pages explorées</Chip>
          {!audit.isLocked && <Chip>{audit.pillarPages.length} pages stratégiques analysées</Chip>}
        </p>
        {audit.crawlScope && (
          <p className="mt-2 text-sm" style={{ color: INK.muted }}>
            Périmètre exploré : {describeCrawlScope(audit.crawlScope)}
          </p>
        )}

        {/* Notes : la globale en grand, puis chaque pilier */}
        <div className="mt-10 flex items-center justify-center gap-10 rounded-3xl p-8" style={{ background: INK.soft }}>
          {audit.scores.global !== null && <Gauge score={audit.scores.global} size={200} label="Note globale" />}
          <div className="flex gap-7">
            <Gauge score={audit.scores.tech} size={118} label="Technique" />
            {audit.scores.editorial !== null && <Gauge score={audit.scores.editorial} size={118} label="Contenu" />}
            {audit.scores.geo !== null && <Gauge score={audit.scores.geo} size={118} label="Moteurs IA" />}
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-3 gap-4">
          {(
            [
              { label: 'Problèmes critiques', value: audit.kpis.criticalIssuesCount, tone: 'bad' },
              { label: 'Points à corriger', value: audit.kpis.warningsCount, tone: 'mid' },
              { label: 'Améliorations mineures', value: audit.kpis.goodPracticesCount, tone: 'info' },
            ] as const
          ).map((kpi) => (
            <div key={kpi.label} className="flex flex-col-reverse rounded-2xl border p-4" style={{ borderColor: INK.line, borderTop: `5px solid ${palette(kpi.tone).color}` }}>
              <dt className="mt-1 text-sm font-semibold" style={{ color: INK.muted }}>
                {kpi.label}
              </dt>
              <dd className="text-4xl font-extrabold leading-none">{kpi.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 rounded-2xl border p-5" style={{ borderColor: INK.line }}>
          <p className="text-sm font-bold">Comment lire ce rapport</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Chip tone="good">80 et plus : solide</Chip>
            <Chip tone="mid">60 à 79 : à consolider</Chip>
            <Chip tone="bad">moins de 60 : à corriger</Chip>
          </p>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: INK.muted }}>
            La note globale combine la technique ({Math.round(PILLAR_WEIGHTS.tech * 100)} %) et le contenu des pages stratégiques (
            {Math.round(PILLAR_WEIGHTS.editorial * 100)} %)
            {GEO_ENABLED && <> ainsi que leur capacité à être reprises par les moteurs IA ({Math.round(PILLAR_WEIGHTS.geo * 100)} %)</>}. Les
            positions Google et les liens reçus sont donnés à titre indicatif et n’entrent pas dans la note.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ Résumé */}
      {audit.advice && (
        <section className="report-section">
          <SectionTitle number={++section} title="En résumé" />
          <p className="text-xl font-bold leading-snug">{audit.advice.headline}</p>
          <ul className="mt-4 grid grid-cols-2 gap-3">
            {audit.advice.points.map((point) => (
              <li key={point.label} className="break-inside-avoid rounded-xl p-4 text-sm leading-relaxed" style={{ background: INK.soft, borderTop: `4px solid ${INK.brand}` }}>
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide" style={{ color: INK.muted }}>
                  {point.label}
                </span>
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
              <li key={issue.id} className="break-inside-avoid rounded-2xl border p-4" style={{ borderColor: INK.line, borderLeft: `6px solid ${SEVERITY[issue.severity].color}` }}>
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-extrabold"
                    style={{ background: INK.text, color: '#fff' }}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-base font-bold leading-snug">{issue.title}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Chip tone={SEVERITY[issue.severity].tone}>{SEVERITY[issue.severity].label}</Chip>
                      {IMPACT[issue.impact] && <Chip>{IMPACT[issue.impact]}</Chip>}
                      <Chip>{count(issue.impactCount ?? 0, 'page', 'pages')}</Chip>
                    </p>
                  </div>
                </div>
                {issue.recommendation && <Callout label="À faire :">{issue.recommendation}</Callout>}
                {complete && issue.steps && issue.steps.length > 0 && (
                  <ol className="mt-2 list-decimal pl-6 text-sm leading-relaxed">
                    {issue.steps.slice(0, 4).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
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
              <tr>
                {['Page', 'Recherche visée', 'Contenu', ...(GEO_ENABLED ? ['Moteurs IA'] : []), 'Position Google'].map((head) => (
                  <Th key={head}>{head}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pillars.map((page) => {
                const sub = audit.subpages.find((item) => item.id === page.id)
                const confidence = audit.inspections[page.id]?.editorial.queryConfidence
                return (
                  <tr key={page.id} className="break-inside-avoid">
                    <th scope="row" className={`${TD} text-left font-normal`} style={{ borderColor: INK.line }}>
                      <span className="block font-bold">{page.title}</span>
                      <span className="block font-mono text-xs" style={{ color: INK.muted }}>
                        {page.path} · {page.roleLabel}
                      </span>
                    </th>
                    <td className={TD} style={{ borderColor: INK.line }}>
                      « {page.targetKeyword} »
                      <span className="block text-xs" style={{ color: INK.muted }}>
                        {confidence === 'MANUAL' ? 'saisie' : confidence === 'CONFIRMED' ? 'confirmée par Google' : 'non confirmée'}
                      </span>
                    </td>
                    {[page.editorialScore, ...(GEO_ENABLED ? [page.geoScore] : [])].map((score, i) => (
                      <td key={i} className={`${TD} w-36`} style={{ borderColor: INK.line }}>
                        {score === null ? <span style={{ color: INK.muted }}>Non notée</span> : <ScoreBar score={score} />}
                      </td>
                    ))}
                    <td className={`${TD} font-semibold`} style={{ borderColor: INK.line }}>
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
                <div key={page.id} className="break-inside-avoid rounded-2xl border p-4" style={{ borderColor: INK.line }}>
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold">
                      {page.title} <span className="font-mono text-xs font-normal" style={{ color: INK.muted }}>{page.path}</span>
                    </span>
                    <Chip tone="info">
                      Visible sur {visible} {visible > 1 ? 'recherches' : 'recherche'} sur {queries.length}
                    </Chip>
                  </p>
                  <ul className="mt-2 flex flex-col text-sm">
                    {queries.map((serp) => (
                      <li key={serp.query} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t py-1.5" style={{ borderColor: INK.line }}>
                        <span>« {serp.query} »</span>
                        <span>
                          <strong>{positionText(serp)}</strong>
                          <span style={{ color: INK.muted }}> · {describePagePosition(serp).detail}</span>
                        </span>
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
                <tr>
                  {['Zone', 'Pages dédiées', 'Visible dans Google', 'Meilleure position', 'Pack local'].map((head) => (
                    <Th key={head}>{head}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {audit.localVisibility.zones.map(({ zone, coverage, measures }) => (
                  <tr key={zone.id} className="break-inside-avoid">
                    <th scope="row" className={`${TD} text-left`} style={{ borderColor: INK.line }}>
                      {zone.label}
                      {zone.city && (
                        <span className="block text-xs font-normal" style={{ color: INK.muted }}>
                          depuis {zone.city.name}
                        </span>
                      )}
                    </th>
                    <td className={TD} style={{ borderColor: INK.line, color: coverage.length === 0 ? INK.infoText : undefined }}>
                      {coverage.length === 0 ? 'Aucune page dédiée' : coverage.slice(0, 3).map((page) => page.path).join(', ')}
                    </td>
                    <td className={TD} style={{ borderColor: INK.line }}>
                      {measures.measured === 0 ? 'Non mesurée' : `${measures.visible} sur ${measures.measured}`}
                    </td>
                    <td className={TD} style={{ borderColor: INK.line }}>
                      {measures.best ? `n°${measures.best.rank} sur « ${measures.best.query} »` : '—'}
                    </td>
                    <td className={TD} style={{ borderColor: INK.line }}>
                      {packText(measures)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {audit.localVisibility.establishments.length > 0 && (
            <Callout>
              <strong>{count(audit.localVisibility.establishments.length, 'établissement repéré', 'établissements repérés')}</strong>, dont{' '}
              {audit.localVisibility.establishments.filter((item) => item.schemaConsistent === false).length} avec des
              coordonnées différentes du balisage
              {complete
                ? ` : ${audit.localVisibility.establishments.map((item) => `${item.city} (${item.postalCode})`).join(', ')}.`
                : '.'}
            </Callout>
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
          <dl className="grid grid-cols-3 gap-4">
            {[
              { label: 'sites qui font un lien', value: String(summary.domains) },
              { label: 'liens retrouvés sur les sites vérifiés', value: `${summary.found} / ${summary.verified}` },
              { label: 'pages du site avec un lien vérifié', value: summary.targets > 0 ? String(summary.targets) : '—' },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse rounded-2xl border p-4" style={{ borderColor: INK.line, borderTop: `5px solid ${INK.info}` }}>
                <dt className="mt-1 text-xs font-semibold" style={{ color: INK.muted }}>
                  {stat.label}
                </dt>
                <dd className="text-3xl font-extrabold leading-none">{stat.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm leading-relaxed">
            <strong>Principaux sites : </strong>
            {backlinks.referringDomains.slice(0, complete ? 30 : 12).map((item) => item.domain).join(', ')}
            {backlinks.referringDomains.length > (complete ? 30 : 12) ? '…' : ''}
          </p>
          {summary.found > 0 && (
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr>
                  {['Site', 'Page qui fait le lien', 'Ancre', 'Lien'].map((head) => (
                    <Th key={head}>{head}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {backlinks.referringDomains
                  .filter((item) => item.verification?.status === 'FOUND')
                  .map((item) => {
                    const link = item.verification!.links[0]
                    return (
                      <tr key={item.domain} className="break-inside-avoid">
                        <th scope="row" className={`${TD} text-left font-bold`} style={{ borderColor: INK.line }}>
                          {item.domain}
                        </th>
                        <td className={`${TD} break-all font-mono text-xs`} style={{ borderColor: INK.line }}>
                          {link.sourceUrl}
                        </td>
                        <td className={TD} style={{ borderColor: INK.line }}>
                          {link.anchor ? `« ${link.anchor} »` : 'Image'}
                        </td>
                        <td className={TD} style={{ borderColor: INK.line }}>
                          <Chip tone={link.nofollow ? 'neutral' : 'good'}>{link.nofollow ? 'Non suivi' : 'Suivi'}</Chip>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
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
              <div key={severity} className="mt-5">
                <h3 className="flex items-center gap-2 break-after-avoid text-base font-bold">
                  <Chip tone={SEVERITY[severity].tone}>{SEVERITY[severity].label}</Chip>
                  {count(issues.length, 'anomalie', 'anomalies')}
                </h3>
                <ul className="mt-2 flex flex-col text-sm">
                  {issues.map((issue) => (
                    <li key={issue.id} className="break-inside-avoid border-t py-2.5" style={{ borderColor: INK.line }}>
                      <p className="flex flex-wrap items-baseline justify-between gap-2">
                        <strong>{issue.title}</strong>
                        <span className="text-xs font-semibold" style={{ color: INK.muted }}>
                          {count(issue.impactCount ?? 0, 'page', 'pages')}
                        </span>
                      </p>
                      {issue.recommendation && (
                        <span className="mt-0.5 block leading-relaxed" style={{ color: INK.muted }}>
                          {issue.recommendation}
                        </span>
                      )}
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
        <ul className="list-disc pl-5 text-sm leading-relaxed">
          <li>Le robot d’Auditly a exploré le site comme Google, en suivant les liens depuis la page d’accueil.</li>
          <li>Les vitesses d’affichage viennent de Google PageSpeed Insights. Les recherches visées sont vérifiées dans les suggestions Google.</li>
          <li>Le contenu des pages stratégiques est jugé par une IA avec des grilles fixes ; quand c’est possible, le code vérifie et compte lui-même.</li>
          <li>Un critère impossible à mesurer est retiré du calcul au lieu d’être compté juste ou faux.</li>
          <li>Une bonne note améliore le site ; elle ne garantit pas une place en première page, qui dépend aussi des concurrents et de la popularité.</li>
        </ul>
        {complete && (
          <dl className="mt-4 grid grid-cols-[170px_1fr] gap-x-4 text-sm">
            {[
              ['Recherche visée', 'La recherche Google sur laquelle une page doit se positionner.'],
              ['Title', 'Le titre affiché en bleu dans les résultats Google.'],
              ['Méta description', 'Le court texte sous le titre dans les résultats Google.'],
              ['LCP', 'Temps d’affichage du contenu principal ; bon sous 2,5 secondes.'],
              ...(GEO_ENABLED ? [['Moteurs IA (GEO)', 'ChatGPT, Perplexity, Google AI Overviews : leur capacité à citer vos pages.']] : []),
              ['Lien suivi / non suivi', 'Un lien « non suivi » (nofollow) transmet peu de popularité aux yeux de Google.'],
            ].map(([term, definition]) => (
              <div key={term} className="contents">
                <dt className="border-t py-1.5 font-bold" style={{ borderColor: INK.line }}>
                  {term}
                </dt>
                <dd className="border-t py-1.5" style={{ borderColor: INK.line, color: INK.muted }}>
                  {definition}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-6 text-xs" style={{ color: INK.muted }}>
          Rapport généré par Auditly le {date}.
        </p>
      </section>
    </article>,
    document.body,
  )
}
