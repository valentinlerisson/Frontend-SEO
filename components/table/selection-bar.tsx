'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Loader2, TriangleAlert, X } from 'lucide-react'

export type SelectionAction = {
  id: string
  label: string
  icon?: ReactNode
  onClick: () => void
  /** Action principale (bouton jaune, libellé toujours visible), une seule par barre */
  primary?: boolean
  disabled?: boolean
  /** Précision au survol, surtout quand l'action est indisponible */
  title?: string
  busy?: boolean
  /** Élément sur mesure à la place du bouton (menu déroulant) : utiliser `ACTION_CLASS` et `ExpandingLabel` */
  render?: () => ReactNode
}

/** Confirmation demandée dans la barre avant une action coûteuse (appels à l'IA, recherches Google) */
export type SelectionConfirm = {
  text: string
  confirmLabel: string
  onConfirm: () => void
}

export type SelectionToast = {
  text: string
  /** Lien ou bouton après le message (« Annuler », « Ouvrir le plan ») */
  actions?: { label: string; onClick: () => void }[]
}

/** Message après une action, effacé seul au bout de quelques secondes */
export function useSelectionToast(duration = 7000) {
  const [toast, setToast] = useState<SelectionToast | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), duration)
    return () => window.clearTimeout(timer)
  }, [toast, duration])
  return [toast, setToast] as const
}

/** Bouton d'action secondaire : icône seule au repos, son nom apparaît au survol ou au focus */
export const ACTION_CLASS =
  'group/act inline-flex h-8 shrink-0 items-center rounded-xl px-2 font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#f5e400] disabled:cursor-not-allowed disabled:opacity-40 data-[popup-open]:bg-white/10'

/**
 * Texte qui se déplie à côté de l'icône : largeur animée de 0 à sa largeur réelle (grille 0fr → 1fr) au survol, au
 * focus clavier ou menu ouvert. Le texte reste dans la page : il donne aussi le nom du bouton aux lecteurs d'écran.
 */
export function ExpandingLabel({ children }: { children: ReactNode }) {
  return (
    <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out group-hover/act:grid-cols-[1fr] group-focus-visible/act:grid-cols-[1fr] group-data-[popup-open]/act:grid-cols-[1fr] motion-reduce:transition-none">
      <span className="min-w-0 overflow-hidden whitespace-nowrap">
        <span data-expand-label className="inline-block pl-1.5">
          {children}
        </span>
      </span>
    </span>
  )
}

/**
 * Barre flottante des actions sur une sélection, collée en bas de l'écran : une bulle compacte (effacer, nombre
 * d'éléments, icônes des actions, action principale) qui s'élargit au survol de chaque icône pour montrer son nom. Son
 * bord gauche reste fixe pendant le survol (elle ne grandit que vers la droite, l'icône survolée ne glisse pas sous la
 * souris) et sa place est calculée pour que le plus long nom tienne dans le contenu, même fiche ouverte à côté. La
 * précision (coût, budget) s'affiche dans une bulle au-dessus du nombre. Après une action, un message de confirmation
 * (avec « Annuler » quand c'est possible) ; avant une action coûteuse, une confirmation. Sombre dans les deux thèmes.
 */
export function SelectionBar({
  count,
  noun,
  info,
  actions,
  onClear,
  toast,
  confirm,
  onCancelConfirm,
}: {
  count: number
  /** Nom au singulier et au pluriel (« page sélectionnée », « pages sélectionnées ») */
  noun: [string, string]
  /** Précision montrée au survol du nombre d'éléments */
  info?: ReactNode
  actions: SelectionAction[]
  onClear: () => void
  toast?: SelectionToast | null
  confirm?: SelectionConfirm | null
  onCancelConfirm?: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const hovering = useRef(false)
  const [offset, setOffset] = useState<number | null>(null)
  const [, setTick] = useState(0)
  const actionMode = !toast && !confirm && count > 0

  // Place de la bulle au repos : centrée, mais décalée à gauche s'il le faut pour que le plus long nom déplié tienne
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const bar = barRef.current
    if (!wrap || !bar || !actionMode || hovering.current) return
    const rest = bar.offsetWidth
    const longest = Math.max(0, ...Array.from(bar.querySelectorAll<HTMLElement>('[data-expand-label]')).map((label) => label.offsetWidth))
    const room = wrap.clientWidth
    const next = Math.max(0, Math.round(Math.min((room - rest) / 2, room - rest - longest - 8)))
    if (next !== offset) setOffset(next)
  })
  // Contenu plus étroit ou plus large (fiche ouverte, étirée, fenêtre redimensionnée) : place recalculée
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => setTick((value) => value + 1))
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [count > 0 || Boolean(toast) || Boolean(confirm)])

  if (count === 0 && !toast && !confirm) return null
  return (
    <div
      ref={wrapRef}
      data-selection-bar
      className={`pointer-events-none sticky bottom-5 z-30 mt-2 flex ${actionMode && offset !== null ? 'justify-start' : 'justify-center'}`}
      style={actionMode && offset !== null ? { paddingLeft: offset } : undefined}
    >
      <div
        ref={barRef}
        role={toast || confirm ? 'status' : 'region'}
        aria-label={toast || confirm ? undefined : 'Actions sur la sélection'}
        aria-live={toast || confirm ? 'polite' : undefined}
        onPointerEnter={() => {
          hovering.current = true
        }}
        onPointerLeave={() => {
          hovering.current = false
          setTick((value) => value + 1)
        }}
        className={`pointer-events-auto flex animate-in fade-in slide-in-from-bottom-3 items-center gap-0.5 rounded-2xl border border-white/10 bg-[#161618]/95 p-1.5 text-sm text-white shadow-[0_18px_50px_-12px_rgb(0_0_0/0.6)] backdrop-blur-md duration-200 ${
          actionMode ? 'w-max shrink-0 flex-nowrap' : 'max-w-full flex-wrap justify-center'
        }`}
      >
        {confirm ? (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f5e400] text-[#111]" aria-hidden="true">
              <TriangleAlert className="size-4" />
            </span>
            <span className="px-2">{confirm.text}</span>
            <button
              type="button"
              onClick={onCancelConfirm}
              className="rounded-xl px-3 py-1.5 font-semibold whitespace-nowrap text-white/80 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#f5e400]"
            >
              Annuler
            </button>
            <button
              type="button"
              autoFocus
              onClick={confirm.onConfirm}
              className="rounded-xl bg-[#f5e400] px-3 py-1.5 font-bold whitespace-nowrap text-[#111] hover:bg-[#e0d100] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#f5e400]"
            >
              {confirm.confirmLabel}
            </button>
          </>
        ) : toast ? (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#12b10f] text-white" aria-hidden="true">
              <Check className="size-4 stroke-[3]" />
            </span>
            <span className="px-2">{toast.text}</span>
            {toast.actions?.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className="rounded-xl bg-white/10 px-3 py-1.5 font-semibold whitespace-nowrap transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-[#f5e400]"
              >
                {action.label}
              </button>
            ))}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onClear}
              aria-label="Effacer la sélection"
              title="Effacer la sélection"
              className="flex size-8 shrink-0 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#f5e400]"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            {/* Nombre d'éléments ; la précision (coût, budget) dans une bulle au-dessus, au survol ou au focus */}
            <span
              tabIndex={info ? 0 : undefined}
              className="group/info relative inline-flex h-8 items-center rounded-xl px-1.5 font-semibold whitespace-nowrap tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[#f5e400]"
            >
              {count} {count > 1 ? noun[1] : noun[0]}
              {info && (
                <span className="pointer-events-none invisible absolute bottom-full left-0 mb-2 rounded-lg border border-white/10 bg-[#161618] px-2.5 py-1.5 text-xs font-normal whitespace-nowrap text-white/80 opacity-0 shadow-lg transition-opacity duration-150 group-hover/info:visible group-hover/info:opacity-100 group-focus-visible/info:visible group-focus-visible/info:opacity-100">
                  {info}
                </span>
              )}
            </span>
            <span className="mx-1 h-5 w-px shrink-0 bg-white/15" aria-hidden="true" />
            {actions.map((action) =>
              action.render ? (
                <span key={action.id} className="shrink-0">
                  {action.render()}
                </span>
              ) : action.primary ? (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled || action.busy}
                  title={action.title}
                  className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-[#f5e400] px-3 font-bold whitespace-nowrap text-[#111] transition-colors hover:bg-[#e0d100] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#f5e400] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {action.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : action.icon}
                  {action.label}
                </button>
              ) : (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled || action.busy}
                  title={action.title}
                  className={ACTION_CLASS}
                >
                  {action.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : action.icon}
                  <ExpandingLabel>{action.label}</ExpandingLabel>
                </button>
              ),
            )}
          </>
        )}
      </div>
    </div>
  )
}
