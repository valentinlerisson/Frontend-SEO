'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Loader2, Minus, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import { Popover } from '@base-ui/react/popover'
import { ImpactBadge } from './impact-badge'
import { FIX_STATUSES, FIX_STATUS_LABEL, type FixStatus } from '@/core/domain/fix-plan'
import type { PlanTask } from '@/core/services/fix-plan-service'
import { SelectionCheckbox, type RowSelection } from '@/components/table/use-row-selection'
import { PILLAR_LABEL, SEVERITY, impactOf, pageLabel, plural, shortDate } from './fix-plan-shared'

/** Fin de phrase du message « N tâches … » après un déplacement vers cette colonne */

const MOVE_VERB: Record<FixStatus, string> = { TODO: 'remises à corriger', DOING: 'en cours', DONE: 'terminées' }

/**
 * Carte d'une anomalie présente sur plusieurs pages (vue « Par anomalie ») : les tâches de la colonne regroupées. Les
 * boutons et le glisser déplacent toutes les pages d'un coup ; la liste dépliée permet de traiter chaque page seule.
 */
export function GroupCard({
  tasks,
  totalInPlan,
  selection,
  order,
  auditDate,
  dragging,
  onDragStart,
  onDragEnd,
  onMoveTasks,
  onRemove,
  onOpenPage,
}: {
  tasks: PlanTask[]
  totalInPlan: number
  selection: RowSelection
  order: string[]
  auditDate?: string
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMoveTasks: (list: PlanTask[], status: FixStatus, verb: string) => void
  onRemove: (task: PlanTask) => void
  onOpenPage: (task: PlanTask) => void
}) {
  const [open, setOpen] = useState(false)
  const first = tasks[0]
  const status = first.status
  const index = FIX_STATUSES.indexOf(status)
  const previous = FIX_STATUSES[index - 1]
  const next = FIX_STATUSES[index + 1]
  const ids = tasks.map((task) => task.id)
  const selectedCount = ids.filter((id) => selection.isSelected(id)).length
  const allSelected = selectedCount === ids.length
  const severity = SEVERITY[first.severity] ?? SEVERITY.WARNING
  const when = auditDate ? ` du ${shortDate(auditDate)}` : ''
  const stillDetected = tasks.filter((task) => task.verification === 'still-detected')
  const notDetected = tasks.filter((task) => task.verification === 'not-detected')
  const count = plural(tasks.length, 'page', 'pages')

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', `group:${first.code}`)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      aria-label={`${first.title}, ${count}, ${FIX_STATUS_LABEL[status]}`}
      className={`cursor-grab rounded-xl border bg-card p-3 shadow-sm transition-[opacity,box-shadow] active:cursor-grabbing ${
        selectedCount > 0 ? 'border-primary ring-1 ring-primary' : 'border-shade-33 hover:border-shade-55'
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={allSelected ? true : selectedCount > 0 ? 'mixed' : false}
          aria-label={`Sélectionner les ${count} : ${first.title}`}
          onClick={() => selection.setMany(ids, !allSelected)}
          className="-m-1.5 mt-0 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span
            className={`flex size-5 items-center justify-center rounded border transition-colors ${
              selectedCount > 0 ? 'border-primary bg-primary text-black' : 'border-shade-66'
            }`}
            aria-hidden="true"
          >
            {allSelected ? <Check className="size-3.5 stroke-[3]" /> : selectedCount > 0 ? <Minus className="size-3.5 stroke-[3]" /> : null}
          </span>
        </button>
        <div className="min-w-0">
          <p className={`text-sm font-semibold leading-snug ${status === 'DONE' ? 'text-muted-foreground line-through decoration-shade-55' : 'text-foreground'}`}>
            {first.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {count}
            {totalInPlan > tasks.length ? ` ici, ${totalInPlan} dans le plan` : ''}
          </p>
        </div>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-full border border-shade-44 px-2 py-0.5 text-muted-foreground">{PILLAR_LABEL[first.pillar] ?? first.pillar}</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-shade-44 px-2 py-0.5 text-foreground">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: severity.color }} aria-hidden="true" />
          {severity.label}
        </span>
        <ImpactBadge impact={impactOf(first)} />
      </p>

      {/* Ce que dit le dernier audit, pour l'ensemble du groupe */}
      {stillDetected.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[#eab308]/10 px-2 py-1.5 text-xs text-amber-soft">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {plural(stillDetected.length, 'page encore relevée', 'pages encore relevées')} par l’audit{when}
          <button type="button" onClick={() => onMoveTasks(stillDetected, 'TODO', MOVE_VERB.TODO)} className="font-semibold underline">
            Rouvrir
          </button>
        </p>
      )}
      {notDetected.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[#12b10f]/10 px-2 py-1.5 text-xs text-green-soft">
          <Check className="size-3.5 shrink-0" aria-hidden="true" />
          {plural(notDetected.length, 'page plus relevée', 'pages plus relevées')} par l’audit{when}
          <button type="button" onClick={() => onMoveTasks(notDetected, 'DONE', MOVE_VERB.DONE)} className="font-semibold underline">
            Passer en Terminée
          </button>
        </p>
      )}

      {first.recommendation && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer list-none font-semibold text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            Comment corriger
          </summary>
          <p className="mt-1 leading-relaxed text-foreground/90">{first.recommendation}</p>
        </details>
      )}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mt-2 inline-flex items-center gap-1 rounded text-xs font-semibold text-primary-ink hover:underline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        {open ? 'Masquer les pages' : `Voir les ${count}`}
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col divide-y divide-shade-33 rounded-lg border border-shade-33">
          {tasks.map((task) => {
            const taskPrevious = FIX_STATUSES[FIX_STATUSES.indexOf(task.status) - 1]
            const taskNext = FIX_STATUSES[FIX_STATUSES.indexOf(task.status) + 1]
            return (
              <li key={task.id} className="flex items-center gap-1.5 px-2 py-1.5">
                <SelectionCheckbox selection={selection} id={task.id} order={order} label={`Sélectionner : ${task.title}, ${pageLabel(task)}`} />
                {task.pageId ? (
                  <button
                    type="button"
                    onClick={() => onOpenPage(task)}
                    title={task.url ?? undefined}
                    className="ml-1.5 min-w-0 flex-1 truncate rounded text-left font-mono text-xs text-primary-ink hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {pageLabel(task)}
                  </button>
                ) : (
                  <span title={task.url ?? undefined} className="ml-1.5 min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {pageLabel(task)}
                  </span>
                )}
                {task.verification === 'still-detected' && <TriangleAlert className="size-3.5 shrink-0 text-amber-soft" aria-label="Encore relevée par l’audit" />}
                {task.verification === 'not-detected' && <Check className="size-3.5 shrink-0 text-green-soft" aria-label="Plus relevée par l’audit" />}
                {taskPrevious && (
                  <button
                    type="button"
                    onClick={() => onMoveTasks([task], taskPrevious, MOVE_VERB[taskPrevious])}
                    aria-label={`${pageLabel(task)} : remettre dans « ${FIX_STATUS_LABEL[taskPrevious]} »`}
                    title={`Remettre dans « ${FIX_STATUS_LABEL[taskPrevious]} »`}
                    className="rounded-md p-1 text-muted-foreground hover:bg-shade-33 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <ArrowLeft className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                {taskNext && (
                  <button
                    type="button"
                    onClick={() => onMoveTasks([task], taskNext, MOVE_VERB[taskNext])}
                    aria-label={`${pageLabel(task)} : ${taskNext === 'DOING' ? 'commencer' : 'terminer'}`}
                    title={taskNext === 'DOING' ? 'Commencer' : 'Terminer'}
                    className="rounded-md p-1 text-primary-ink hover:bg-shade-33 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(task)}
                  aria-label={`${pageLabel(task)} : retirer du plan`}
                  title="Retirer du plan (elle ne reviendra pas seule)"
                  className="rounded-md p-1 text-muted-foreground hover:bg-shade-33 hover:text-red-soft focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Déplacer toutes les pages du groupe */}
      <div className="mt-2.5 flex items-center gap-1 border-t border-shade-33 pt-2">
        {previous && (
          <button
            type="button"
            onClick={() => onMoveTasks(tasks, previous, MOVE_VERB[previous])}
            aria-label={`Remettre les ${count} dans « ${FIX_STATUS_LABEL[previous]} »`}
            title={`Remettre les ${count} dans « ${FIX_STATUS_LABEL[previous]} »`}
            className="rounded-md p-1 text-muted-foreground hover:bg-shade-33 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            {previous === 'TODO' && status === 'DONE' ? <RotateCcw className="size-4" aria-hidden="true" /> : <ArrowLeft className="size-4" aria-hidden="true" />}
          </button>
        )}
        {next && (
          <button
            type="button"
            onClick={() => onMoveTasks(tasks, next, MOVE_VERB[next])}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary-ink hover:bg-shade-33 focus-visible:outline-2 focus-visible:outline-primary"
          >
            {next === 'DOING' ? `Commencer les ${count}` : `Terminer les ${count}`}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  )
}

/** Bouton « Nouvelle tâche » : formulaire d'une tâche libre (titre, détails, pages facultatives, une tâche par page) */
export function NewTaskButton({
  error,
  onCreate,
}: {
  error: string | null
  onCreate: (input: { title: string; details?: string; urls?: string[] }) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [urls, setUrls] = useState('')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const lines = urls.split('\n').filter((line) => line.trim())
  const pageCount = lines.length

  const submit = async () => {
    setTried(true)
    if (!title.trim() || busy) return
    setBusy(true)
    const ok = await onCreate({ title, details, urls: lines })
    setBusy(false)
    if (ok) {
      setOpen(false)
      setTitle('')
      setDetails('')
      setUrls('')
      setTried(false)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-bold text-primary-foreground focus-visible:outline-2 focus-visible:outline-primary">
        <Plus className="size-4" aria-hidden="true" />
        Nouvelle tâche
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-[min(380px,calc(100vw-2rem))] rounded-xl border border-shade-44 bg-popover p-3 text-sm shadow-xl outline-none">
            <Popover.Title className="mb-2 font-semibold text-foreground">Tâche libre</Popover.Title>
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                Titre
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={160}
                  autoFocus
                  placeholder="Ex. : refaire les visuels de l’accueil"
                  aria-invalid={tried && !title.trim()}
                  className="h-9 rounded-lg border border-shade-44 bg-shade-16 px-2 text-sm font-normal text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none aria-[invalid=true]:border-[#ef4444]"
                />
                {tried && !title.trim() && <span className="font-normal text-red-soft">Donnez un titre à la tâche.</span>}
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                Détails (facultatif)
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="Ce qu’il faut faire, pour qui, où…"
                  className="rounded-lg border border-shade-44 bg-shade-16 p-2 text-xs font-normal text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                Pages concernées (facultatif)
                <textarea
                  value={urls}
                  onChange={(event) => setUrls(event.target.value)}
                  rows={3}
                  placeholder={'Une adresse par ligne, ex. :\nhttps://exemple.fr/contact/'}
                  className="rounded-lg border border-shade-44 bg-shade-16 p-2 font-mono text-xs font-normal text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <span className="font-normal">
                  {pageCount > 1 ? `Une tâche sera créée pour chacune des ${pageCount} pages.` : 'Sans adresse, la tâche n’est liée à aucune page.'}
                </span>
              </label>
              {error && (
                <p role="alert" className="text-xs text-red-soft">
                  {error}
                </p>
              )}
              <span className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60"
                >
                  {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                  {pageCount > 1 ? `Créer ${pageCount} tâches` : 'Créer la tâche'}
                </button>
                <Popover.Close className="text-xs text-muted-foreground hover:text-foreground">Annuler</Popover.Close>
              </span>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
