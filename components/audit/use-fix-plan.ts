'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { pageKeyOf, reorderColumn, type FixStatus } from '@/core/domain/fix-plan'
import type { PlanData, PlanTask } from '@/core/services/fix-plan-service'

/**
 * Plan d'action d'un projet côté interface : lecture, ajout depuis Anomalies, déplacement (affiché tout de suite,
 * enregistré ensuite ; relu en cas d'échec), note et retrait
 */
export function useFixPlan(projectId: string, options: { lazy?: boolean } = {}) {
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!options.lazy)

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/plan`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
      setPlan(data as PlanData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan indisponible')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // `lazy` : pas de lecture à l'ouverture (la lecture ajoute les anomalies prioritaires au plan) ; seulement après un ajout
  useEffect(() => {
    if (!options.lazy) void reload()
  }, [reload, options.lazy])

  const call = useCallback(
    async (url: string, init: RequestInit) => {
      try {
        const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
        return data
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Enregistrement impossible')
        await reload()
        return null
      }
    },
    [reload],
  )

  /** Tâche déplacée dans `status`, avant `beforeId` (à la fin sans) */
  const move = useCallback(
    (id: string, status: FixStatus, beforeId?: string | null) => {
      setPlan((current) => {
        if (!current) return current
        const task = current.tasks.find((item) => item.id === id)
        if (!task) return current
        const column = current.tasks.filter((item) => item.status === status && item.id !== id).sort((a, b) => a.position - b.position)
        const order = reorderColumn(column.map((item) => item.id), id, beforeId)
        const now = new Date().toISOString()
        const tasks = current.tasks.map((item): PlanTask => {
          const position = order.indexOf(item.id)
          if (item.id === id) {
            return { ...item, status, position, doneAt: status === 'DONE' ? (item.status === 'DONE' ? item.doneAt : now) : null, verification: null }
          }
          return position >= 0 ? { ...item, position } : item
        })
        return { ...current, tasks }
      })
      void call(`/api/projects/${projectId}/plan/${id}`, { method: 'PATCH', body: JSON.stringify({ status, beforeId: beforeId ?? null }) })
    },
    [call, projectId],
  )

  const remove = useCallback(
    (id: string) => {
      setPlan((current) => (current ? { ...current, tasks: current.tasks.filter((item) => item.id !== id) } : current))
      void call(`/api/projects/${projectId}/plan/${id}`, { method: 'DELETE' })
    },
    [call, projectId],
  )

  const setNote = useCallback(
    (id: string, note: string) => {
      setPlan((current) => (current ? { ...current, tasks: current.tasks.map((item) => (item.id === id ? { ...item, note: note.trim() || null } : item)) } : current))
      void call(`/api/projects/${projectId}/plan/${id}`, { method: 'PATCH', body: JSON.stringify({ note }) })
    },
    [call, projectId],
  )

  /** Ajout d'une ou plusieurs tâches (anomalie × page) ; renvoie le nombre de tâches ajoutées */
  const addWithIds = useCallback(
    async (items: { code: string; url: string | null }[]): Promise<string[]> => {
      const data = await call(`/api/projects/${projectId}/plan`, { method: 'POST', body: JSON.stringify({ items }) })
      if (!options.lazy) await reload()
      return Array.isArray(data?.ids) ? data.ids : []
    },
    [call, projectId, reload, options.lazy],
  )
  const add = useCallback(async (items: { code: string; url: string | null }[]) => (await addWithIds(items)).length, [addWithIds])

  /** Tâche libre (une par adresse si plusieurs) ; renvoie les identifiants créés, ou null avec l'erreur affichée */
  const addCustom = useCallback(
    async (input: { title: string; details?: string; urls?: string[] }): Promise<string[] | null> => {
      const data = await call(`/api/projects/${projectId}/plan`, { method: 'POST', body: JSON.stringify({ custom: input }) })
      if (!data) return null
      await reload()
      return Array.isArray(data.ids) ? data.ids : []
    },
    [call, projectId, reload],
  )

  /** Annulation d'un ajout : les tâches repartent du plan */
  const undoAdd = useCallback(
    async (ids: string[]) => {
      await Promise.all(ids.map((id) => call(`/api/projects/${projectId}/plan/${id}`, { method: 'DELETE' })))
      if (!options.lazy) await reload()
    },
    [call, projectId, reload, options.lazy],
  )

  /** Plusieurs tâches à la fois : statut (ajoutées à la fin de la colonne), note commune ou retrait */
  const updateMany = useCallback(
    async (ids: string[], change: { status?: FixStatus; note?: string; remove?: boolean }) => {
      setPlan((current) => {
        if (!current) return current
        if (change.remove) return { ...current, tasks: current.tasks.filter((item) => !ids.includes(item.id)) }
        const now = new Date().toISOString()
        let next = Math.max(-1, ...current.tasks.filter((item) => item.status === change.status).map((item) => item.position)) + 1
        const moving = current.tasks.filter((item) => ids.includes(item.id)).sort((a, b) => a.status.localeCompare(b.status) || a.position - b.position)
        const positions = new Map(moving.filter((item) => change.status && item.status !== change.status).map((item) => [item.id, next++]))
        return {
          ...current,
          tasks: current.tasks.map((item) => {
            if (!ids.includes(item.id)) return item
            const moved = change.status && item.status !== change.status
            return {
              ...item,
              ...(moved ? { status: change.status!, position: positions.get(item.id)!, doneAt: change.status === 'DONE' ? now : null, verification: null } : {}),
              ...(change.note !== undefined ? { note: change.note.trim() || null } : {}),
            }
          }),
        }
      })
      await call(`/api/projects/${projectId}/plan`, { method: 'PATCH', body: JSON.stringify({ ids, ...change }) })
    },
    [call, projectId],
  )

  /** Statut d'une anomalie sur une page dans le plan (clé `code|clé d'URL`) */
  const statusOf = useMemo(() => {
    const map = new Map((plan?.tasks ?? []).map((task) => [`${task.code}|${task.pageKey}`, task.status]))
    return (code: string, url: string | null) => map.get(`${code}|${url ? pageKeyOf(url) : ''}`)
  }, [plan])

  return { plan, error, loading, reload, move, remove, setNote, add, addWithIds, addCustom, undoAdd, updateMany, statusOf, clearError: () => setError(null) }
}
