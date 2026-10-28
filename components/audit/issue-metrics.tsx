import type { ReactNode } from 'react'
import type { GlobalIssue } from '@/lib/audit-data'
import { getIssueKind } from '@/lib/issue-routing'
import { TECH_THRESHOLDS } from '@/core/domain/scoring/thresholds'

type ImpactedUrl = NonNullable<GlobalIssue['impactedUrls']>[number]

export type IssueColumn = {
  header: string
  render: (url: ImpactedUrl) => ReactNode
}

// Mêmes seuils que le moteur de scoring : l'anomalie et son détail ne peuvent pas se contredire
const TITLE_RANGE = TECH_THRESHOLDS.title
const META_RANGE = TECH_THRESHOLDS.metaDescription
const H1_RANGE = TECH_THRESHOLDS.h1

type Tone = 'ok' | 'warning' | 'error'

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-[#12b10f]',
  warning: 'bg-[#eab308]',
  error: 'bg-[#ef4444]',
}

function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`size-2.5 rounded-full ${TONE_CLASS[tone]}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function TextValue({ value, empty }: { value?: string; empty: string }) {
  if (!value) return <span className="text-sm text-muted-foreground italic">{empty}</span>
  return (
    <span className="block max-w-[260px] truncate text-sm text-foreground" title={value}>
      {value}
    </span>
  )
}

/** Cellule de balise : contenu actuel, longueur en caractères et statut. */
function TagCell({
  value,
  range,
  emptyLabel,
}: {
  value?: string
  range: { min: number; max: number }
  emptyLabel: string
}) {
  const length = value?.length ?? 0
  let tone: Tone = 'ok'
  let label = 'Conforme'
  if (!value) {
    tone = 'error'
    label = 'Manquante'
  } else if (length < range.min) {
    tone = 'warning'
    label = 'Trop courte'
  } else if (length > range.max) {
    tone = 'warning'
    label = 'Trop longue'
  }

  return (
    <div className="flex flex-col gap-1">
      <TextValue value={value} empty={emptyLabel} />
      <span className="text-xs text-muted-foreground">
        {length} caractère{length > 1 ? 's' : ''} (idéal {range.min}-{range.max})
      </span>
      <StatusDot tone={tone} label={label} />
    </div>
  )
}

/** Liste courte d'éléments : les premiers, puis « +N autres » */
function ShortList({ values, empty, limit = 3 }: { values?: string[]; empty: string; limit?: number }) {
  if (!values || values.length === 0) {
    return <span className="text-sm text-muted-foreground italic">{empty}</span>
  }
  return (
    <ul className="flex max-w-[280px] flex-col gap-0.5">
      {values.slice(0, limit).map((value) => (
        <li key={value} className="truncate font-mono text-xs text-foreground" title={value}>
          {value}
        </li>
      ))}
      {values.length > limit && (
        <li className="text-xs text-muted-foreground">+ {values.length - limit} autre{values.length - limit > 1 ? 's' : ''}</li>
      )}
    </ul>
  )
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Colonnes d'indicateurs (hors colonne URL) adaptées à la nature de l'anomalie. */
export function getIssueColumns(issue: Pick<GlobalIssue, 'pillar' | 'code'>): IssueColumn[] {
  switch (getIssueKind(issue)) {
    case 'tags': {
      if (
        issue.code === 'MISSING_H1' ||
        issue.code === 'MULTIPLE_H1' ||
        issue.code === 'H1_LENGTH_UNOPTIMIZED' ||
        issue.code.startsWith('HEADING_')
      ) {
        return [
          {
            header: 'Balise H1',
            render: ({ details }) => (
              <TextValue value={details.h1} empty="Aucun H1 détecté" />
            ),
          },
          {
            header: 'Longueur',
            render: ({ details }) => (
              <span className="text-sm text-foreground">{details.h1?.length ?? 0} car.</span>
            ),
          },
          {
            header: 'Statut',
            render: ({ details }) =>
              !details.h1 ? (
                <StatusDot tone="error" label="Manquant" />
              ) : issue.code === 'MULTIPLE_H1' ? (
                <StatusDot tone="warning" label="Multiple" />
              ) : issue.code === 'H1_LENGTH_UNOPTIMIZED' ? (
                <StatusDot
                  tone="warning"
                  label={`${details.h1.length > H1_RANGE.max ? 'Trop long' : 'Trop court'} (idéal ${H1_RANGE.min}-${H1_RANGE.max})`}
                />
              ) : (
                <StatusDot tone="warning" label="Hiérarchie à corriger" />
              ),
          },
        ]
      }
      return [
        {
          header: 'Title',
          render: ({ details }) => (
            <TagCell value={details.title} range={TITLE_RANGE} emptyLabel="Aucun title" />
          ),
        },
        {
          header: 'Meta description',
          render: ({ details }) => (
            <TagCell value={details.metaDescription} range={META_RANGE} emptyLabel="Aucune méta description" />
          ),
        },
      ]
    }

    case 'http':
      return [
        {
          header: 'Code HTTP',
          render: ({ details }) => (
            <span
              className={`inline-flex rounded-full px-3 py-0.5 text-xs font-bold text-white ${
                details.httpStatus >= 400 ? 'bg-[#ef4444]' : details.httpStatus >= 300 ? 'bg-[#eab308]' : 'bg-[#12b10f]'
              }`}
            >
              {details.httpStatus || '—'}
            </span>
          ),
        },
        {
          header: 'Redirection',
          render: ({ details }) => (
            <TextValue value={details.redirectUrl} empty="Aucune redirection détectée" />
          ),
        },
        {
          header: 'Temps de réponse',
          render: ({ details }) => <span className="text-sm text-foreground">{details.responseTime}</span>,
        },
      ]

    case 'content':
      return [
        {
          header: 'Mots',
          render: ({ details }) => (
            <span className="text-sm font-semibold text-foreground">{details.wordCount} mots</span>
          ),
        },
      ]

    case 'links':
      return [
        {
          header: 'Profondeur',
          render: ({ details }) => (
            <StatusDot tone={details.depthLevel > 3 ? 'warning' : 'ok'} label={details.depthLevel < 0 ? 'Hors liens (sitemap)' : `Niveau ${details.depthLevel}`} />
          ),
        },
        {
          header: 'Inlinks entrants',
          render: ({ details }) => (
            <StatusDot
              tone={details.inlinks === 0 ? 'error' : details.inlinks < 3 ? 'warning' : 'ok'}
              label={`${details.inlinks} lien${details.inlinks > 1 ? 's' : ''}`}
            />
          ),
        },
        {
          header: 'Pages qui pointent vers elle',
          render: ({ details }) => (
            <ShortList values={details.inlinkSources} empty="Aucune page explorée" />
          ),
        },
      ]

    case 'indexability':
      return [
        {
          header: 'Directive robots',
          render: ({ details }) =>
            details.robots ? (
              <StatusDot
                tone={details.robots.toLowerCase().includes('noindex') ? 'error' : 'ok'}
                label={details.robots}
              />
            ) : (
              <span className="text-sm text-muted-foreground italic">Aucune directive meta robots</span>
            ),
        },
        {
          header: 'Canonical déclarée',
          render: ({ details, fullUrl }) => {
            if (!details.canonical) {
              return <span className="text-sm text-muted-foreground italic">Non déclarée</span>
            }
            const consistent = stripTrailingSlash(details.canonical) === stripTrailingSlash(fullUrl)
            return (
              <div className="flex flex-col gap-1">
                <TextValue value={details.canonical} empty="" />
                <StatusDot
                  tone={consistent ? 'ok' : 'warning'}
                  label={consistent ? 'Identique à l’URL' : 'Différente de l’URL'}
                />
              </div>
            )
          },
        },
      ]

    default:
      return [
        {
          header: 'Statut HTTP',
          render: ({ details }) => <span className="text-sm text-foreground">{details.httpStatus || '—'}</span>,
        },
        {
          header: 'Temps de réponse',
          render: ({ details }) => <span className="text-sm text-foreground">{details.responseTime}</span>,
        },
      ]
  }
}
