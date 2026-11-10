'use client'

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { GripVertical, Pin } from 'lucide-react'
import { groupOf, WIDTH_STEP, type TableColumn } from '@/lib/table-layout'
import type { TableLayoutApi } from './use-table-layout'

export type ColumnSpec<T> = TableColumn & {
  /** Contenu de l'en-tête (le libellé par défaut) */
  header?: ReactNode
  cell: (row: T) => ReactNode
  /** Classes ajoutées à chaque cellule de la colonne */
  cellClassName?: string
  /** Cellule d'en-tête de ligne (`<th scope="row">`) plutôt que `<td>` */
  rowHeader?: boolean
}

const FLIP_MS = 220
const DRAG_THRESHOLD = 4

type Drag = {
  id: string
  pointerId: number
  startX: number
  started: boolean
  dx: number
  /** Colonnes du même groupe (épinglées ou non) visibles, et leur position de départ */
  group: { id: string; left: number; width: number }[]
  target: number
}

/**
 * Tableau personnalisable : colonnes déplacées en glissant leur en-tête (les autres glissent pour faire place),
 * largeur tirée au bord droit de l'en-tête (double clic : ajustée au contenu), colonnes épinglées collées à gauche
 * avec une ombre quand le tableau défile, et tout au clavier depuis un en-tête (voir le pied du
 * tableau). La disposition vient de `useTableLayout`.
 */
export function CustomizableTable<T>({
  api,
  columns,
  rows,
  rowKey,
  rowClassName,
  rowSelected,
  ariaLabel,
  empty,
  expandedRow,
  rowActive,
  onRowClick,
}: {
  api: TableLayoutApi
  columns: ColumnSpec<T>[]
  rows: T[]
  rowKey: (row: T) => string
  rowClassName?: (row: T) => string
  rowSelected?: (row: T) => boolean
  ariaLabel: string
  empty?: ReactNode
  /** Contenu déplié sous une ligne (toute la largeur visible du tableau), ou null */
  expandedRow?: (row: T) => ReactNode | null
  /** Ligne active (fiche ouverte, ou choisie au clavier) : fond teinté et trait à gauche */
  rowActive?: (row: T) => boolean
  /** Clic sur une ligne, hors bouton, lien, champ ou case : ouvre la fiche de la ligne */
  onRowClick?: (row: T) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [indicator, setIndicator] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  // Colonnes cachées à droite (le tableau défile) : un fondu au bord droit l'indique
  const [moreRight, setMoreRight] = useState(false)
  /** État du défilement relu au défilement et quand la largeur change (fiche ouverte ou étirée à côté) */
  const syncScroll = () => {
    const element = scrollRef.current
    if (!element) return
    setScrolled(element.scrollLeft > 0)
    setMoreRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 1)
  }
  // Colonnes ajoutées, masquées ou élargies : le fondu de droite et l'ombre de la colonne épinglée sont recalculés
  useEffect(() => {
    syncScroll()
  })
  // Largeur visible du tableau : le contenu déplié sous une ligne reste dans la vue quand le tableau défile
  const [viewWidth, setViewWidth] = useState<number | null>(null)
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setViewWidth(element.clientWidth)
      syncScroll()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const skipFlip = useRef<string | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const previousLefts = useRef<Map<string, number>>(new Map())
  const previousKey = useRef('')

  const byId = new Map(columns.map((column) => [column.id, column]))
  const shown = api.shown.map((column) => byId.get(column.id)!).filter(Boolean)
  const { layout, offsets } = api
  const lastSticky = [...shown].reverse().find((column) => offsets[column.id] !== undefined)?.id
  const orderKey = `${layout.order.join(',')}|${layout.pinned.join(',')}|${layout.hidden.join(',')}`

  const cellsOf = (id: string) =>
    Array.from(tableRef.current?.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(id)}"]`) ?? [])
  const headerOf = (id: string) => tableRef.current?.querySelector<HTMLElement>(`th[data-col="${CSS.escape(id)}"]`) ?? null

  // Animation des colonnes qui changent de place (FLIP) ; focus rendu à l'en-tête déplacé au clavier
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    const origin = table.getBoundingClientRect().left
    const lefts = new Map<string, number>()
    for (const th of Array.from(table.querySelectorAll<HTMLElement>('thead th[data-col]'))) {
      lefts.set(th.dataset.col!, th.getBoundingClientRect().left - origin)
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (previousKey.current && previousKey.current !== orderKey && !reduce) {
      for (const [id, left] of lefts) {
        const before = previousLefts.current.get(id)
        if (before === undefined || before === left || id === skipFlip.current) continue
        for (const cell of cellsOf(id)) {
          cell.animate([{ transform: `translateX(${before - left}px)` }, { transform: 'translateX(0)' }], {
            duration: FLIP_MS,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          })
        }
      }
    }
    skipFlip.current = null
    previousLefts.current = lefts
    previousKey.current = orderKey
    if (pendingFocus.current) {
      headerOf(pendingFocus.current)?.focus()
      pendingFocus.current = null
    }
  })

  /** Largeur ajustée au contenu le plus large de la colonne (en-tête compris) */
  const autoFit = (id: string) => {
    let widest = 0
    for (const cell of cellsOf(id)) {
      const content = (cell.firstElementChild as HTMLElement | null) ?? cell
      const style = getComputedStyle(cell)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      widest = Math.max(widest, content.scrollWidth + padding + (cell.tagName === 'TH' ? 28 : 4))
    }
    if (widest > 0) api.setWidth(id, widest, true)
  }

  // ----- Glisser un en-tête pour déplacer sa colonne
  const startDrag = (event: PointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-resize], button, a, input')) return
    const table = tableRef.current
    if (!table) return
    const origin = table.getBoundingClientRect().left
    const group = groupOf(layout, id).map((item) => {
      const rect = headerOf(item)?.getBoundingClientRect()
      return { id: item, left: (rect?.left ?? 0) - origin, width: rect?.width ?? 0 }
    })
    dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, started: false, dx: 0, group, target: group.findIndex((item) => item.id === id) }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.dx = event.clientX - drag.startX
    if (!drag.started) {
      if (Math.abs(drag.dx) < DRAG_THRESHOLD) return
      drag.started = true
      setDraggingId(drag.id)
      for (const cell of cellsOf(drag.id)) cell.classList.add('col-lifted')
    }
    const self = drag.group.find((item) => item.id === drag.id)!
    const first = drag.group[0]
    const last = drag.group[drag.group.length - 1]
    // La colonne reste dans son groupe : bornée entre la première et la dernière place du groupe
    const dx = Math.max(first.left - self.left, Math.min(last.left + last.width - self.width - self.left, drag.dx))
    for (const cell of cellsOf(drag.id)) cell.style.transform = `translateX(${dx}px)`
    const center = self.left + dx + self.width / 2
    const others = drag.group.filter((item) => item.id !== drag.id)
    drag.target = others.filter((item) => item.left + item.width / 2 < center).length
    const before = others[drag.target - 1]
    setIndicator(drag.target === 0 ? first.left : before.left + before.width)
  }

  const endDrag = (event: PointerEvent<HTMLElement>, cancel = false) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (!drag.started) return
    for (const cell of cellsOf(drag.id)) {
      cell.classList.remove('col-lifted')
      cell.style.transform = ''
    }
    setIndicator(null)
    setDraggingId(null)
    if (!cancel) {
      skipFlip.current = drag.id
      api.move(drag.id, drag.target)
    }
  }

  // ----- Tirer le bord droit d'un en-tête pour changer la largeur
  const startResize = (event: PointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = api.widthOf(id)
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: globalThis.PointerEvent) => api.setWidth(id, startWidth + move.clientX - startX)
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  // ----- Clavier sur un en-tête
  const onHeaderKey = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (event.target !== event.currentTarget) return
    const movable = shown.filter((column) => !column.fixed)
    const index = movable.findIndex((column) => column.id === id)
    const arrow = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    let handled = true
    if (arrow && event.altKey) {
      const group = groupOf(layout, id)
      pendingFocus.current = id
      api.move(id, group.indexOf(id) + arrow)
    } else if (arrow && event.shiftKey) {
      api.setWidth(id, api.widthOf(id) + arrow * WIDTH_STEP, true)
    } else if (arrow) {
      const next = movable[index + arrow]
      if (next) headerOf(next.id)?.focus()
    } else if (event.key === 'e' || event.key === 'E') {
      pendingFocus.current = id
      api.togglePinned(id)
    } else if (event.key === 'm' || event.key === 'M') {
      const neighbour = movable[index + 1] ?? movable[index - 1]
      if (neighbour) pendingFocus.current = neighbour.id
      api.toggleHidden(id)
    } else if (event.key === 'Enter') {
      autoFit(id)
    } else if (event.key === 'Escape' && dragRef.current) {
      endDrag({ pointerId: dragRef.current.pointerId } as PointerEvent<HTMLElement>, true)
    } else {
      handled = false
    }
    if (handled) event.preventDefault()
  }

  const stickyStyle = (id: string, header: boolean): CSSProperties | undefined =>
    offsets[id] === undefined ? undefined : { position: 'sticky', left: offsets[id], zIndex: header ? 4 : 2 }
  const stickyClass = (id: string) =>
    offsets[id] === undefined ? '' : `ct-sticky ${id === lastSticky && scrolled ? 'ct-sticky-edge' : ''}`

  return (
    <div className="relative">
    <div ref={scrollRef} className="relative overflow-x-auto" onScroll={syncScroll}>
      <table
        ref={tableRef}
        aria-label={ariaLabel}
        className={`ct-table table-fixed border-separate border-spacing-0 text-left ${draggingId ? 'select-none' : ''} ${scrolled ? 'is-scrolled' : ''}`}
        style={{ width: api.totalWidth }}
      >
        <colgroup>
          {shown.map((column) => (
            <col key={column.id} style={{ width: api.widthOf(column.id) }} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-sm text-foreground">
            {shown.map((column, index) => {
              const pinned = layout.pinned.includes(column.id)
              const first = index === 0
              const lastOne = index === shown.length - 1
              return (
                <th
                  key={column.id}
                  scope="col"
                  data-col={column.id}
                  tabIndex={column.fixed ? undefined : 0}
                  aria-label={column.fixed ? undefined : `${column.label}${pinned ? ', épinglée' : ''} : glisser pour déplacer`}
                  onPointerDown={column.fixed ? undefined : (event) => startDrag(event, column.id)}
                  onPointerMove={column.fixed ? undefined : moveDrag}
                  onPointerUp={column.fixed ? undefined : (event) => endDrag(event)}
                  onPointerCancel={column.fixed ? undefined : (event) => endDrag(event, true)}
                  onKeyDown={column.fixed ? undefined : (event) => onHeaderKey(event, column.id)}
                  style={stickyStyle(column.id, true)}
                  className={`ct-head group/head relative bg-shade-38 px-4 py-3.5 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                    first ? 'rounded-l-xl' : ''
                  } ${lastOne ? 'rounded-r-xl' : ''} ${column.fixed ? '' : 'cursor-grab active:cursor-grabbing'} ${stickyClass(column.id)}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {!column.fixed && (
                      <GripVertical
                        className="-ml-2 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/head:opacity-100 group-focus-visible/head:opacity-100"
                        aria-hidden="true"
                      />
                    )}
                    <span className="line-clamp-2 min-w-0 break-words" title={column.label}>
                      {column.header ?? column.label}
                    </span>
                    {pinned && <Pin className="size-3 shrink-0 fill-current text-primary-ink" aria-hidden="true" />}
                  </span>
                  {!column.fixed && (
                    <span
                      data-resize
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Largeur de la colonne ${column.label}`}
                      onPointerDown={(event) => startResize(event, column.id)}
                      onDoubleClick={() => autoFit(column.id)}
                      className="absolute top-2 right-0 bottom-2 z-10 w-2 cursor-col-resize touch-none after:absolute after:top-0 after:right-[3px] after:bottom-0 after:w-[2px] after:rounded-full after:bg-shade-66 after:opacity-0 after:transition-opacity hover:after:opacity-100 group-hover/head:after:opacity-60"
                    />
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const last = rowIndex === rows.length - 1
            const expanded = expandedRow?.(row) ?? null
            return (
              <Fragment key={rowKey(row)}>
              <tr
                data-row-id={rowKey(row)}
                data-selected={rowSelected?.(row) || undefined}
                aria-current={rowActive?.(row) ? 'true' : undefined}
                onClick={
                  onRowClick
                    ? (event) => {
                        if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="checkbox"], [data-resize]')) return
                        if (window.getSelection()?.toString()) return
                        onRowClick(row)
                      }
                    : undefined
                }
                className={`ct-row ${rowActive?.(row) ? 'ct-row-active' : ''} ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row) ?? ''}`}
              >
                {shown.map((column) => {
                  const Cell = column.rowHeader ? 'th' : 'td'
                  return (
                    <Cell
                      key={column.id}
                      {...(column.rowHeader ? { scope: 'row' } : {})}
                      data-col={column.id}
                      style={stickyStyle(column.id, false)}
                      className={`px-4 py-3.5 align-middle font-normal ${last ? '' : 'border-b border-shade-33'} ${stickyClass(column.id)} ${
                        column.cellClassName ?? ''
                      }`}
                    >
                      {column.cell(row)}
                    </Cell>
                  )
                })}
              </tr>
              {expanded && (
                <tr>
                  <td colSpan={shown.length} className="border-b border-shade-33 bg-shade-24 p-0">
                    <div className="sticky left-0 px-4 py-5 md:px-6" style={{ width: viewWidth ?? undefined }}>
                      {expanded}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && empty}
      {indicator !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 z-20 w-[3px] -translate-x-1/2 rounded-full bg-primary"
          style={{ left: indicator + (tableRef.current?.offsetLeft ?? 0) }}
        />
      )}
    </div>
      {/* Fondu au bord droit : d'autres colonnes suivent (défiler, ou fermer la fiche ouverte à côté) */}
      {moreRight && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 bottom-0 z-10 w-12 rounded-r-xl bg-gradient-to-l from-[var(--shade-1e)] to-transparent"
        />
      )}
    </div>
  )
}
