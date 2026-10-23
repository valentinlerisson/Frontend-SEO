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
  activeProjects: 42,
  auditsThisMonth: 128,
}

export const emptyScores: AuditScores = { tech: null, edito: null, geo: null }

function completed(
  id: string,
  name: string,
  domain: string,
  scores: AuditScores,
  lastAuditMinutesAgo: number,
): Project {
  return { id, name, domain, status: 'completed', progress: 100, scores, lastAuditMinutesAgo }
}

export const initialProjects: Project[] = [
  {
    id: 'interbio',
    name: 'InterBIO',
    domain: 'interbio.fr',
    status: 'crawling',
    progress: 45,
    scores: emptyScores,
    lastAuditMinutesAgo: 0,
  },
  completed('tariquet', 'Tariquet', 'tariquet.fr', { tech: 56, edito: null, geo: null }, 15),
  completed('big-happy', 'Big Happy', 'big-happy.fr', { tech: 82, edito: 82, geo: 82 }, 120),
  completed('maison-lafitte', 'Maison Lafitte', 'maison-lafitte.fr', { tech: 74, edito: 68, geo: 51 }, 300),
  completed('cave-du-sud', 'Cave du Sud', 'cavedusud.com', { tech: 63, edito: 71, geo: null }, 480),
  completed('atelier-roux', 'Atelier Roux', 'atelier-roux.fr', { tech: 91, edito: 77, geo: 64 }, 1440),
  completed('terre-et-mer', 'Terre & Mer', 'terre-et-mer.fr', { tech: 48, edito: 55, geo: 39 }, 2880),
  completed('ecolo-shop', 'Ecolo Shop', 'ecolo-shop.com', { tech: 69, edito: null, geo: null }, 4320),
  completed('bordeaux-tech', 'Bordeaux Tech', 'bordeaux-tech.io', { tech: 88, edito: 81, geo: 72 }, 5760),
  completed('les-jardins', 'Les Jardins', 'lesjardins.fr', { tech: 59, edito: 62, geo: 47 }, 7200),
  completed('pyrene-sport', 'Pyrène Sport', 'pyrene-sport.fr', { tech: 77, edito: 70, geo: null }, 8640),
  completed('oceane-voyages', 'Océane Voyages', 'oceane-voyages.com', { tech: 66, edito: 73, geo: 58 }, 10080),
]

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
