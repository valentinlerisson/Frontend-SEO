'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Info, XCircle } from 'lucide-react'
import type { InspectionItemData } from '@/lib/audit-data'

const TEXT_CLASS = {
  valid: 'text-foreground',
  warning: 'text-yellow-pale/90',
  error: 'text-red-pale/90',
  info: 'text-sky-pale/90',
} as const

const SOURCE_LABEL = { measured: 'Mesuré', google: 'Google', ai: 'Estimation IA' } as const

const DOT_CLASS = {
  valid: 'bg-[#12b10f]',
  warning: 'bg-[#eab308]',
  error: 'bg-[#ef4444]',
} as const

/** Nombre d'éléments affichés avant « Tout afficher » */
const PREVIEW_COUNT = 8

/**
 * Ligne d'indicateur du tiroir d'inspection. Quand l'indicateur compte des éléments
 * (images, liens, pages source), la liste est consultable en dessous.
 */
export function InspectionItemRow({ item }: { item: InspectionItemData }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const details = item.details ?? []
  const visible = showAll ? details : details.slice(0, PREVIEW_COUNT)

  return (
    <div>
      <div className="flex items-start gap-2.5">
        {item.status === 'valid' ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-ink" />
        ) : item.status === 'warning' ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-ink" />
        ) : item.status === 'info' ? (
          <Info className="mt-0.5 size-4 shrink-0 text-sky-ink" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-[#ef4444]" />
        )}
        <span className={TEXT_CLASS[item.status]}>{item.text}</span>
        {item.source && (
          <span
            className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
              item.source === 'ai'
                ? 'border-[#38bdf8]/40 text-sky-soft'
                : item.source === 'google'
                  ? 'border-shade-a3/40 text-shade-d4'
                  : 'border-[#12b10f]/40 text-green-soft'
            }`}
          >
            {SOURCE_LABEL[item.source]}
          </span>
        )}
        {details.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-primary-ink hover:underline"
          >
            {open ? 'Masquer' : `Voir le détail (${details.length})`}
            <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {open && details.length > 0 && (
        <ul className="ml-6 mt-2 divide-y divide-shade-2a rounded-lg border border-shade-2f bg-shade-14">
          {visible.map((detail, index) => (
            <li key={index} className="flex items-start gap-2 px-3 py-2">
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT_CLASS[detail.status ?? 'valid']}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-foreground">{detail.label}</p>
                {detail.note && (
                  <p className="break-all text-xs text-muted-foreground">{detail.note}</p>
                )}
              </div>
              {detail.tag && (
                <span className="shrink-0 rounded-full border border-shade-3a px-2 py-0.5 text-[11px] text-muted-foreground">
                  {detail.tag}
                </span>
              )}
              {detail.href && (
                <a
                  href={detail.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Ouvrir dans un nouvel onglet"
                  className="shrink-0 text-muted-foreground hover:text-primary-ink"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </li>
          ))}
          {details.length > PREVIEW_COUNT && (
            <li className="px-3 py-2">
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="text-xs text-primary-ink hover:underline"
              >
                {showAll ? 'Réduire la liste' : `Tout afficher (${details.length})`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
