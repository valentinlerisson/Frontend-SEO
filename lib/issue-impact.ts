import type { GlobalIssue, ImpactLevel, IssueSeverity } from '@/lib/audit-data'

/**
 * Impact d'une anomalie sur le classement dans Google, d'après ce que Google documente
 * (indexation, pertinence, maillage, contenu utile) et non d'après des conventions SEO.
 * Les anomalies GEO relèvent de la visibilité dans les moteurs de réponse IA.
 */
const HIGH = new Set([
  'FETCH_FAILED',
  'BLOCKED_BY_ROBOTS_TXT',
  'ORPHAN_PAGE',
  'INTENT_MISMATCH',
  'EDITORIAL_BLOCKED_STATUS',
])

const MEDIUM = new Set([
  'MISSING_CANONICAL',
  'LOW_INLINKS_COUNT',
  'NO_HTTPS',
  'REDIRECT_CHAIN',
  'TEMPORARY_REDIRECT',
  'MISSING_H1',
  'HOT_ZONES_UNOPTIMIZED',
  'MISSING_TLDR_SUMMARY',
  'LOW_EEAT_SIGNALS',
  'WEAK_SNIPPET',
  'CONTENT_GAPS',
  'SEMANTIC_GAPS',
  'MISSING_LOCAL_SIGNALS',
  'GENERIC_ANCHORS',
  'NO_CONTEXTUAL_LINKS',
  'NO_FIRST_HAND_EXPERIENCE',
  'GENERIC_CONTENT',
  'CONSENT_GATED_CONTENT',
  'SITE_DUPLICATE_TITLES',
  'SITE_INCONSISTENT_FIGURES',
])

export function getIssueImpact(issue: Pick<GlobalIssue, 'pillar' | 'code' | 'severity'>): ImpactLevel {
  const { pillar, code, severity } = issue

  if (pillar === 'GEO') return 'geo'
  if (code.startsWith('HTTP_') || code.endsWith('_BLOCKED_STATUS') || HIGH.has(code)) return 'high'
  // Une cannibalisation n'a un fort impact que si elle est avérée ; un recoupement partiel est moyen
  if (code === 'CANNIBALIZATION_RISK') return severity === 'passed' ? 'medium' : 'high'
  // Title absent : fort ; seule la méta description absente : faible (aucun effet direct sur le classement)
  if (code === 'MISSING_METADATA') return severity === 'critical' ? 'high' : 'low'
  // Constats de cohérence relevés par l'IA entre les pages : impact moyen, à vérifier
  if (code.startsWith('SITE_FINDING_')) return 'medium'
  if (MEDIUM.has(code) || code.startsWith('CWV_') || code.startsWith('CLICK_DEPTH_')) return 'medium'
  return 'low'
}

export const IMPACT_LABEL: Record<ImpactLevel, string> = {
  high: 'Impact fort',
  medium: 'Impact moyen',
  low: 'Impact faible',
  geo: 'Visibilité IA',
}

export const IMPACT_RANK: Record<ImpactLevel, number> = { high: 4, medium: 3, low: 2, geo: 1 }
const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 2, warning: 1, passed: 0 }

/** Tri par impact, puis gravité, puis nombre de pages concernées */
export function compareIssues(a: GlobalIssue, b: GlobalIssue): number {
  return (
    IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] ||
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    (b.impactCount ?? 0) - (a.impactCount ?? 0)
  )
}

/** Les anomalies à traiter en premier pour progresser dans Google : impact fort ou moyen uniquement */
export function pickPriorities(issues: GlobalIssue[], limit = 5): GlobalIssue[] {
  return issues
    .filter((issue) => issue.impact === 'high' || issue.impact === 'medium')
    .sort(compareIssues)
    .slice(0, limit)
}
