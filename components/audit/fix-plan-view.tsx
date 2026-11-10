'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, Loader2, MessageSquareText, Play, RotateCcw, Search, Trash2, TriangleAlert } from 'lucide-react'
import { Popover } from '@base-ui/react/popover'
import { AuditHeader } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { ImpactBadge } from './impact-badge'
import { useAudit } from '@/components/providers/audit-provider'
import { useInspection } from '@/components/providers/inspection-provider'
import { getInspectionTarget } from '@/lib/issue-routing'
import { FIX_STATUSES, FIX_STATUS_LABEL, type FixStatus } from '@/core/domain/fix-plan'
import type { PlanTask } from '@/core/services/fix-plan-service'
import { useFixPlan } from './use-fix-plan'
import { GroupCard, NewTaskButton } from './fix-plan-group'
import { PILLAR_LABEL, SEVERITY, impactOf, isCustom, pageLabel, plural, shortDate } from './fix-plan-shared'
import { ACTION_CLASS, ExpandingLabel, SelectionBar, useSelectionToast, type SelectionConfirm } from '@/components/table/selection-bar'
import { SelectionCheckbox, useRowSelection, type RowSelection } from '@/components/table/use-row-selection'

const COLUMN_STYLE: Record<FixStatus, string> = {
  TODO: 'border-t-shade-55',
  DOING: 'border-t-[var(--viz-accent)]',
  DONE: 'border-t-[var(--viz-good)]',
}
/** Cartes affichées par colonne avant « Afficher les autres » */
const SHOWN = 30

const longDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Ce que montre une colonne en vue « Par anomalie » : une carte seule, ou une carte groupe (même anomalie, 2 pages ou plus) */
type ColumnItem = { kind: 'task'; task: PlanTask } | { kind: 'group'; code: string; tasks: PlanTask[] }

/** Regroupe une colonne (déjà triée) par anomalie ; le groupe prend la place de sa première tâche. Les tâches libres restent seules. */
function groupColumn(column: PlanTask[]): ColumnItem[] {
  const count = new Map<string, number>()
  for (const task of column) count.set(task.code, (count.get(task.code) ?? 0) + 1)
  const groups = new Map<string, Extract<ColumnItem, { kind: 'group' }>>()
  const items: ColumnItem[] = []
  for (const task of column) {
    if (isCustom(task) || (count.get(task.code) ?? 0) < 2) {
      items.push({ kind: 'task', task })
      continue
    }
    const group = groups.get(task.code)
    if (group) group.tasks.push(task)
    else {
      const created: Extract<ColumnItem, { kind: 'group' }> = { kind: 'group', code: task.code, tasks: [task] }
      groups.set(task.code, created)
      items.push(created)
    }
  }
  return items
}

/**
 * Plan d'action : les corrections à faire, une carte par anomalie et par page, en trois colonnes (À corriger, En
 * cours, Terminée). Glisser une carte la déplace ; ses boutons font de même au clavier. Le dernier audit dit si une
 * tâche terminée est encore relevée, ou si une tâche ouverte ne l'est plus.
 */
export function FixPlanView({ projectId }: { projectId: string }) {
  const { audit } = useAudit()
  const { openInspection } = useInspection()
  const { plan, error, loading, move, remove, setNote, updateMany, addCustom, clearError } = useFixPlan(projectId)
  // Tâches sélectionnées : actions de la barre flottante (commencer, terminer, rouvrir, note, retrait)
  const selection = useRowSelection()
  const [toast, setToast] = useSelectionToast()
  const [confirm, setConfirm] = useState<SelectionConfirm | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [query, setQuery] = useState('')
  const [pillar, setPillar] = useState<'ALL' | 'TECH' | 'EDITORIAL' | 'CUSTOM'>('ALL')
  const [page, setPage] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  // Une carte par anomalie et par page, ou une carte par anomalie (les pages dedans) ; choix gardé dans le navigateur
  const [view, setView] = useState<'page' | 'issue'>('page')
  useEffect(() => {
    try {
      if (window.localStorage.getItem('plan-view') === 'issue') setView('issue')
    } catch {}
  }, [])
  const chooseView = (next: 'page' | 'issue') => {
    setView(next)
    try {
      window.localStorage.setItem('plan-view', next)
    } catch {}
  }
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  /** Groupe en cours de déplacement (vue « Par anomalie ») : son code et la colonne d'où il part */
  const [draggingGroup, setDraggingGroup] = useState<{ code: string; status: FixStatus } | null>(null)
  const [drop, setDrop] = useState<{ status: FixStatus; beforeId: string | null } | null>(null)
  const [expanded, setExpanded] = useState<Record<FixStatus, boolean>>({ TODO: false, DOING: false, DONE: false })

  const tasks = plan?.tasks ?? []
  const pages = useMemo(() => Array.from(new Set(tasks.map(pageLabel))).sort(), [tasks])
  const flagged = tasks.filter((task) => task.verification === 'still-detected' || task.verification === 'not-detected').length
  const wanted = query.trim().toLowerCase()
  const visible = tasks.filter(
    (task) =>
      (pillar === 'ALL' || task.pillar === pillar) &&
      (!page || pageLabel(task) === page) &&
      (!flaggedOnly || task.verification === 'still-detected' || task.verification === 'not-detected') &&
      (!wanted || `${task.title} ${task.path ?? ''}`.toLowerCase().includes(wanted)),
  )
  const done = tasks.filter((task) => task.status === 'DONE').length
  const share = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  /** Nombre de tâches de chaque anomalie dans tout le plan (pour dire « 5 sur 12 pages » sur une carte groupe) */
  const totalByCode = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of tasks) map.set(task.code, (map.get(task.code) ?? 0) + 1)
    return map
  }, [tasks])

  // Colonnes affichées, et ordre de toutes les cartes visibles (Maj + clic sélectionne une plage)
  const columnOf = (status: FixStatus) => visible.filter((task) => task.status === status).sort((a, b) => a.position - b.position)
  const itemsOf = (status: FixStatus): ColumnItem[] => {
    const column = columnOf(status)
    return view === 'issue' ? groupColumn(column) : column.map((task) => ({ kind: 'task' as const, task }))
  }
  const tasksOfItem = (item: ColumnItem) => (item.kind === 'task' ? [item.task] : item.tasks)
  const visibleOrder = FIX_STATUSES.flatMap((status) => {
    const items = itemsOf(status)
    return (expanded[status] ? items : items.slice(0, SHOWN)).flatMap(tasksOfItem).map((task) => task.id)
  })
  const selectedTasks = tasks.filter((task) => selection.selected.includes(task.id))
  const selectedIds = selectedTasks.map((task) => task.id)
  const countIn = (status: FixStatus) => selectedTasks.filter((task) => task.status === status).length
  const openTaskPage = (task: PlanTask) => {
    if (!task.pageId) return
    if (isCustom(task)) return openInspection(task.pageId)
    const target = getInspectionTarget({ code: task.code, pillar: task.pillar as 'TECH' | 'EDITORIAL' | 'GEO' })
    openInspection(task.pageId, target.tab, target.section)
  }
  const moveSelection = (status: FixStatus, verb: string) => moveTasks(selectedTasks, status, verb)
  /** Déplacement groupé, avec « Annuler » qui remet chaque tâche dans sa colonne d'avant */
  const moveTasks = async (list: PlanTask[], status: FixStatus, verb: string) => {
    const before = new Map(list.map((task) => [task.id, task.status]))
    const moved = list.filter((task) => task.status !== status).map((task) => task.id)
    if (moved.length === 0) return
    await updateMany(moved, { status })
    setToast({
      text: `${moved.length} tâche${moved.length > 1 ? 's' : ''} ${verb}`,
      actions: [
        {
          label: 'Annuler',
          onClick: async () => {
            for (const previous of FIX_STATUSES) {
              const ids = moved.filter((id) => before.get(id) === previous)
              if (ids.length) await updateMany(ids, { status: previous })
            }
            setToast({ text: 'Déplacement annulé' })
          },
        },
      ],
    })
  }

  // ----- Glisser-déposer (souris) ; les boutons de chaque carte font la même chose au clavier
  const onDragOverCard = (event: DragEvent<HTMLElement>, task: PlanTask, column: PlanTask[]) => {
    if (!dragging) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2
    const index = column.findIndex((item) => item.id === task.id)
    const beforeId = after ? (column[index + 1]?.id ?? null) : task.id
    if (drop?.status !== task.status || drop.beforeId !== beforeId) setDrop({ status: task.status, beforeId })
  }
  const onDropColumn = (event: DragEvent<HTMLElement>, status: FixStatus) => {
    event.preventDefault()
    if (dragging) move(dragging, status, drop?.status === status ? drop.beforeId : null)
    else if (draggingGroup && draggingGroup.status !== status) {
      // Un groupe déposé dans une colonne : toutes ses tâches de la colonne d'origine, ajoutées à la fin
      const list = tasks.filter((task) => task.code === draggingGroup.code && task.status === draggingGroup.status && visible.includes(task))
      void moveTasks(list, status, status === 'DONE' ? 'terminées' : status === 'DOING' ? 'en cours' : 'remises à corriger')
    }
    setDragging(null)
    setDraggingGroup(null)
    setDrop(null)
  }

  return (
    <div className="flex flex-col gap-6">
      {audit && <AuditHeader domain={audit.domain} currentTitle="Plan d’action" />}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Plan d’action</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Une tâche = une anomalie sur une page : corriger le H1 de /contact/ ne corrige pas celui de /a-propos/. Les
            anomalies à fort et moyen impact arrivent seules ; ajoutez les autres depuis{' '}
            <Link href={`/projets/${projectId}/global-issues`} className="font-semibold text-primary-ink hover:underline">
              Anomalies
            </Link>
            , ou créez une tâche libre. « Par anomalie » regroupe les pages d’une même anomalie en une carte.
            {plan?.audit ? ` Vérifié avec l’audit du ${longDate(plan.audit.date)}.` : ''}
          </p>
        </div>
        {tasks.length > 0 && (
          <div className="w-full max-w-xs">
            <p className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Avancement</span>
              <span className="font-semibold text-foreground">
                {done} sur {tasks.length} terminées · {share} %
              </span>
            </p>
            <span
              className="mt-1.5 block h-2 overflow-hidden rounded-full bg-[var(--viz-track)]"
              role="progressbar"
              aria-label="Tâches terminées"
              aria-valuenow={done}
              aria-valuemin={0}
              aria-valuemax={tasks.length}
            >
              <span className="block h-full rounded-full bg-[var(--viz-good)]" style={{ width: `${share}%` }} />
            </span>
          </div>
        )}
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative w-full sm:w-[300px]">
          <span className="sr-only">Chercher une tâche</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Chercher une anomalie ou une page"
            className="h-9 w-full rounded-lg border border-shade-44 bg-shade-16 pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </label>
        <div className="inline-flex h-9 items-center rounded-lg border border-shade-38 bg-shade-14 p-0.5" role="radiogroup" aria-label="Affichage">
          {(
            [
              ['page', 'Par page'],
              ['issue', 'Par anomalie'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={view === key}
              onClick={() => chooseView(key)}
              className={`h-full rounded-md px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                view === key ? 'bg-shade-38 text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="inline-flex h-9 items-center rounded-lg border border-shade-38 bg-shade-14 p-0.5" role="radiogroup" aria-label="Pilier">
          {(
            [
              ['ALL', 'Tout'],
              ['TECH', 'Technique'],
              ['EDITORIAL', 'Contenu'],
              ['CUSTOM', 'Libres'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={pillar === key}
              onClick={() => setPillar(key)}
              className={`h-full rounded-md px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                pillar === key ? 'bg-shade-38 text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <span className="sr-only">Page</span>
          <select
            value={page}
            onChange={(event) => setPage(event.target.value)}
            className="h-9 max-w-[260px] rounded-lg border border-shade-44 bg-shade-16 px-2 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="">Toutes les pages ({pages.length})</option>
            {pages.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        </label>
        {flagged > 0 && (
          <button
            type="button"
            aria-pressed={flaggedOnly}
            onClick={() => setFlaggedOnly((value) => !value)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
              flaggedOnly ? 'border-primary bg-primary/15 text-foreground' : 'border-shade-44 text-muted-foreground hover:text-foreground'
            }`}
          >
            <TriangleAlert className="size-3.5" aria-hidden="true" />À vérifier selon le dernier audit ({flagged})
          </button>
        )}
        <span className="sm:ml-auto">
          <NewTaskButton
            error={error}
            onCreate={async (input) => {
              const ids = await addCustom(input)
              if (ids) {
                setNotice(`${plural(ids.length, 'tâche ajoutée', 'tâches ajoutées')} en haut de « À corriger ».`)
                // Les filtres peuvent cacher la nouvelle tâche
                setQuery('')
                setPage('')
                setFlaggedOnly(false)
                if (pillar !== 'ALL' && pillar !== 'CUSTOM') setPillar('ALL')
              }
              return ids !== null
            }}
          />
        </span>
      </div>

      {notice && (
        <p role="status" className="flex items-center justify-between gap-3 rounded-xl border border-shade-44 bg-shade-1e p-3 text-sm text-foreground">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
            Fermer
          </button>
        </p>
      )}

      {error && (
        <p role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-[#ef4444]/50 p-3 text-sm text-red-soft">
          {error}
          <button type="button" onClick={clearError} className="text-xs font-semibold underline">
            Fermer
          </button>
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Chargement du plan…
        </p>
      ) : !plan?.audit && tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-shade-44 p-8 text-center text-sm text-muted-foreground">
          Le plan se remplit à la fin de l’exploration du site.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {FIX_STATUSES.map((status) => {
            const column = columnOf(status)
            const items = itemsOf(status)
            const total = tasks.filter((task) => task.status === status).length
            const shown = expanded[status] ? items : items.slice(0, SHOWN)
            const dropHere = drop?.status === status
            const carrying = Boolean(dragging || draggingGroup)
            return (
              <section
                key={status}
                aria-labelledby={`col-${status}`}
                onDragOver={(event) => {
                  if (!carrying) return
                  event.preventDefault()
                  // Un groupe se dépose toujours à la fin de la colonne
                  if (draggingGroup && (!dropHere || drop?.beforeId !== null)) setDrop({ status, beforeId: null })
                  else if (!dropHere && column.length === 0) setDrop({ status, beforeId: null })
                }}
                onDrop={(event) => onDropColumn(event, status)}
                className={`flex min-w-0 flex-col rounded-2xl border border-t-4 border-shade-33 bg-shade-1e p-3 transition-colors ${COLUMN_STYLE[status]} ${
                  carrying && dropHere ? 'bg-shade-24' : ''
                }`}
              >
                <h2 id={`col-${status}`} className="flex items-baseline justify-between px-1 pb-3 text-sm font-bold text-foreground">
                  {FIX_STATUS_LABEL[status]}
                  <span className="text-xs font-semibold text-muted-foreground">
                    {column.length === total ? total : `${column.length} sur ${total}`}
                  </span>
                </h2>
                <ol className="flex min-h-24 flex-col gap-2">
                  {shown.map((item) =>
                    item.kind === 'task' ? (
                      <li key={item.task.id}>
                        {dragging && drop?.status === status && drop.beforeId === item.task.id && <DropLine />}
                        <TaskCard
                          task={item.task}
                          selection={selection}
                          order={visibleOrder}
                          auditDate={plan?.audit?.date}
                          dragging={dragging === item.task.id}
                          onDragStart={() => setDragging(item.task.id)}
                          onDragEnd={() => {
                            setDragging(null)
                            setDrop(null)
                          }}
                          onDragOver={(event) => onDragOverCard(event, item.task, column)}
                          onMove={(next) => move(item.task.id, next)}
                          onRemove={() => remove(item.task.id)}
                          onNote={(note) => setNote(item.task.id, note)}
                          onOpenPage={item.task.pageId ? () => openTaskPage(item.task) : undefined}
                        />
                      </li>
                    ) : (
                      <li key={`group-${status}-${item.code}`}>
                        <GroupCard
                          tasks={item.tasks}
                          totalInPlan={totalByCode.get(item.code) ?? item.tasks.length}
                          selection={selection}
                          order={visibleOrder}
                          auditDate={plan?.audit?.date}
                          dragging={draggingGroup?.code === item.code && draggingGroup.status === status}
                          onDragStart={() => setDraggingGroup({ code: item.code, status })}
                          onDragEnd={() => {
                            setDraggingGroup(null)
                            setDrop(null)
                          }}
                          onMoveTasks={(list, next, verb) => void moveTasks(list, next, verb)}
                          onRemove={(task) => remove(task.id)}
                          onOpenPage={openTaskPage}
                        />
                      </li>
                    ),
                  )}
                  {carrying && dropHere && drop?.beforeId === null && column.length > 0 && <DropLine />}
                  {column.length === 0 && (
                    <li className="rounded-xl border border-dashed border-shade-44 p-4 text-center text-[13px] text-muted-foreground">
                      {total === 0 ? 'Glissez une tâche ici' : 'Aucune tâche pour ces filtres'}
                    </li>
                  )}
                </ol>
                {items.length > SHOWN && (
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => ({ ...current, [status]: !current[status] }))}
                    className="mt-2 inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-[13px] font-semibold text-primary-ink hover:underline"
                  >
                    <ChevronDown className={`size-3.5 transition-transform ${expanded[status] ? 'rotate-180' : ''}`} aria-hidden="true" />
                    {expanded[status] ? 'Afficher moins' : `Afficher les ${items.length - SHOWN} autres`}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      )}

      <SelectionBar
        count={selectedIds.length}
        noun={['tâche sélectionnée', 'tâches sélectionnées']}
        info={FIX_STATUSES.filter((status) => countIn(status) > 0)
          .map((status) => `${countIn(status)} ${FIX_STATUS_LABEL[status].toLowerCase()}`)
          .join(' · ')}
        onClear={() => selection.setSelected([])}
        toast={toast}
        confirm={confirm}
        onCancelConfirm={() => setConfirm(null)}
        actions={[
          {
            id: 'doing',
            label: 'Commencer',
            icon: <Play className="size-4" aria-hidden="true" />,
            disabled: countIn('DOING') === selectedIds.length,
            onClick: () => void moveSelection('DOING', 'en cours'),
          },
          {
            id: 'todo',
            label: 'Rouvrir',
            icon: <RotateCcw className="size-4" aria-hidden="true" />,
            disabled: countIn('TODO') === selectedIds.length,
            title: 'Remettre dans « À corriger »',
            onClick: () => void moveSelection('TODO', 'remises à corriger'),
          },
          {
            id: 'note',
            label: 'Note',
            render: () => (
              <Popover.Root onOpenChange={(open) => open && setNoteDraft('')}>
                <Popover.Trigger className={ACTION_CLASS}>
                  <MessageSquareText className="size-4" aria-hidden="true" />
                  <ExpandingLabel>Note commune</ExpandingLabel>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner side="top" align="center" sideOffset={10} className="z-50">
                    <Popover.Popup className="w-[340px] rounded-xl border border-shade-44 bg-popover p-3 text-sm shadow-xl outline-none">
                      <Popover.Title className="mb-2 font-semibold text-foreground">
                        Note pour {selectedIds.length} tâche{selectedIds.length > 1 ? 's' : ''}
                      </Popover.Title>
                      <textarea
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.target.value)}
                        maxLength={500}
                        rows={3}
                        aria-label="Note commune"
                        placeholder="Ce qui a été fait, par qui, où… (remplace leurs notes)"
                        className="w-full rounded-lg border border-shade-44 bg-shade-16 p-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                      />
                      <Popover.Close
                        onClick={async () => {
                          await updateMany(selectedIds, { note: noteDraft })
                          setToast({ text: `Note enregistrée sur ${selectedIds.length} tâche${selectedIds.length > 1 ? 's' : ''}` })
                        }}
                        className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
                      >
                        Enregistrer
                      </Popover.Close>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            ),
            onClick: () => undefined,
          },
          {
            id: 'remove',
            label: 'Retirer',
            icon: <Trash2 className="size-4" aria-hidden="true" />,
            title: 'Retirer du plan (elles ne reviendront pas seules)',
            onClick: () =>
              setConfirm({
                text: `Retirer ${selectedIds.length} tâche${selectedIds.length > 1 ? 's' : ''} du plan : elles ne reviendront pas seules au prochain audit`,
                confirmLabel: 'Retirer',
                onConfirm: async () => {
                  setConfirm(null)
                  const count = selectedIds.length
                  await updateMany(selectedIds, { remove: true })
                  selection.setSelected([])
                  setToast({ text: `${count} tâche${count > 1 ? 's' : ''} retirée${count > 1 ? 's' : ''} du plan` })
                },
              }),
          },
          {
            id: 'done',
            label: 'Terminer',
            icon: <CheckCheck className="size-4" aria-hidden="true" />,
            primary: true,
            disabled: countIn('DONE') === selectedIds.length,
            onClick: () => void moveSelection('DONE', 'terminées'),
          },
        ]}
      />

      <PageInspectionSheet />
    </div>
  )
}

function DropLine() {
  return <span aria-hidden="true" className="mb-2 block h-[3px] rounded-full bg-primary" />
}

/** Carte d'une tâche : anomalie, page, gravité, impact, constat du dernier audit, conseil, note et déplacements */
function TaskCard({
  task,
  selection,
  order,
  auditDate,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onMove,
  onRemove,
  onNote,
  onOpenPage,
}: {
  task: PlanTask
  selection: RowSelection
  order: string[]
  auditDate?: string
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onMove: (status: FixStatus) => void
  onRemove: () => void
  onNote: (note: string) => void
  onOpenPage?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.note ?? '')
  const index = FIX_STATUSES.indexOf(task.status)
  const previous = FIX_STATUSES[index - 1]
  const next = FIX_STATUSES[index + 1]
  const severity = SEVERITY[task.severity] ?? SEVERITY.WARNING
  const when = auditDate ? ` du ${shortDate(auditDate)}` : ''

  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      aria-label={`${task.title}, ${pageLabel(task)}, ${FIX_STATUS_LABEL[task.status]}`}
      className={`group cursor-grab rounded-xl border bg-card p-3 shadow-sm transition-[opacity,box-shadow] active:cursor-grabbing ${
        selection.isSelected(task.id) ? 'border-primary ring-1 ring-primary' : 'border-shade-33 hover:border-shade-55'
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          <SelectionCheckbox selection={selection} id={task.id} order={order} label={`Sélectionner : ${task.title}, ${pageLabel(task)}`} />
        </span>
        <p className={`min-w-0 text-sm font-semibold leading-snug ${task.status === 'DONE' ? 'text-muted-foreground line-through decoration-shade-55' : 'text-foreground'}`}>
          {task.title}
        </p>
      </div>
      {onOpenPage ? (
        <button
          type="button"
          onClick={onOpenPage}
          className="mt-0.5 block max-w-full truncate rounded font-mono text-xs text-primary-ink hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          title={task.url ?? undefined}
        >
          {task.path}
        </button>
      ) : (
        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={task.url ?? undefined}>
          {pageLabel(task)}
        </p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-full border border-shade-44 px-2 py-0.5 text-muted-foreground">{PILLAR_LABEL[task.pillar] ?? task.pillar}</span>
        {!isCustom(task) && (
          <>
            <span className="inline-flex items-center gap-1 rounded-full border border-shade-44 px-2 py-0.5 text-foreground">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: severity.color }} aria-hidden="true" />
              {severity.label}
            </span>
            <ImpactBadge impact={impactOf(task)} />
          </>
        )}
        {task.source === 'MANUAL' && <span className="text-muted-foreground">ajoutée à la main</span>}
      </p>

      {/* Ce que dit le dernier audit */}
      {task.verification === 'still-detected' && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[#eab308]/10 px-2 py-1.5 text-xs text-amber-soft">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          Encore relevée par l’audit{when}
          <button type="button" onClick={() => onMove('TODO')} className="font-semibold underline">
            Rouvrir
          </button>
        </p>
      )}
      {task.verification === 'not-detected' && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[#12b10f]/10 px-2 py-1.5 text-xs text-green-soft">
          <Check className="size-3.5 shrink-0" aria-hidden="true" />
          Plus relevée par l’audit{when}
          <button type="button" onClick={() => onMove('DONE')} className="font-semibold underline">
            Passer en Terminée
          </button>
        </p>
      )}
      {task.verification === 'page-missing' && (
        <p className="mt-2 text-xs text-muted-foreground">Page absente de l’audit{when} : rien à vérifier.</p>
      )}
      {task.status === 'DONE' && task.doneAt && <p className="mt-1.5 text-xs text-muted-foreground">Terminée le {shortDate(task.doneAt)}</p>}

      {task.recommendation && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer list-none font-semibold text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            {isCustom(task) ? 'Détails' : 'Comment corriger'}
          </summary>
          <p className="mt-1 whitespace-pre-line leading-relaxed text-foreground/90">{task.recommendation}</p>
        </details>
      )}

      {editing ? (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault()
            onNote(draft)
            setEditing(false)
          }}
        >
          <label className="sr-only" htmlFor={`note-${task.id}`}>
            Note sur la tâche
          </label>
          <textarea
            id={`note-${task.id}`}
            value={draft}
            maxLength={500}
            rows={2}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ce qui a été fait, par qui, où…"
            className="w-full rounded-lg border border-shade-44 bg-shade-16 p-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <span className="mt-1 flex gap-2">
            <button type="submit" className="rounded-md bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">
              Enregistrer
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">
              Annuler
            </button>
          </span>
        </form>
      ) : (
        task.note && <p className="mt-2 rounded-lg bg-shade-24 px-2 py-1.5 text-xs text-foreground">{task.note}</p>
      )}

      {/* Déplacements et actions, aussi au clavier */}
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-shade-33 pt-2">
        <span className="flex items-center gap-1">
          {previous && (
            <button
              type="button"
              onClick={() => onMove(previous)}
              aria-label={`Remettre dans « ${FIX_STATUS_LABEL[previous]} »`}
              title={`Remettre dans « ${FIX_STATUS_LABEL[previous]} »`}
              className="rounded-md p-1 text-muted-foreground hover:bg-shade-33 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              {previous === 'TODO' && task.status === 'DONE' ? <RotateCcw className="size-4" aria-hidden="true" /> : <ArrowLeft className="size-4" aria-hidden="true" />}
            </button>
          )}
          {next && (
            <button
              type="button"
              onClick={() => onMove(next)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary-ink hover:bg-shade-33 focus-visible:outline-2 focus-visible:outline-primary"
            >
              {next === 'DOING' ? 'Commencer' : 'Terminer'}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setDraft(task.note ?? '')
              setEditing((value) => !value)
            }}
            aria-label={task.note ? 'Modifier la note' : 'Ajouter une note'}
            title={task.note ? 'Modifier la note' : 'Ajouter une note'}
            className="rounded-md p-1 text-muted-foreground hover:bg-shade-33 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <MessageSquareText className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Retirer du plan"
            title="Retirer du plan (elle ne reviendra pas seule)"
            className="rounded-md p-1 text-muted-foreground hover:bg-shade-33 hover:text-red-soft focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </span>
      </div>
    </article>
  )
}
