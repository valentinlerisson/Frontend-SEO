'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileDown, ListChecks } from 'lucide-react'
import type { ProjectAuditData } from '@/lib/audit-data'
import type { SelectionAction, SelectionToast } from '@/components/table/selection-bar'
import { PagePrintSheet } from './page-print-sheet'
import { useFixPlan } from './use-fix-plan'

/**
 * Actions communes à toute sélection de pages (Sous-pages, Positionnement, SEO éditorial) : **Fiches PDF** (une fiche
 * par page, toutes dans un seul PDF) et **Ajouter au plan** (toutes les anomalies de ces pages, une tâche par
 * anomalie et par page, avec « Annuler »). `sheets` est à placer dans la page : les fiches à imprimer.
 */
export function usePageBulkActions({
  projectId,
  audit,
  setToast,
}: {
  projectId: string
  audit: ProjectAuditData | null
  setToast: (toast: SelectionToast | null) => void
}) {
  const router = useRouter()
  const fixPlan = useFixPlan(projectId, { lazy: true })
  const [printIds, setPrintIds] = useState<string[] | null>(null)
  const [adding, setAdding] = useState(false)

  // Fiches montées, puis la fenêtre d'impression s'ouvre ; son titre devient le nom du fichier proposé
  useEffect(() => {
    if (!printIds || !audit) return
    const previous = document.title
    document.title = `Fiches SEO ${audit.domain} (${printIds.length} page${printIds.length > 1 ? 's' : ''}) ${new Date().toISOString().slice(0, 10)}`
    const timer = window.setTimeout(() => {
      window.print()
      document.title = previous
      setPrintIds(null)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [printIds, audit])

  const addToPlan = async (ids: string[]) => {
    if (!audit) return
    const chosen = new Set(ids)
    const items = audit.globalIssues.flatMap((issue) =>
      (issue.impactedUrls ?? []).filter((url) => chosen.has(url.id)).map((url) => ({ code: issue.code, url: url.fullUrl })),
    )
    if (items.length === 0) {
      setToast({ text: 'Aucune anomalie sur ces pages' })
      return
    }
    setAdding(true)
    const added = await fixPlan.addWithIds(items)
    setAdding(false)
    setToast({
      text:
        added.length === 0
          ? 'Ces anomalies sont déjà dans le plan d’action'
          : `${added.length} tâche${added.length > 1 ? 's' : ''} ajoutée${added.length > 1 ? 's' : ''} au plan d’action`,
      actions: [
        ...(added.length > 0
          ? [
              {
                label: 'Annuler',
                onClick: async () => {
                  await fixPlan.undoAdd(added)
                  setToast({ text: 'Ajout annulé' })
                },
              },
            ]
          : []),
        { label: 'Ouvrir le plan', onClick: () => router.push(`/projets/${projectId}/plan`) },
      ],
    })
  }

  /** Les deux actions pour la sélection `ids` */
  const actionsFor = (ids: string[]): SelectionAction[] => [
    {
      id: 'pdf',
      label: 'Fiches PDF',
      icon: <FileDown className="size-4" aria-hidden="true" />,
      title: 'Une fiche par page, dans un seul PDF',
      busy: printIds !== null,
      onClick: () => setPrintIds(ids.filter((id) => audit?.inspections[id])),
    },
    {
      id: 'plan',
      label: 'Ajouter au plan',
      icon: <ListChecks className="size-4" aria-hidden="true" />,
      title: 'Toutes les anomalies de ces pages, une tâche par anomalie et par page',
      busy: adding,
      onClick: () => void addToPlan(ids),
    },
  ]

  const sheets =
    printIds && audit
      ? printIds.map((id) => (
          <PagePrintSheet
            key={id}
            audit={audit}
            inspection={audit.inspections[id]}
            isPillar={Boolean(audit.subpages.find((page) => page.id === id)?.isPillar)}
          />
        ))
      : null

  return { actionsFor, sheets }
}
