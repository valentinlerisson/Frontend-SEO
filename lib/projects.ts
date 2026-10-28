export type AuditStatus = 'crawling' | 'completed'

/** Scores en %, null tant que le module n'a pas été calculé (ou n'est pas inclus dans l'audit). */
export type AuditScores = {
  tech: number | null
  edito: number | null
  geo: number | null
}

export type Project = {
  id: string
  name: string
  domain: string
  status: AuditStatus
  /** Avancement du crawl, de 0 à 100 */
  progress: number
  scores: AuditScores
  lastAuditMinutesAgo: number
}

export const currentUser = { firstName: 'Valentin' }

export const initialStats = {
  activeProjects: 0,
}

export const emptyScores: AuditScores = { tech: null, edito: null, geo: null }

/** Moyenne des scores disponibles, null si aucun n'est encore calculé. */
export function globalScore(scores: AuditScores): number | null {
  const values = [scores.tech, scores.edito, scores.geo].filter((value): value is number => value !== null)
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function formatRelativeTime(minutesAgo: number) {
  if (minutesAgo < 1) return 'à l’instant'
  if (minutesAgo < 60) return `Il y a ${minutesAgo}m`
  const hours = Math.floor(minutesAgo / 60)
  if (hours < 24) return `Il y a ${hours}h`
  return `Il y a ${Math.floor(hours / 24)}j`
}

/** Normalise une saisie utilisateur ("https://www.site.fr/page" → "site.fr"). Retourne null si invalide. */
export function parseDomain(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
  } catch {
    return null
  }
}

export function projectNameFromDomain(domain: string) {
  const base = domain.split('.')[0]
  return base
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
