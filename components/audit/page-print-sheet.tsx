'use client'

import { createPortal } from 'react-dom'
import type { InspectionData, InspectionItemData, ProjectAuditData, QueryMatrixData } from '@/lib/audit-data'
import { describePagePosition } from '@/lib/serp-labels'
import { Callout, Chip, EmptyGauge, Gauge, INK, SectionTitle, count, type Tone } from './print-kit'
import { IMPACT, SEVERITY } from './report-print-sheet'
import { GEO_ENABLED } from '@/core/domain/features'

/** Statut d'un constat : mot écrit et couleur (la couleur n'est jamais seule) */
const STATUS: Record<InspectionItemData['status'], { label: string; tone: Tone }> = {
  valid: { label: 'OK', tone: 'good' },
  warning: { label: 'À améliorer', tone: 'mid' },
  error: { label: 'Problème', tone: 'bad' },
  info: { label: 'Info', tone: 'info' },
}

const SOURCE: Record<NonNullable<InspectionItemData['source']>, string> = {
  measured: 'Mesuré',
  google: 'Google',
  ai: 'Estimation IA',
}

const PILLAR_LABEL = { tech: 'Technique', editorial: 'Contenu', geo: 'Moteurs IA' } as const

type Block = {
  title: string
  scoreText: string
  verdict?: string
  action?: string
  items: InspectionItemData[]
  hidden?: boolean
  schemaSnippet?: { type: string; json: string; placeholders: string[] }
  queries?: QueryMatrixData
}

/** Détail par requête notée, à l'impression : oui / non (grille de l'IA) ou points de chaque zone (mesure) */
function QueryTable({ data }: { data: QueryMatrixData }) {
  const cellText = (cell: QueryMatrixData['rows'][number]['cells'][number]) =>
    cell.earned === null ? '—' : data.source === 'ai' ? (cell.earned > 0 ? 'oui' : 'non') : `${cell.earned}/${cell.max}`
  return (
    <table className="mt-3 w-full border-collapse text-xs">
      <thead>
        <tr style={{ color: INK.muted }}>
          <th className="border-b py-1 pr-2 text-left font-semibold" style={{ borderColor: INK.line }}>
            Requête
          </th>
          {data.columns.map((column) => (
            <th key={column.label} className="border-b px-1 py-1 text-center font-semibold" style={{ borderColor: INK.line }}>
              {column.label} ({column.max})
            </th>
          ))}
          <th className="border-b py-1 pl-2 text-right font-semibold" style={{ borderColor: INK.line }}>
            Note
          </th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => (
          <tr key={row.query}>
            <td className="border-b py-1 pr-2" style={{ borderColor: INK.line }}>
              « {row.query} »{' '}
              <span style={{ color: INK.muted }}>
                ({row.volume !== undefined ? `${row.volume.toLocaleString('fr-FR')}/mois, ` : ''}
                {Math.round(row.weight * 100)} %)
              </span>
            </td>
            {row.cells.map((cell, index) => (
              <td key={index} className="border-b px-1 py-1 text-center" style={{ borderColor: INK.line }}>
                {cellText(cell)}
              </td>
            ))}
            <td className="border-b py-1 pl-2 text-right font-semibold" style={{ borderColor: INK.line }}>
              {row.total === null ? 'à juger' : `${row.total}/${row.max}`}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={data.columns.length + 1} className="py-1 pr-2" style={{ color: INK.muted }}>
            {data.source === 'ai' ? 'Estimation IA. ' : 'Mesuré. '}Note du critère : moyenne des requêtes selon leur poids
          </td>
          <td className="py-1 pl-2 text-right font-bold">
            {data.result.earned}/{data.result.max}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

function coverageText(coverage?: { measured: number; total: number }) {
  return coverage && coverage.measured < coverage.total ? `calculée sur ${coverage.measured} des ${coverage.total} points` : undefined
}

function BlockView({ block }: { block: Block }) {
  return (
    <div className="mt-3 break-inside-avoid rounded-2xl border p-4" style={{ borderColor: INK.line }}>
      <h4 className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-bold">
        {block.title}
        <Chip>{block.scoreText}</Chip>
      </h4>
      {block.verdict && <p className="mt-1.5 text-sm leading-relaxed">{block.verdict}</p>}
      {block.action && <Callout label="À faire :">{block.action}</Callout>}
      {block.queries && <QueryTable data={block.queries} />}
      {block.items.length > 0 && (
        <ul className="mt-3 flex flex-col text-sm">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 border-t py-1.5 leading-relaxed" style={{ borderColor: INK.line }}>
              <span className="mt-0.5 w-[5.5rem] shrink-0">
                <Chip tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Chip>
              </span>
              <span className="min-w-0 flex-1">
                {item.source && (
                  <span className="mr-1 text-xs font-semibold" style={{ color: INK.muted }}>
                    [{SOURCE[item.source]}]
                  </span>
                )}
                {item.text}
                {item.details && item.details.length > 0 && (
                  <ul className="mt-1 list-[circle] pl-5 text-xs" style={{ color: INK.muted }}>
                    {item.details.slice(0, 25).map((detail, j) => (
                      <li key={j} className="break-all">
                        {detail.label}
                        {detail.tag ? ` [${detail.tag}]` : ''}
                        {detail.note ? ` : ${detail.note}` : ''}
                      </li>
                    ))}
                    {item.details.length > 25 && <li>… et {item.details.length - 25} autres (voir l’application)</li>}
                  </ul>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {block.schemaSnippet && (
        <div className="mt-3">
          <p className="text-xs font-semibold">
            Balisage {block.schemaSnippet.type} à intégrer (champs « [À COMPLÉTER] » à renseigner) :
          </p>
          <pre className="mt-1 whitespace-pre-wrap break-all rounded-lg p-3 font-mono text-[10px]" style={{ background: INK.soft }}>
            {block.schemaSnippet.json}
          </pre>
        </div>
      )}
    </div>
  )
}

/**
 * Fiche imprimable d'une page (tiroir d'inspection, « Exporter en PDF »). Montée dans <body> le temps de l'impression
 * (classe print-sheet) : la feuille `@media print` de globals.css masque tout le reste. Même présentation que le
 * rapport d'audit : jauges, points à traiter, recherche Google, textes prêts à copier, puis le détail des trois piliers.
 */
export function PagePrintSheet({
  audit,
  inspection,
  isPillar,
}: {
  audit: ProjectAuditData
  inspection: InspectionData
  isPillar: boolean
}) {
  if (typeof document === 'undefined') return null

  const { details } = inspection
  const aiAvailable = !audit.isLocked && isPillar && inspection.httpStatus < 400 && inspection.indexable
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const subpage = audit.subpages.find((item) => item.id === inspection.pageId)
  const editorial = inspection.editorial
  const search = editorial.search
  // Title et méta prêts à copier : seulement ceux d'une réécriture demandée et à jour (requêtes notées)
  const rewrite = editorial.rewrite && !editorial.rewrite.outdated ? editorial.rewrite : undefined
  const readyTexts = rewrite
    ? { title: rewrite.title.proposed, meta: rewrite.meta.proposed, intro: 'Rédigés par l’IA avec les requêtes notées de la page, à relire avant publication.' }
    : undefined
  const measuredQueries = (subpage?.serpQueries?.length ? subpage.serpQueries : subpage?.serp ? [subpage.serp] : []).filter(
    (serp) => serp.status === 'DONE',
  )
  const otherCandidates = (search?.candidates ?? []).filter((candidate) => candidate.query !== editorial.targetKeyword)

  const severityRank = { critical: 0, warning: 1, passed: 2 } as const
  const pageIssues = audit.globalIssues
    .filter((issue) => issue.impactedUrls?.some((url) => url.id === inspection.pageId))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])

  // Points à traiter des trois piliers, alertes d'abord
  const priorities = (['tech', 'editorial', 'geo'] as const)
    .filter((pillar) => (pillar === 'tech' || aiAvailable) && (pillar !== 'geo' || GEO_ENABLED))
    .flatMap((pillar) => inspection[pillar].priorities.map((priority) => ({ ...priority, pillar })))
    .sort((a, b) => Number(a.type !== 'alert') - Number(b.type !== 'alert'))
    .slice(0, 8)

  const identity: { label: string; value: string }[] = [
    { label: 'Code HTTP', value: String(details.httpStatus) },
    { label: 'Redirection', value: details.redirectUrl ?? 'Aucune' },
    { label: 'Temps de réponse', value: details.responseTime },
    { label: 'Indexable', value: inspection.indexable ? 'Oui' : 'Non' },
    { label: 'Directive robots', value: details.robots ?? 'Aucune' },
    { label: 'Canonique', value: details.canonical ?? 'Non déclarée' },
    { label: 'Title', value: details.title ? `${details.title} (${details.title.length} car.)` : 'Manquant' },
    {
      label: 'Méta description',
      value: details.metaDescription ? `${details.metaDescription} (${details.metaDescription.length} car.)` : 'Manquante',
    },
    { label: 'H1', value: details.h1 ?? 'Manquant' },
    { label: 'Nombre de mots', value: String(details.wordCount) },
    { label: 'Profondeur', value: details.depthLevel < 0 ? 'Hors liens (sitemap)' : `${count(details.depthLevel, 'clic', 'clics')} depuis l’accueil` },
    { label: 'Liens entrants', value: `${count(details.inlinks, 'page', 'pages')} du site` },
  ]

  const pillars: { key: 'tech' | 'editorial' | 'geo'; title: string; blocks: Block[] }[] = [
    { key: 'tech', title: 'Technique', blocks: inspection.tech.accordions },
    ...(aiAvailable
      ? [
          { key: 'editorial' as const, title: 'Contenu (SEO éditorial)', blocks: editorial.accordions },
          ...(GEO_ENABLED ? [{ key: 'geo' as const, title: 'Moteurs IA (GEO)', blocks: inspection.geo.accordions }] : []),
        ]
      : []),
  ]
  let section = 0

  return createPortal(
    <article id={`page-print-sheet-${inspection.pageId}`} className="print-sheet" lang="fr">
      {/* ------------------------------------------------ En-tête */}
      <header>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: INK.muted }}>
          <span aria-hidden="true" className="inline-block size-3 rounded-sm" style={{ background: INK.brand }} />
          Auditly · Fiche de page · {audit.domain} · {date}
        </p>
        <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight">{inspection.title}</h1>
        <p className="mt-1 break-all font-mono text-sm" style={{ color: INK.muted }}>
          {inspection.url}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <Chip tone={isPillar ? 'info' : 'neutral'}>{isPillar ? 'Page stratégique' : 'Page explorée (non stratégique)'}</Chip>
          {aiAvailable && <Chip>Rôle : {editorial.roleLabel}</Chip>}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap justify-center gap-10 rounded-3xl p-6" style={{ background: INK.soft }}>
        <Gauge score={inspection.tech.score} size={124} label="Technique" caption={coverageText(inspection.tech.coverage)} />
        {aiAvailable ? (
          <>
            {editorial.score === null ? (
              <EmptyGauge size={124} label="Contenu" reason="Non notée (contact, légal, utilitaire)" />
            ) : (
              <Gauge score={editorial.score} size={124} label="Contenu" caption={coverageText(editorial.coverage)} />
            )}
            {GEO_ENABLED && <Gauge score={inspection.geo.score} size={124} label="Moteurs IA" caption={coverageText(inspection.geo.coverage)} />}
          </>
        ) : (
          <>
            <EmptyGauge size={124} label="Contenu" reason={isPillar ? 'Non analysé' : 'Page non stratégique'} />
            {GEO_ENABLED && <EmptyGauge size={124} label="Moteurs IA" reason={isPillar ? 'Non analysé' : 'Page non stratégique'} />}
          </>
        )}
      </div>

      {/* ------------------------------------------------ Priorités */}
      {priorities.length > 0 && (
        <section className="report-section">
          <SectionTitle number={++section} title="À traiter en priorité" />
          <ol className="flex flex-col gap-2">
            {priorities.map((priority, index) => (
              <li
                key={`${priority.pillar}-${index}`}
                className="break-inside-avoid rounded-xl border p-3 text-sm"
                style={{ borderColor: INK.line, borderLeft: `6px solid ${priority.type === 'alert' ? INK.bad : INK.mid}` }}
              >
                <p className="flex flex-wrap items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold"
                    style={{ background: INK.text, color: '#fff' }}
                  >
                    {index + 1}
                  </span>
                  <Chip tone={priority.type === 'alert' ? 'bad' : 'mid'}>{priority.type === 'alert' ? 'À corriger' : 'À optimiser'}</Chip>
                  <Chip>{PILLAR_LABEL[priority.pillar]}</Chip>
                  {priority.affectsScore && priority.maxPoints ? <Chip>jusqu’à {priority.maxPoints} pts</Chip> : null}
                </p>
                <span className="mt-1.5 block leading-relaxed">{priority.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ------------------------------------------------ Recherche Google */}
      {(aiAvailable || measuredQueries.length > 0) && (
        <section className="report-section">
          <SectionTitle number={++section} title="Recherche Google" />
          <dl className="grid grid-cols-[170px_1fr] gap-x-4 text-sm leading-relaxed [&_dd]:border-t [&_dd]:py-2 [&_dt]:border-t [&_dt]:py-2 [&_dd]:border-[#e5e7eb] [&_dt]:border-[#e5e7eb]">
            {aiAvailable && (
              <>
                <dt className="font-bold">Recherche visée</dt>
                <dd>
                  « {editorial.targetKeyword} »
                  <span style={{ color: INK.muted }}>
                    {editorial.queryConfidence === 'MANUAL'
                      ? ' · saisie'
                      : editorial.queryConfidence === 'CONFIRMED'
                        ? ' · confirmée par Google'
                        : ' · non confirmée par Google'}
                  </span>
                </dd>
              </>
            )}
            {otherCandidates.length > 0 && (
              <>
                <dt className="font-bold">Autres recherches</dt>
                <dd>
                  {otherCandidates
                    .map((candidate) => `« ${candidate.query} »${candidate.suggestedByGoogle ? ' (suggérée par Google)' : ''}`)
                    .join(', ')}
                </dd>
              </>
            )}
            {aiAvailable && editorial.intentSummary && (
              <>
                <dt className="font-bold">Intention</dt>
                <dd>{editorial.intentSummary.verdict}</dd>
              </>
            )}
            {measuredQueries.map((serp) => (
              <div key={serp.query} className="contents">
                <dt className="font-bold">Position « {serp.query} »</dt>
                <dd>
                  <strong>{describePagePosition(serp).badge}</strong> · {describePagePosition(serp).detail}
                  {serp.fetchedAt ? ` (mesure du ${new Date(serp.fetchedAt).toLocaleDateString('fr-FR')})` : ''}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* ------------------------------------------------ Textes prêts à copier */}
      {aiAvailable && readyTexts && (
        <section className="report-section">
          <SectionTitle number={++section} title="Textes prêts à copier" intro={readyTexts.intro} />
          <div className="flex flex-col gap-2 text-sm">
            {[
              { label: 'Title suggéré', value: readyTexts.title, hint: 'idéal 45 à 60 caractères' },
              { label: 'Méta description suggérée', value: readyTexts.meta, hint: 'idéal 130 à 155 caractères' },
            ].map((deliverable) => (
              <div key={deliverable.label} className="break-inside-avoid rounded-xl p-4" style={{ background: INK.soft, borderLeft: `5px solid ${INK.brand}` }}>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: INK.muted }}>
                  {deliverable.label} · {deliverable.value.length} caractères ({deliverable.hint})
                </p>
                <p className="mt-1 text-base leading-snug">{deliverable.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------ Identité de la page */}
      <section className="report-section">
        <SectionTitle number={++section} title="Identité de la page" />
        <table className="w-full border-collapse text-sm">
          <tbody>
            {identity.map((row) => (
              <tr key={row.label} className="break-inside-avoid">
                <th
                  scope="row"
                  className="w-44 border-b px-3 py-2 text-left align-top text-xs font-bold uppercase tracking-wide"
                  style={{ borderColor: INK.line, background: INK.soft, color: INK.muted }}
                >
                  {row.label}
                </th>
                <td className="break-all border-b px-3 py-2 align-top" style={{ borderColor: INK.line }}>
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ------------------------------------------------ Anomalies */}
      <section className="report-section">
        <SectionTitle number={++section} title="Anomalies de cette page" />
        {pageIssues.length === 0 ? (
          <p className="text-sm">Aucune anomalie détectée sur cette page.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {pageIssues.map((issue) => (
              <li
                key={issue.id}
                className="break-inside-avoid rounded-xl border p-3"
                style={{ borderColor: INK.line, borderLeft: `6px solid ${SEVERITY[issue.severity].color}` }}
              >
                <p className="flex flex-wrap items-center gap-1.5">
                  <strong className="mr-1">{issue.title}</strong>
                  <Chip tone={SEVERITY[issue.severity].tone}>{SEVERITY[issue.severity].label}</Chip>
                  {IMPACT[issue.impact] && <Chip>{IMPACT[issue.impact]}</Chip>}
                </p>
                {issue.description && <p className="mt-1.5 leading-relaxed">{issue.description}</p>}
                {issue.recommendation && <Callout label="À faire :">{issue.recommendation}</Callout>}
                {issue.steps && issue.steps.length > 0 && (
                  <ol className="mt-2 list-decimal pl-6 leading-relaxed">
                    {issue.steps.slice(0, 4).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------ Détail par pilier */}
      {pillars.map((pillar) => (
        <section key={pillar.key} className="report-section">
          <SectionTitle number={++section} title={`Détail : ${pillar.title}`} />
          {pillar.blocks.filter((block) => !block.hidden).length === 0 && <p className="text-sm">Aucun détail disponible.</p>}
          {pillar.blocks
            .filter((block) => !block.hidden)
            .map((block) => (
              <BlockView key={block.title} block={block} />
            ))}
        </section>
      ))}

      <p className="mt-6 text-xs" style={{ color: INK.muted }}>
        Fiche générée par Auditly le {date}. Sources des constats : Mesuré (lu sur la page), Google (résultats ou
        suggestions de recherche), Estimation IA (à confirmer).
      </p>
    </article>,
    document.body,
  )
}
