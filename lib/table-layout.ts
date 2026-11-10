/**
 * Disposition d'un tableau choisie par l'utilisateur : ordre des colonnes, colonnes masquées, colonnes épinglées à
 * gauche et largeurs. Fonctions pures (testées) ; l'état vit dans `useTableLayout`, gardé dans le navigateur. La
 * densité des lignes (confortable, normale, compacte) a été retirée le 08/11/2026 : écart jugé trop faible.
 */

export interface TableColumn {
  id: string
  label: string
  /** Largeur par défaut en pixels */
  width: number
  minWidth?: number
  maxWidth?: number
  /** Colonne fixe (case de sélection) : toujours visible, en premier, ni déplacée ni redimensionnée */
  fixed?: boolean
  /** Groupe dans le menu des colonnes (« Technique », « Google »…) ; absent : colonne propre au tableau */
  group?: string
  /** Colonne ajoutable, masquée tant que l'utilisateur ne la coche pas */
  defaultHidden?: boolean
  /** Ce que mesure la colonne (infobulle du menu) */
  description?: string
}

export interface TableLayout {
  /** Ordre de toutes les colonnes mobiles, masquées comprises */
  order: string[]
  hidden: string[]
  pinned: string[]
  widths: Record<string, number>
}

export const DEFAULT_MIN_WIDTH = 72
export const DEFAULT_MAX_WIDTH = 640
/** Pas du réglage de largeur au clavier */
export const WIDTH_STEP = 16

const movable = (columns: TableColumn[]) => columns.filter((column) => !column.fixed)

export function defaultLayout(columns: TableColumn[]): TableLayout {
  return {
    order: movable(columns).map((column) => column.id),
    hidden: movable(columns).filter((column) => column.defaultHidden).map((column) => column.id),
    pinned: [],
    widths: Object.fromEntries(columns.map((column) => [column.id, column.width])),
  }
}

export function clampWidth(column: TableColumn, width: number): number {
  const min = column.minWidth ?? DEFAULT_MIN_WIDTH
  const max = column.maxWidth ?? DEFAULT_MAX_WIDTH
  return Math.round(Math.min(max, Math.max(min, Number.isFinite(width) ? width : column.width)))
}

/**
 * Disposition enregistrée remise d'aplomb avec les colonnes actuelles : colonnes disparues retirées, nouvelles
 * colonnes ajoutées à la fin, largeurs ramenées dans leurs bornes, au moins une colonne mobile visible
 */
export function mergeLayout(stored: Partial<TableLayout> | null | undefined, columns: TableColumn[]): TableLayout {
  const base = defaultLayout(columns)
  if (!stored || typeof stored !== 'object') return base
  const ids = new Set(base.order)
  const known = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [])
  const order = Array.from(new Set(known(stored.order)))
  // Colonnes apparues depuis l'enregistrement : ajoutées à la fin, masquées si elles le sont par défaut
  const added = base.order.filter((id) => !order.includes(id))
  order.push(...added)
  let hidden = Array.from(new Set([...known(stored.hidden), ...added.filter((id) => base.hidden.includes(id))]))
  if (hidden.length >= order.length) hidden = []
  const pinned = Array.from(new Set(known(stored.pinned))).filter((id) => !hidden.includes(id))
  const widths: Record<string, number> = {}
  for (const column of columns) {
    const value = stored.widths && typeof stored.widths === 'object' ? (stored.widths as Record<string, unknown>)[column.id] : undefined
    widths[column.id] = column.fixed ? column.width : clampWidth(column, typeof value === 'number' ? value : column.width)
  }
  // Une ancienne densité enregistrée est ignorée
  return { order, hidden, pinned, widths }
}

/** Colonnes affichées, dans l'ordre : colonnes fixes, puis épinglées, puis les autres */
export function visibleColumns(layout: TableLayout, columns: TableColumn[]): TableColumn[] {
  const byId = new Map(columns.map((column) => [column.id, column]))
  const shown = layout.order.filter((id) => !layout.hidden.includes(id))
  const pinned = shown.filter((id) => layout.pinned.includes(id))
  const free = shown.filter((id) => !layout.pinned.includes(id))
  return [...columns.filter((column) => column.fixed), ...[...pinned, ...free].map((id) => byId.get(id)!).filter(Boolean)]
}

/** Groupe d'une colonne : on ne déplace une colonne qu'au milieu des colonnes de son groupe (épinglées ou non) */
export function groupOf(layout: TableLayout, id: string): string[] {
  const shown = layout.order.filter((item) => !layout.hidden.includes(item))
  const pinned = layout.pinned.includes(id)
  return shown.filter((item) => layout.pinned.includes(item) === pinned)
}

/**
 * Colonne placée à la position `index` de son groupe visible (0 = la première du groupe) ; l'ordre des colonnes
 * masquées et de l'autre groupe ne bouge pas
 */
export function moveColumn(layout: TableLayout, id: string, index: number): TableLayout {
  const group = groupOf(layout, id)
  const from = group.indexOf(id)
  if (from < 0) return layout
  const to = Math.max(0, Math.min(group.length - 1, index))
  if (to === from) return layout
  const nextGroup = group.filter((item) => item !== id)
  nextGroup.splice(to, 0, id)
  // Les places occupées par le groupe dans l'ordre complet reçoivent le nouvel ordre du groupe
  const slots = layout.order.map((item, position) => (group.includes(item) ? position : -1)).filter((position) => position >= 0)
  const order = [...layout.order]
  slots.forEach((position, rank) => {
    order[position] = nextGroup[rank]
  })
  return { ...layout, order }
}

export function toggleHidden(layout: TableLayout, id: string): TableLayout {
  if (layout.hidden.includes(id)) return { ...layout, hidden: layout.hidden.filter((item) => item !== id) }
  // Toujours au moins une colonne mobile visible
  if (layout.order.filter((item) => !layout.hidden.includes(item)).length <= 1) return layout
  return { ...layout, hidden: [...layout.hidden, id], pinned: layout.pinned.filter((item) => item !== id) }
}

export function togglePinned(layout: TableLayout, id: string): TableLayout {
  if (layout.hidden.includes(id)) return layout
  return layout.pinned.includes(id)
    ? { ...layout, pinned: layout.pinned.filter((item) => item !== id) }
    : { ...layout, pinned: [...layout.pinned, id] }
}

/** Décalage gauche de chaque colonne collée à gauche (fixes et épinglées) : somme des largeurs avant elle */
export function stickyOffsets(layout: TableLayout, shown: TableColumn[]): Record<string, number> {
  const offsets: Record<string, number> = {}
  let left = 0
  for (const column of shown) {
    if (!column.fixed && !layout.pinned.includes(column.id)) break
    offsets[column.id] = left
    left += layout.widths[column.id] ?? column.width
  }
  return offsets
}

export function isDefaultLayout(layout: TableLayout, columns: TableColumn[]): boolean {
  return JSON.stringify(layout) === JSON.stringify(defaultLayout(columns))
}

/** Résumé lisible : « 7 sur 8 colonnes · 1 épinglée » */
export function layoutSummary(layout: TableLayout): string {
  const shown = layout.order.length - layout.hidden.length
  const pinned = layout.pinned.length
  return `${shown} sur ${layout.order.length} colonnes · ${pinned === 0 ? 'aucune épinglée' : `${pinned} épinglée${pinned > 1 ? 's' : ''}`}`
}
