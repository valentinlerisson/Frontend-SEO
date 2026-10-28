import type { GlobalIssue } from '@/lib/audit-data'
import type { InspectionTab } from '@/components/providers/inspection-provider'

export type InspectionTarget = { tab: InspectionTab; section: number }

/**
 * Index d'accordéon (dans le tiroir d'inspection) correspondant à un code d'anomalie.
 * Doit rester aligné avec l'ordre des accordéons construits par AuditPresenter.toInspectionData.
 *
 * tech      : 0 HTTP & indexabilité, 1 titres Hn, 2 title & meta, 3 performance, 4 maillage
 * editorial : 0 intention, 1 cannibalisation, 2 zones chaudes, 3 réponse directe / proposition de valeur,
 *             4 couverture du sujet, 5 E-E-A-T, 6 ce que montre Google, 7 title & méta, 8 ancrage local,
 *             9 fraîcheur, 10 lisibilité, 11 liens dans le contenu, 12 expérience vécue & originalité
 * geo       : 0 accessibilité & standards, 1 citabilité & autorité, 2 schema.org & NAP
 */
export function getInspectionTarget(issue: Pick<GlobalIssue, 'pillar' | 'code'>): InspectionTarget {
  const { pillar, code } = issue

  if (pillar === 'EDITORIAL') {
    const sections: Record<string, number> = {
      INTENT_MISMATCH: 0,
      CANNIBALIZATION_RISK: 1,
      HOT_ZONES_UNOPTIMIZED: 2,
      MISSING_TLDR_SUMMARY: 3,
      SEMANTIC_GAPS: 4,
      LOW_EEAT_SIGNALS: 5,
      CONTENT_GAPS: 4,
      WEAK_SNIPPET: 7,
      MISSING_LOCAL_SIGNALS: 8,
      OUTDATED_YEAR_MENTIONS: 9,
      STALE_UPDATE_DATE: 9,
      DENSE_PARAGRAPHS: 10,
      LONG_SENTENCES: 10,
      NO_LISTS_OR_TABLES: 10,
      GENERIC_ANCHORS: 11,
      NO_CONTEXTUAL_LINKS: 11,
      NO_FIRST_HAND_EXPERIENCE: 12,
      GENERIC_CONTENT: 12,
      MISSING_REASSURANCE: 12,
    }
    return { tab: 'editorial', section: sections[code] ?? 0 }
  }

  if (pillar === 'GEO') {
    if (code === 'LOW_AI_CITABILITY') return { tab: 'geo', section: 1 }
    if (code === 'MISSING_SCHEMA_ORG_JSONLD' || code === 'WEAK_SCHEMA_ORG') return { tab: 'geo', section: 2 }
    return { tab: 'geo', section: 0 }
  }

  if (code.startsWith('CWV_')) return { tab: 'tech', section: 3 }
  if (code === 'MULTIPLE_H1' || code === 'MISSING_H1' || code === 'H1_LENGTH_UNOPTIMIZED' || code.startsWith('HEADING_')) {
    return { tab: 'tech', section: 1 }
  }
  if (
    code === 'MISSING_METADATA' ||
    code === 'METADATA_LENGTH_UNOPTIMIZED' ||
    code === 'MISSING_CANONICAL' ||
    code.startsWith('IMAGES_')
  ) {
    return { tab: 'tech', section: 2 }
  }
  if (code.startsWith('CLICK_DEPTH_') || code === 'LOW_INLINKS_COUNT' || code === 'ORPHAN_PAGE') {
    return { tab: 'tech', section: 4 }
  }
  // HTTP_4xx/5xx, redirections, HTTPS, robots.txt, sitemap : indexabilité & HTTP
  return { tab: 'tech', section: 0 }
}

export type IssueKind = 'tags' | 'http' | 'content' | 'links' | 'images' | 'indexability' | 'generic'

/** Nature de l'anomalie : détermine les indicateurs affichés pour chaque page impactée. */
export function getIssueKind(issue: Pick<GlobalIssue, 'pillar' | 'code'>): IssueKind {
  const { pillar, code } = issue

  if (code.startsWith('IMAGES_')) return 'images'
  if (
    code === 'MISSING_METADATA' ||
    code === 'METADATA_LENGTH_UNOPTIMIZED' ||
    code === 'MISSING_H1' ||
    code === 'H1_LENGTH_UNOPTIMIZED' ||
    code === 'MULTIPLE_H1' ||
    code.startsWith('HEADING_')
  ) {
    return 'tags'
  }
  if (code.startsWith('HTTP_') || code === 'TEMPORARY_REDIRECT' || code === 'REDIRECT_CHAIN') {
    return 'http'
  }
  if (code === 'ORPHAN_PAGE' || code === 'LOW_INLINKS_COUNT' || code.startsWith('CLICK_DEPTH_')) {
    return 'links'
  }
  if (
    code === 'BLOCKED_BY_ROBOTS_TXT' ||
    code === 'MISSING_CANONICAL' ||
    code === 'MISSING_FROM_SITEMAP' ||
    code.endsWith('_BLOCKED_STATUS')
  ) {
    return 'indexability'
  }
  if (pillar === 'EDITORIAL' || code.includes('THIN')) return 'content'
  return 'generic'
}
