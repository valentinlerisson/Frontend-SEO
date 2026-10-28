import type { BacklinkReport } from '@/core/domain/types'

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
  }
}
