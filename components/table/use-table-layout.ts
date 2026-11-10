'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clampWidth,
  defaultLayout,
  isDefaultLayout,
  mergeLayout,
  moveColumn,
  stickyOffsets,
  toggleHidden,
  togglePinned,
  visibleColumns,
  type TableColumn,
  type TableLayout,
} from '@/lib/table-layout'

/**
 * Disposition d'un tableau propre à chaque utilisateur, gardée dans ce navigateur (`auditly:tableau:<clé>`) : un
 * stockage indisponible (navigation privée) laisse la disposition par défaut, sans erreur. `announce` reçoit une
 * phrase à lire aux lecteurs d'écran après chaque changement.
 */
export function useTableLayout(key: string, columns: TableColumn[]) {
  const storageKey = `auditly:tableau:${key}`
  const [layout, setLayout] = useState<TableLayout>(() => defaultLayout(columns))
  const [announcement, setAnnouncement] = useState('')

  // Lecture après le premier rendu : le rendu serveur et le premier rendu navigateur restent identiques. Rien n'est
  // écrit ici : seul un changement fait par l'utilisateur enregistre (un effet d'écriture au montage, joué deux fois
  // en développement, écrasait la disposition enregistrée par celle par défaut)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      setLayout(mergeLayout(raw ? JSON.parse(raw) : null, columns))
    } catch {
      setLayout(defaultLayout(columns))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // Colonnes qui changent après la lecture (métriques qui dépendent de l'audit, chargé après le premier rendu) : la
  // disposition enregistrée est relue, sinon une colonne choisie mais encore inconnue à la première lecture serait
  // perdue ; sans enregistrement, la disposition courante est remise d'aplomb
  const columnsKey = columns.map((column) => column.id).join('|')
  const firstColumns = useRef(columnsKey)
  useEffect(() => {
    if (firstColumns.current === columnsKey) return
    firstColumns.current = columnsKey
    setLayout((value) => {
      try {
        const raw = window.localStorage.getItem(storageKey)
        if (raw) return mergeLayout(JSON.parse(raw), columns)
      } catch {
        // Stockage illisible : la disposition courante sert de base
      }
      return mergeLayout(value, columns)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey])

  const byId = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns])
  const labelOf = useCallback((id: string) => byId.get(id)?.label ?? id, [byId])
  const shown = useMemo(() => visibleColumns(layout, columns), [layout, columns])
  const offsets = useMemo(() => stickyOffsets(layout, shown), [layout, shown])

  // Disposition courante lue hors du rendu : deux changements rapprochés partent bien l'un de l'autre
  const current = useRef(layout)
  current.current = layout
  const update = useCallback((next: (value: TableLayout) => TableLayout, message?: (after: TableLayout) => string) => {
    const after = next(current.current)
    if (after === current.current) return
    current.current = after
    setLayout(after)
    if (message) setAnnouncement(message(after))
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(after))
    } catch {
      // Stockage indisponible : la disposition vaut pour cette visite seulement
    }
  }, [storageKey])

  return {
    layout,
    shown,
    offsets,
    announcement,
    isDefault: isDefaultLayout(layout, columns),
    widthOf: (id: string) => layout.widths[id] ?? byId.get(id)?.width ?? 120,
    totalWidth: shown.reduce((sum, column) => sum + (layout.widths[column.id] ?? column.width), 0),
    move: (id: string, index: number) =>
      update(
        (current) => moveColumn(current, id, index),
        (after) => {
          const rank = visibleColumns(after, columns).filter((column) => !column.fixed).findIndex((column) => column.id === id)
          return `Colonne ${labelOf(id)} déplacée en position ${rank + 1}`
        },
      ),
    toggleHidden: (id: string) =>
      update(
        (current) => toggleHidden(current, id),
        (after) => `Colonne ${labelOf(id)} ${after.hidden.includes(id) ? 'masquée' : 'affichée'}`,
      ),
    showAll: () => update((current) => ({ ...current, hidden: [] }), () => 'Toutes les colonnes affichées'),
    togglePinned: (id: string) =>
      update(
        (current) => togglePinned(current, id),
        (after) => `Colonne ${labelOf(id)} ${after.pinned.includes(id) ? 'épinglée à gauche' : 'détachée'}`,
      ),
    setWidth: (id: string, width: number, announce = false) => {
      const column = byId.get(id)
      if (!column || column.fixed) return
      update(
        (current) => {
          const value = clampWidth(column, width)
          return value === current.widths[id] ? current : { ...current, widths: { ...current.widths, [id]: value } }
        },
        announce ? (after) => `Colonne ${labelOf(id)} : ${after.widths[id]} pixels` : undefined,
      )
    },
    reset: () => update(() => defaultLayout(columns), () => 'Disposition par défaut rétablie'),
  }
}

export type TableLayoutApi = ReturnType<typeof useTableLayout>
