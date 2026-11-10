import type { BacklinkAnchorType, BacklinkDiscovery, BacklinkLocation, BacklinkReport } from '@/core/domain/types'

const MONTHS: Record<string, string> = {
  jan: 'janvier', feb: 'février', mar: 'mars', apr: 'avril', may: 'mai', jun: 'juin',
  jul: 'juillet', aug: 'août', sep: 'septembre', oct: 'octobre', nov: 'novembre', dec: 'décembre',
}

/** « cc-main-2026-aug-sep-oct » devient « août à octobre 2026 » */
export function releaseLabel(release?: string): string {
  const match = release?.match(/^cc-main-(\d{4})-([a-z]{3})-[a-z]{3}-([a-z]{3})$/)
  if (!match) return release ?? 'version inconnue'
  return `${MONTHS[match[2]] ?? match[2]} à ${MONTHS[match[3]] ?? match[3]} ${match[1]}`
}

export const LOCATION_LABEL: Record<BacklinkLocation, string> = {
  content: 'Dans le contenu',
  header: 'En-tête',
  nav: 'Menu',
  footer: 'Pied de page',
  aside: 'Colonne latérale',
  comment: 'Commentaires',
  unknown: 'Emplacement inconnu',
}

export const ANCHOR_TYPE_LABEL: Record<BacklinkAnchorType, string> = {
  brand: 'Marque',
  url: 'Adresse',
  generic: 'Formule générique',
  image: 'Image',
  other: 'Texte libre',
}

/** Chiffres de la recherche des liens précis */
export function discoverySummary(discovery: BacklinkDiscovery) {
  return {
    links: discovery.links.length,
    sites: new Set(discovery.links.map((link) => link.sourceDomain)).size,
    outsideCommonCrawl: new Set(discovery.links.filter((link) => !link.inCommonCrawl).map((link) => link.sourceDomain)).size,
    inContent: discovery.links.filter((link) => link.location === 'content').length,
    nofollow: discovery.links.filter((link) => link.nofollow || link.sponsored || link.ugc).length,
    mentions: discovery.mentions.length,
  }
}

/** Une recherche « en cours » sans avancée depuis 15 minutes est considérée comme interrompue (serveur arrêté) */
export function discoveryInterrupted(discovery: BacklinkDiscovery, now = Date.now()): boolean {
  return discovery.status === 'RUNNING' && now - Date.parse(discovery.updatedAt) > 15 * 60_000
}

/** Chiffres de popularité affichés dans la synthèse et l'onglet Backlinks */
export function backlinkSummary(report: BacklinkReport) {
  const domains = report.referringDomains
  const verified = domains.filter((item) => item.verification)
  const found = verified.filter((item) => item.verification?.status === 'FOUND')
  const links = found.flatMap((item) => item.verification?.links ?? [])
  return {
    domains: domains.length,
    verified: verified.length,
    found: found.length,
    links: links.length,
    nofollow: links.filter((link) => link.nofollow).length,
    /** Pages du site qui reçoivent au moins un lien vérifié */
    targets: new Set(links.map((link) => link.targetUrl)).size,
  }
}
