'use client'

import { createPortal } from 'react-dom'
import type { InspectionData, InspectionItemData, ProjectAuditData } from '@/lib/audit-data'
import { describePagePosition } from '@/lib/serp-labels'
import { EmptyGauge, Gauge, INK, SectionTitle } from './print-kit'
import { IMPACT, SEVERITY } from './report-print-sheet'

/** Statut d'un constat : mot écrit et couleur (la couleur n'est jamais seule) */
const STATUS: Record<InspectionItemData['status'], { label: string; color: string }> = {
  valid: { label: 'OK', color: INK.good },
  warning: { label: 'À améliorer', color: INK.mid },
  error: { label: 'Problème', color: INK.bad },
  info: { label: 'Info', color: INK.info },
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
}

function coverageText(coverage?: { measured: number; total: number }) {
  return coverage && coverage.measured < coverage.total ? `calculée sur ${coverage.measured} des ${coverage.total} points` : undefined
}

function BlockView({ block }: { block: Block }) {
  return (
    <div className="mt-3 break-inside-avoid rounded-xl border p-3" style={{ borderColor: INK.line }}>
      <h4 className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-bold">
        {block.title}
        <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: INK.soft }}>
          {block.scoreText}
        </span>
      </h4>
      {block.verdict && <p className="mt-1 text-sm">{block.verdict}</p>}
      {block.action && (
        <p className="mt-1 rounded-md border-l-4 px-2 py-1 text-sm" style={{ borderColor: INK.brand, background: INK.soft }}>
          <strong>À faire : </strong>
          {block.action}
        </p>
      )}
      {block.items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {block.items.map((item, i) => (
            <li key={i}>
              <strong style={{ color: STATUS[item.status].color }}>{STATUS[item.status].label}</strong>
              {item.source && <span style={{ color: INK.muted }}> [{SOURCE[item.source]}]</span>} : {item.text}
              {item.details && item.details.length > 0 && (
                <ul className="mt-0.5 list-[circle] pl-5 text-xs" style={{ color: INK.muted }}>
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
            </li>
          ))}
        </ul>
      )}
      {block.schemaSnippet && (
        <div className="mt-2">
          <p className="text-xs font-semibold">
            Balisage {block.schemaSnippet.type} à intégrer (champs « [À COMPLÉTER] » à renseigner) :
          </p>
          <pre className="mt-1 whitespace-pre-wrap break-all rounded-md p-2 font-mono text-[10px]" style={{ background: INK.soft }}>
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
    .filter((pillar) => pillar === 'tech' || aiAvailable)
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
    { label: 'Profondeur', value: details.depthLevel < 0 ? 'Hors liens (sitemap)' : `${details.depthLevel} clic(s) depuis l’accueil` },
    { label: 'Liens entrants', value: `${details.inlinks} page(s) du site` },
  ]

  const pillars: { key: 'tech' | 'editorial' | 'geo'; title: string; blocks: Block[] }[] = [
    { key: 'tech', title: 'Technique', blocks: inspection.tech.accordions },
    ...(aiAvailable
      ? [
          { key: 'editorial' as const, title: 'Contenu (SEO éditorial)', blocks: editorial.accordions },
          { key: 'geo' as const, title: 'Moteurs IA (GEO)', blocks: inspection.geo.accordions },
        ]
      : []),
  ]
  let section = 0

  return createPortal(
    <article id="page-print-sheet" className="print-sheet text-[#111]" lang="fr">
      {/* ------------------------------------------------ En-tête */}
      <header className="border-b-4 pb-4" style={{ borderColor: INK.brand }}>
        <p className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: INK.muted }}>
          Auditly · Fiche de page · {audit.domain} · {date}
        </p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight">{inspection.title}</h1>
        <p className="mt-1 break-all font-mono text-sm" style={{ color: INK.muted }}>
          {inspection.url}
        </p>
        <p className="mt-2 text-sm">
          {isPillar ? 'Page stratégique' : 'Page explorée (non stratégique)'}
          {aiAvailable && ` · Rôle : ${editorial.roleLabel}`}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap justify-center gap-10">
        <Gauge score={inspection.tech.score} label="Technique" caption={coverageText(inspection.tech.coverage)} />
        {aiAvailable ? (
          <>
            <Gauge score={editorial.score} label="Contenu" caption={coverageText(editorial.coverage)} />
            <Gauge score={inspection.geo.score} label="Moteurs IA" caption={coverageText(inspection.geo.coverage)} />
          </>
        ) : (
          <>
            <EmptyGauge label="Contenu" reason={isPillar ? 'Non analysé' : 'Page non stratégique'} />
            <EmptyGauge label="Moteurs IA" reason={isPillar ? 'Non analysé' : 'Page non stratégique'} />
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
                className="break-inside-avoid rounded-lg border p-2.5 text-sm"
                style={{ borderColor: INK.line, borderLeft: `5px solid ${priority.type === 'alert' ? INK.bad : INK.mid}` }}
              >
                <span className="font-bold">{index + 1}. </span>
                <span className="text-xs font-semibold" style={{ color: INK.muted }}>
                  {PILLAR_LABEL[priority.pillar]} · {priority.type === 'alert' ? 'À corriger' : 'À optimiser'}
                  {priority.affectsScore && priority.maxPoints ? ` · jusqu’à ${priority.maxPoints} pts` : ''}
                </span>
                <span className="block">{priority.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ------------------------------------------------ Recherche Google */}
      {(aiAvailable || measuredQueries.length > 0) && (
        <section className="report-section">
          <SectionTitle number={++section} title="Recherche Google" />
          <dl className="grid grid-cols-[170px_1fr] gap-x-4 gap-y-1.5 text-sm">
            {aiAvailable && (
              <>
                <dt className="font-semibold">Recherche visée</dt>
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
                <dt className="font-semibold">Autres recherches</dt>
                <dd>
                  {otherCandidates
                    .map((candidate) => `« ${candidate.query} »${candidate.suggestedByGoogle ? ' (suggérée par Google)' : ''}`)
                    .join(', ')}
                </dd>
              </>
            )}
            {aiAvailable && editorial.intentSummary && (
              <>
                <dt className="font-semibold">Intention</dt>
                <dd>{editorial.intentSummary.verdict}</dd>
              </>
            )}
            {measuredQueries.map((serp) => (
              <div key={serp.query} className="contents">
                <dt className="font-semibold">Position « {serp.query} »</dt>
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
      {aiAvailable && search?.snippet.suggestedTitle && (
        <section className="report-section">
          <SectionTitle number={++section} title="Textes prêts à copier" intro="Proposés par l’IA, à relire avant publication." />
          <div className="flex flex-col gap-2 text-sm">
            {[
              { label: 'Title suggéré', value: search.snippet.suggestedTitle, hint: 'idéal 45 à 60 caractères' },
              { label: 'Méta description suggérée', value: search.snippet.suggestedMeta, hint: 'idéal 130 à 155 caractères' },
            ].map((deliverable) => (
              <div key={deliverable.label} className="break-inside-avoid rounded-lg p-3" style={{ background: INK.soft }}>
                <p className="text-xs font-semibold" style={{ color: INK.muted }}>
                  {deliverable.label} · {deliverable.value.length} caractères ({deliverable.hint})
                </p>
                <p className="mt-0.5">{deliverable.value}</p>
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
                  className="w-44 border px-3 py-1.5 text-left align-top"
                  style={{ borderColor: INK.line, background: INK.soft }}
                >
                  {row.label}
                </th>
                <td className="break-all border px-3 py-1.5" style={{ borderColor: INK.line }}>
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
                className="break-inside-avoid rounded-lg border p-3"
                style={{ borderColor: INK.line, borderLeft: `5px solid ${SEVERITY[issue.severity].color}` }}
              >
                <p>
                  <strong>{issue.title}</strong>{' '}
                  <span className="text-xs font-semibold" style={{ color: SEVERITY[issue.severity].color }}>
                    {SEVERITY[issue.severity].label} · {IMPACT[issue.impact] ?? ''}
                  </span>
                </p>
                {issue.description && <p className="mt-1">{issue.description}</p>}
                {issue.recommendation && (
                  <p className="mt-1">
                    <strong>À faire : </strong>
                    {issue.recommendation}
                  </p>
                )}
                {issue.steps && issue.steps.length > 0 && (
                  <ol className="mt-1 list-decimal pl-5">
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
