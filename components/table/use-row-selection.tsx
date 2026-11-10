'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { Check } from 'lucide-react'

/**
 * Sélection de lignes ou de cartes : clic sur une case, glisser sur les cases pour en cocher (ou décocher) plusieurs
 * (la valeur est prise sur la première case), Maj + clic pour toute la plage depuis la dernière case cliquée, et au
 * clavier Espace ou Entrée sur la case.
 */
export function useRowSelection(initial: string[] = []) {
  const [selected, setSelected] = useState<string[]>(initial)
  const painting = useRef<boolean | null>(null)
  const lastId = useRef<string | null>(null)

  // Fin d'un glisser, où que le bouton de la souris soit relâché
  useEffect(() => {
    const stop = () => {
      painting.current = null
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  const setMany = useCallback(
    (ids: string[], value: boolean) =>
      setSelected((current) => (value ? Array.from(new Set([...current, ...ids])) : current.filter((id) => !ids.includes(id)))),
    [],
  )
  const isSelected = (id: string) => selected.includes(id)

  /** Propriétés de la case d'une ligne ; `order` : identifiants dans l'ordre affiché (pour Maj + clic) */
  const checkboxProps = (id: string, order: string[]) => ({
    role: 'checkbox' as const,
    'aria-checked': selected.includes(id),
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const value = !selected.includes(id)
      const from = lastId.current ? order.indexOf(lastId.current) : -1
      const to = order.indexOf(id)
      if (event.shiftKey && from >= 0 && to >= 0) {
        setMany(order.slice(Math.min(from, to), Math.max(from, to) + 1), value)
      } else {
        painting.current = value
        setMany([id], value)
      }
      lastId.current = id
    },
    onPointerEnter: () => {
      if (painting.current !== null) setMany([id], painting.current)
    },
    // Clavier : un clic sans pointeur (Espace, Entrée)
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (event.detail === 0) setMany([id], !selected.includes(id))
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === ' ' && event.currentTarget.tagName !== 'BUTTON') {
        event.preventDefault()
        setMany([id], !selected.includes(id))
      }
    },
  })

  return { selected, setSelected, isSelected, setMany, clear: () => setSelected([]), checkboxProps }
}

export type RowSelection = ReturnType<typeof useRowSelection>

/** Case de sélection d'une ligne (zone cliquable de 32 px, case visible de 20 px) */
export function SelectionCheckbox({
  selection,
  id,
  order,
  label,
}: {
  selection: RowSelection
  id: string
  order: string[]
  label: string
}) {
  const checked = selection.isSelected(id)
  return (
    <button
      type="button"
      aria-label={label}
      {...selection.checkboxProps(id, order)}
      className="-m-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span
        className={`flex size-5 items-center justify-center rounded border transition-colors ${
          checked ? 'border-primary bg-primary text-black' : 'border-shade-66'
        }`}
        aria-hidden="true"
      >
        {checked && <Check className="size-3.5 stroke-[3]" />}
      </span>
    </button>
  )
}
