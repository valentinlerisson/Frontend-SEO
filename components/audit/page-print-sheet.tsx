'use client'

import { createPortal } from 'react-dom'
import type { InspectionData, ProjectAuditData } from '@/lib/audit-data'

const STATUS_LABEL = { valid: 'OK', warning: 'À améliorer', error: 'Problème', info: 'Info' } as const

function scoreText(score: number, available: boolean) {
  return available ? `${score}/100` : 'Non analysé'
}

/**
 * Gabarit imprimable d'une page inspectée. Monté dans <body> (portail) : la feuille de style
 * `@media print` de globals.css masque tout le reste (sidebar, surcouche, boutons).
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

  const pageIssues = audit.globalIssues.filter((issue) =>
    issue.impactedUrls?.some((url) => url.id === inspection.pageId),
  )

  const tags: { label: string; value: string }[] = [
    { label: 'Code HTTP', value: String(details.httpStatus) },
    { label: 'Redirection', value: details.redirectUrl ?? 'Aucune' },
    { label: 'Temps de réponse', value: details.responseTime },
    { label: 'Indexable', value: inspection.indexable ? 'Oui' : 'Non' },
    { label: 'Directive robots', value: details.robots ?? 'Aucune' },
    { label: 'Canonical', value: details.canonical ?? 'Non déclarée' },
    {
      label: 'Title',
      value: details.title ? `${details.title} (${details.title.length} car.)` : 'Manquant',
    },
    {
      label: 'Méta description',
      value: details.metaDescription
        ? `${details.metaDescription} (${details.metaDescription.length} car.)`
        : 'Manquante',
    },
    { label: 'H1', value: details.h1 ?? 'Manquant' },
    { label: 'Nombre de mots', value: String(details.wordCount) },
    { label: 'Profondeur', value: details.depthLevel < 0 ? 'Hors liens (sitemap)' : `Niveau ${details.depthLevel}` },
    { label: 'Inlinks entrants', value: String(details.inlinks) },
  ]

  const sections = [
    { title: 'Technique & Meta', accordions: inspection.tech.accordions },
    ...(aiAvailable
      ? [
          { title: 'SEO Éditorial', accordions: inspection.editorial.accordions },
          { title: 'GEO (IA)', accordions: inspection.geo.accordions },
        ]
      : []),
  ]

  return createPortal(
    <div id="page-print-sheet" className="text-black">
      <header className="border-b border-black pb-3">
        <p className="text-xs uppercase tracking-wide text-neutral-600">
          Fiche de page · {audit.domain} · {new Date().toLocaleDateString('fr-FR')}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{inspection.title}</h1>
        <p className="mt-1 break-all font-mono text-sm">{inspection.url}</p>
      </header>

      <section className="mt-5">
        <h2 className="text-lg font-bold">Scores</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <tbody>
            <tr>
              <th className="border border-neutral-400 px-3 py-1.5 text-left">Technique</th>
              <td className="border border-neutral-400 px-3 py-1.5">{scoreText(inspection.tech.score, true)}</td>
              <th className="border border-neutral-400 px-3 py-1.5 text-left">Éditorial</th>
              <td className="border border-neutral-400 px-3 py-1.5">
                {scoreText(inspection.editorial.score, aiAvailable)}
              </td>
              <th className="border border-neutral-400 px-3 py-1.5 text-left">GEO</th>
              <td className="border border-neutral-400 px-3 py-1.5">
                {scoreText(inspection.geo.score, aiAvailable)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mt-5">
        <h2 className="text-lg font-bold">État des balises et indicateurs</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <tbody>
            {tags.map((row) => (
              <tr key={row.label}>
                <th className="w-44 border border-neutral-400 px-3 py-1.5 text-left align-top">{row.label}</th>
                <td className="break-all border border-neutral-400 px-3 py-1.5">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-5">
        <h2 className="text-lg font-bold">Anomalies spécifiques à cette page</h2>
        {pageIssues.length === 0 ? (
          <p className="mt-2 text-sm">Aucune anomalie détectée sur cette page.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3 text-sm">
            {pageIssues.map((issue) => (
              <li key={issue.id} className="break-inside-avoid border border-neutral-400 p-3">
                <p className="font-bold">
                  [{issue.severity === 'critical' ? 'Critique' : issue.severity === 'warning' ? 'Avertissement' : 'Info'}]{' '}
                  {issue.title}
                </p>
                <p className="mt-1">{issue.description}</p>
                {issue.recommendation && (
                  <p className="mt-1">
                    <span className="font-semibold">Recommandation : </span>
                    {issue.recommendation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {sections.map((section) => (
        <section key={section.title} className="mt-5">
          <h2 className="text-lg font-bold">{section.title}</h2>
          {section.accordions.length === 0 && <p className="mt-2 text-sm">Aucun détail disponible.</p>}
          {section.accordions.filter((acc) => !('hidden' in acc && acc.hidden)).map((acc) => (
            <div key={acc.title} className="mt-3 break-inside-avoid">
              <h3 className="text-sm font-semibold">
                {acc.title} ({acc.scoreText})
              </h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {acc.items.map((item, i) => (
                  <li key={i}>
                    <span className="font-semibold">{STATUS_LABEL[item.status]} : </span>
                    {item.text}
                    {item.details && item.details.length > 0 && (
                      <ul className="mt-1 list-[circle] pl-5 text-xs">
                        {item.details.slice(0, 60).map((detail, j) => (
                          <li key={j} className="break-all">
                            {detail.label}
                            {detail.tag ? ` [${detail.tag}]` : ''}
                            {detail.note ? ` : ${detail.note}` : ''}
                          </li>
                        ))}
                        {item.details.length > 60 && <li>… et {item.details.length - 60} autres</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>,
    document.body,
  )
}
