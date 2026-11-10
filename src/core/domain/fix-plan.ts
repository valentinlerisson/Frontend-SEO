/**
 * Plan d'action : chaque correction est une anomalie sur une page précise (ou sur tout le site). Corriger le H1 de
 * /contact/ ne corrige pas celui de /a-propos/ : ce sont deux tâches. Les tâches vivent d'un audit à l'autre, repérées
 * par le code de l'anomalie et la clé d'URL de la page ; le dernier audit terminé dit si l'anomalie est encore là.
 */

/** Clé de comparaison d'une URL : nom d'hôte sans www, chemin sans slash final, requête conservée */
export function pageKeyOf(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}${u.search}`
  } catch {
    return url
  }
}

/**
 * Tâche libre (créée à la main, sans anomalie) : son `code` commence par ce préfixe, suivi d'un identifiant unique, et
 * son pilier est `CUSTOM_PILLAR`. Le dernier audit ne la vérifie pas : elle se déplace et se termine à la main.
 */
export const CUSTOM_CODE_PREFIX = 'CUSTOM:'
export const CUSTOM_PILLAR = 'CUSTOM'

export type FixStatus = 'TODO' | 'DOING' | 'DONE'

export const FIX_STATUSES: FixStatus[] = ['TODO', 'DOING', 'DONE']

export const FIX_STATUS_LABEL: Record<FixStatus, string> = {
  TODO: 'À corriger',
  DOING: 'En cours',
  DONE: 'Terminée',
}

/**
 * Ce que dit le dernier audit d'une tâche :
 * - `still-detected` : tâche terminée, mais l'anomalie est encore relevée sur la page ;
 * - `not-detected` : tâche ouverte, mais l'anomalie n'est plus relevée (corrigée, ou le barème a changé) ;
 * - `page-missing` : la page n'a pas été explorée au dernier audit, rien à conclure ;
 * - null : rien à signaler (ou audit qui ne permet pas de conclure).
 */
export type FixVerification = 'still-detected' | 'not-detected' | 'page-missing' | null

export function verificationOf(
  task: { status: FixStatus; createdAt: Date; doneAt?: Date | null; pillar: string; pageKey: string },
  audit: {
    /** Fin de l'audit de référence ; une tâche créée après ne peut pas avoir été vérifiée par lui */
    completedAt: Date | null
    /** Anomalies du pilier relevées par cet audit (le contenu n'est analysé qu'après le choix des pages stratégiques) */
    pillarChecked: boolean
    detected: boolean
    /** Page explorée par l'audit (toujours vrai pour une anomalie du site entier) */
    pageCrawled: boolean
  },
): FixVerification {
  if (!audit.completedAt || !audit.pillarChecked) return null
  if (task.pageKey && !audit.pageCrawled) return 'page-missing'
  // Terminée : signalée seulement si l'audit est postérieur à la fin de la tâche (avant, il ne pouvait que la relever)
  if (task.status === 'DONE') return audit.detected && task.doneAt && task.doneAt < audit.completedAt ? 'still-detected' : null
  if (!audit.detected && task.createdAt < audit.completedAt) return 'not-detected'
  return null
}

/**
 * Ordre d'une colonne après un déplacement : la tâche `id` est placée avant `beforeId` (à la fin si absent ou
 * inconnu) ; renvoie les identifiants dans le nouvel ordre
 */
export function reorderColumn(ids: string[], id: string, beforeId?: string | null): string[] {
  const rest = ids.filter((item) => item !== id)
  const index = beforeId ? rest.indexOf(beforeId) : -1
  if (index < 0) return [...rest, id]
  return [...rest.slice(0, index), id, ...rest.slice(index)]
}
