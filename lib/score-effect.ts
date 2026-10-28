/**
 * Une anomalie fait-elle varier le score de la page ? Réponse alignée sur les moteurs de scoring
 * (voir docs/tableau-metriques.md) : seules les anomalies liées à un critère noté retirent des points.
 * `maxPoints` : points en jeu sur 100, avant normalisation des critères non mesurés ou sans objet.
 */
export type ScoreEffect = 'counts' | 'partial' | 'none'

export type ScoreEffectInfo = { affects: boolean; maxPoints: number | null }

const EXACT: Record<string, number> = {
  // Technique
  FETCH_FAILED: 100,
  TEMPORARY_REDIRECT: 4,
  REDIRECT_CHAIN: 5,
  ORPHAN_PAGE: 10,
  LOW_INLINKS_COUNT: 5,
  NO_HTTPS: 5,
  BLOCKED_BY_ROBOTS_TXT: 5,
  MISSING_FROM_SITEMAP: 3,
  MISSING_CANONICAL: 3,
  MISSING_H1: 8,
  MISSING_METADATA: 5,
  METADATA_LENGTH_UNOPTIMIZED: 2,
  IMAGES_MISSING_ALT: 2,
  IMAGES_SEVERELY_MISSING_ALT: 5,
  // Éditorial
  EDITORIAL_BLOCKED_STATUS: 100,
  INTENT_MISMATCH: 20,
  CANNIBALIZATION_RISK: 20,
  HOT_ZONES_UNOPTIMIZED: 15,
  MISSING_TLDR_SUMMARY: 15,
  SEMANTIC_GAPS: 20,
  LOW_EEAT_SIGNALS: 10,
  // GEO
  GEO_BLOCKED_STATUS: 100,
  ROBOTS_TXT_BLOCKED_AI_BOTS: 15,
  LOW_AI_CITABILITY: 40,
  MISSING_SCHEMA_ORG_JSONLD: 25,
  WEAK_SCHEMA_ORG: 25,
  NAP_INCONSISTENT: 15
}

export function getScoreEffect(code: string): ScoreEffectInfo {
  if (code in EXACT) return { affects: true, maxPoints: EXACT[code] }
  if (code.startsWith('HTTP_')) return { affects: true, maxPoints: 5 }
  if (code.startsWith('CLICK_DEPTH_')) return { affects: true, maxPoints: 10 }
  if (code.startsWith('CWV_')) {
    return { affects: true, maxPoints: code.includes('LCP') ? 10 : code.includes('INP') ? 8 : 7 }
  }
  // Tout le reste (longueur du H1, hiérarchie Hn, snippet, content gaps, fraîcheur, lisibilité, maillage dans le
  // contenu, expérience vécue, cohérence du site…) est un diagnostic hors score
  return { affects: false, maxPoints: null }
}
