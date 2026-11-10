'use client'

import { useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Check, ChevronDown, Columns3, Pin, RotateCcw, Search } from 'lucide-react'
import { layoutSummary, type TableColumn } from '@/lib/table-layout'
import type { TableLayoutApi } from './use-table-layout'

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Groupe des colonnes propres au tableau (sans groupe), affiché en premier dans le menu */
const OWN_GROUP = 'Colonnes du tableau'

/**
 * Barre de personnalisation d'un tableau : menu des colonnes (recherche, colonnes du tableau puis métriques ajoutables
 * par groupe ; afficher, épingler, largeur) et retour à la disposition par défaut
 */
export function TableLayoutToolbar({ api, columns }: { api: TableLayoutApi; columns: TableColumn[] }) {
  const { layout } = api
  const [query, setQuery] = useState('')
  const movable = columns.filter((column) => !column.fixed)
  const byId = new Map(movable.map((column) => [column.id, column]))
  const shownCount = layout.order.length - layout.hidden.length
  const wanted = normalize(query.trim())

  // Colonnes du tableau dans l'ordre affiché, puis métriques par groupe dans l'ordre du catalogue
  const groups = new Map<string, TableColumn[]>()
  const push = (column: TableColumn) => {
    const name = column.group ?? OWN_GROUP
    groups.set(name, [...(groups.get(name) ?? []), column])
  }
  for (const id of layout.order) {
    const column = byId.get(id)
    if (column && !column.group) push(column)
  }
  for (const column of movable) if (column.group) push(column)
  const visibleGroups = Array.from(groups.entries())
    .map(([name, list]) => [name, wanted ? list.filter((column) => normalize(`${column.label} ${name}`).includes(wanted)) : list] as const)
    .filter(([, list]) => list.length > 0)

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Disposition du tableau">
      <Popover.Root onOpenChange={(open) => !open && setQuery('')}>
        <Popover.Trigger className="inline-flex h-9 items-center gap-2 rounded-lg border border-shade-44 bg-shade-16 px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary data-[popup-open]:border-primary">
          <Columns3 className="size-4 text-muted-foreground" aria-hidden="true" />
          Colonnes
          <span className="rounded-md bg-shade-33 px-1.5 text-xs tabular-nums text-muted-foreground">
            {shownCount}/{layout.order.length}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
            <Popover.Popup className="flex max-h-[min(70vh,560px)] w-[340px] flex-col rounded-xl border border-shade-44 bg-popover text-sm shadow-xl outline-none transition-[opacity,transform] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              <div className="border-b border-shade-33 p-2">
                <Popover.Title className="sr-only">Colonnes et métriques</Popover.Title>
                <label className="relative block">
                  <span className="sr-only">Chercher une colonne ou une métrique</span>
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Chercher une métrique (LCP, canonical…)"
                    className="h-8 w-full rounded-lg border border-shade-44 bg-shade-16 pr-2 pl-8 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {visibleGroups.length === 0 && <p className="px-2.5 py-3 text-[13px] text-muted-foreground">Aucune colonne ne correspond.</p>}
                {visibleGroups.map(([name, list]) => (
                  <div key={name} className="mb-1.5 last:mb-0">
                    <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{name}</p>
                    <ul className="flex flex-col">
                      {list.map((column) => {
                        const visible = !layout.hidden.includes(column.id)
                        const pinned = layout.pinned.includes(column.id)
                        const lastVisible = visible && shownCount <= 1
                        return (
                          <li key={column.id} className="flex items-center gap-1 rounded-lg hover:bg-shade-28">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={visible}
                              disabled={lastVisible}
                              onClick={() => api.toggleHidden(column.id)}
                              title={column.description}
                              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <span
                                className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                                  visible ? 'border-primary bg-primary text-primary-foreground' : 'border-shade-66'
                                }`}
                                aria-hidden="true"
                              >
                                {visible && <Check className="size-3 stroke-[3]" />}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-foreground">{column.label}</span>
                              {visible && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{api.widthOf(column.id)} px</span>}
                            </button>
                            <button
                              type="button"
                              aria-pressed={pinned}
                              disabled={!visible}
                              onClick={() => api.togglePinned(column.id)}
                              title={pinned ? 'Détacher la colonne' : 'Épingler à gauche'}
                              aria-label={`${pinned ? 'Détacher' : 'Épingler à gauche'} la colonne ${column.label}`}
                              className={`mr-1 rounded-md p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30 ${
                                pinned ? 'text-primary-ink' : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              <Pin className={`size-3.5 ${pinned ? 'fill-current' : ''}`} aria-hidden="true" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-shade-33 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  {shownCount} sur {layout.order.length} affichées
                </span>
                <button
                  type="button"
                  disabled={layout.hidden.length === 0}
                  onClick={api.showAll}
                  className="rounded font-semibold text-primary-ink hover:underline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 disabled:no-underline"
                >
                  Tout afficher
                </button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <button
        type="button"
        onClick={api.reset}
        disabled={api.isDefault}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Réinitialiser
      </button>
    </div>
  )
}

/** Pied de tableau : résumé de la disposition, raccourcis clavier des en-têtes, et zone lue par les lecteurs d'écran */
export function TableLayoutFooter({ api }: { api: TableLayoutApi }) {
  const keys: [string[], string][] = [
    [['←', '→'], 'parcourir'],
    [['Alt', '←→'], 'déplacer'],
    [['Maj', '←→'], 'largeur'],
    [['E'], 'épingler'],
    [['M'], 'masquer'],
    [['Entrée'], 'ajuster'],
  ]
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
      <span>{layoutSummary(api.layout)}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Raccourcis clavier sur un en-tête de colonne">
        <span>Sur un en-tête :</span>
        {keys.map(([combo, action]) => (
          <span key={action} className="inline-flex items-center gap-1">
            {combo.map((key) => (
              <kbd key={key} className="rounded border border-shade-44 bg-shade-16 px-1 font-sans text-[11px] text-foreground">
                {key}
              </kbd>
            ))}
            {action}
          </span>
        ))}
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {api.announcement}
      </span>
    </div>
  )
}
