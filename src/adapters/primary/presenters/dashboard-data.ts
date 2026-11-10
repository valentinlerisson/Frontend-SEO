import type { CoreWebVitals, EditorialEvaluation, GeoEvaluation, RawPageData, TechScoreResult } from '@/core/domain/types';
import type { QuerySetMeasure } from '@/core/domain/scoring/query-set';
import { TechScoringEngine } from '@/core/domain/scoring/TechScoringEngine';
import { GEO_ENABLED } from '@/core/domain/features';
import { normalizeText } from '@/core/domain/scoring/autocomplete-relevance';
import {
  editorialCriteria,
  geoCriteria,
  pageLosses,
  siteGains,
  techCriteria,
  type CriterionLoss,
  type CriterionScore,
  type SiteGain
} from '@/core/domain/scoring/score-losses';
import { bandOf, bucketOf, type HealthBand, type PositionBucket } from '@/lib/score-bands';

export { bandOf, bucketOf, type HealthBand, type PositionBucket };

/**
 * Données des graphiques de la Synthèse et de l'onglet « L'essentiel » : points perdus par critère, demande de
 * recherche répartie par position Google, état des pages, évolution des notes d'un audit à l'autre.
 */

type PageLike = {
  url: string;
  path: string;
  httpStatus: number;
  depth: number;
  isPillar: boolean;
  isIndexable: boolean;
  title?: string | null;
  metaDescription?: string | null;
  h1?: string | null;
  wordCount: number;
  inlinksCount: number;
  outlinksCount: number;
  techScore?: number | null;
  editorialScore?: number | null;
  geoScore?: number | null;
  metricsRaw?: string | null;
  aiEvaluationRaw?: string | null;
};

type TechMetrics = {
  cwv?: CoreWebVitals;
  imagesTotal?: number;
  imagesWithAlt?: number;
  hasSsl?: boolean;
  canonicalUrl?: string;
  robotsMeta?: string;
  finalUrl?: string;
  redirectHops?: number;
  redirectStatuses?: number[];
  discoveredVia?: 'links' | 'sitemap';
  linkGraphComplete?: boolean;
  techBreakdown?: TechScoreResult['breakdown'];
  techUnmeasured?: TechScoreResult['breakdown'];
  content?: { headings?: { level: number; text: string }[] };
};

function parse<T>(raw?: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Critères techniques d'une page. Enregistrés à l'exploration depuis le 04/11/2026 ; pour un audit plus ancien, la note
 * est recalculée à partir des données gardées (robots.txt et sitemap déduits des anomalies de la page) et le détail
 * n'est retenu que si le recalcul retombe exactement sur la note enregistrée : jamais un détail inventé.
 */
const techCache = new WeakMap<object, CriterionScore[] | null>();

export function techCriteriaOf(page: PageLike, issueCodes: string[]): CriterionScore[] | undefined {
  // Même enregistrement de page appelé pour la page et pour le site : recalcul fait une seule fois
  if (techCache.has(page)) return techCache.get(page) ?? undefined;
  const criteria = computeTechCriteria(page, issueCodes);
  techCache.set(page, criteria ?? null);
  return criteria;
}

function computeTechCriteria(page: PageLike, issueCodes: string[]): CriterionScore[] | undefined {
  const metrics = parse<TechMetrics>(page.metricsRaw);
  if (!metrics) return undefined;
  if (metrics.techBreakdown) return techCriteria(metrics.techBreakdown, metrics.techUnmeasured);
  if (typeof page.techScore !== 'number') return undefined;

  const blocked = issueCodes.includes('BLOCKED_BY_ROBOTS_TXT');
  const outOfSitemap = issueCodes.includes('MISSING_FROM_SITEMAP');
  const base: RawPageData = {
    url: page.url,
    path: page.path,
    httpStatus: page.httpStatus,
    depth: page.depth,
    isPillar: page.isPillar,
    isIndexable: page.isIndexable,
    canonicalUrl: metrics.canonicalUrl,
    robotsMeta: metrics.robotsMeta,
    finalUrl: metrics.finalUrl,
    title: page.title ?? undefined,
    metaDescription: page.metaDescription ?? undefined,
    h1: page.h1 ?? undefined,
    h1Count: page.h1 ? 1 : 0,
    headings: metrics.content?.headings ?? [],
    headingHierarchyValid: true,
    headingHierarchyErrors: [],
    wordCount: page.wordCount,
    inlinksCount: page.inlinksCount,
    outlinksCount: page.outlinksCount,
    links: [],
    images: [],
    imagesTotal: metrics.imagesTotal ?? 0,
    imagesWithAlt: metrics.imagesWithAlt ?? 0,
    hasSsl: metrics.hasSsl ?? page.url.startsWith('https://'),
    redirectHops: metrics.redirectHops ?? 0,
    redirectStatuses: metrics.redirectStatuses,
    discoveredVia: metrics.discoveredVia,
    linkGraphComplete: metrics.linkGraphComplete,
    coreWebVitals: metrics.cwv,
    fetchError: page.httpStatus === 0 ? 'fetch' : undefined,
    hasSchemaOrg: false,
    schemaTypes: [],
    first100Words: '',
    hasAuthor: false,
    hasPublicationDate: false,
    externalAuthoritativeLinksCount: 0,
    bodyText: ''
  };
  // robots.txt et sitemap ne sont pas gardés : la valeur déduite des anomalies, puis « non mesuré »
  const variants: Pick<RawPageData, 'isBlockedByRobotsTxt' | 'inSitemap'>[] = [
    { isBlockedByRobotsTxt: blocked, inSitemap: !outOfSitemap },
    { isBlockedByRobotsTxt: blocked, inSitemap: undefined },
    { isBlockedByRobotsTxt: undefined, inSitemap: !outOfSitemap },
    { isBlockedByRobotsTxt: undefined, inSitemap: undefined }
  ];
  for (const variant of variants) {
    const result = TechScoringEngine.calculate({ ...base, ...variant });
    if (result.score === Math.round(page.techScore)) return techCriteria(result.breakdown, result.unmeasuredBreakdown);
  }
  return undefined;
}

/** Page en noindex volontaire (sans erreur HTTP) : hors de la moyenne technique, comme dans GlobalScoringEngine */
export function excludedFromTechAverage(page: Pick<PageLike, 'isIndexable' | 'httpStatus'>): boolean {
  return !page.isIndexable && page.httpStatus < 400;
}

type Evaluation = { editorial?: EditorialEvaluation; geo?: GeoEvaluation };

/** Points perdus d'une page, tous piliers confondus (éditorial et GEO seulement si l'IA a analysé la page) */
export function lossesOfPage(page: PageLike, issueCodes: string[], withAi: boolean): CriterionLoss[] {
  const evaluation = parse<Evaluation>(page.aiEvaluationRaw);
  const tech = techCriteriaOf(page, issueCodes) ?? [];
  const ai = withAi && page.isPillar ? [editorialCriteria(evaluation?.editorial?.points), GEO_ENABLED ? geoCriteria(evaluation?.geo) : []] : [];
  return [tech, ...ai].flatMap((criteria) => pageLosses(criteria)).sort((a, b) => b.lost - a.lost);
}

/**
 * Gains possibles pour le site : critères des pages comptées dans chaque moyenne (technique : toutes sauf noindex
 * volontaire ; éditorial et GEO : pages piliers analysées). `techAvailable` : part des pages dont le détail technique
 * est connu (un audit ancien peut en manquer).
 */
export function siteGainsOf(
  pages: PageLike[],
  issueCodesByUrl: Map<string, string[]>,
  withAi: boolean
): { gains: SiteGain[]; techKnown: number; techCounted: number } {
  const criteria: CriterionScore[][] = [];
  let techKnown = 0;
  let techCounted = 0;
  for (const page of pages) {
    if (!excludedFromTechAverage(page)) {
      techCounted += 1;
      const tech = techCriteriaOf(page, issueCodesByUrl.get(page.url) ?? []);
      if (tech) {
        techKnown += 1;
        criteria.push(tech);
      }
    }
    if (withAi && page.isPillar && page.httpStatus < 400 && page.isIndexable) {
      const evaluation = parse<Evaluation>(page.aiEvaluationRaw);
      // GEO mis de côté : ses critères ne figurent plus parmi les points perdus
      criteria.push(editorialCriteria(evaluation?.editorial?.points), GEO_ENABLED ? geoCriteria(evaluation?.geo) : []);
    }
  }
  return { gains: siteGains(criteria), techKnown, techCounted };
}

export interface SearchDemand {
  /** Les volumes Keyword Planner sont connus pour au moins une requête */
  hasVolumes: boolean;
  totalVolume: number;
  totalQueries: number;
  buckets: { key: PositionBucket; queries: number; volume: number }[];
  /** Requêtes les plus recherchées hors du top 10 (ou pas encore mesurées) */
  opportunities: { query: string; volume?: number; path: string; position?: number | null }[];
}

/**
 * Demande de recherche des pages piliers : leurs requêtes notées (une fois chacune, meilleure position gardée), réparties
 * par position Google mesurée. Pondérée par le volume quand il est connu, sinon comptée en requêtes.
 */
export function searchDemandOf(pages: PageLike[]): SearchDemand | undefined {
  const byQuery = new Map<string, { query: string; volume?: number; path: string; position?: number | null }>();
  for (const page of pages) {
    if (!page.isPillar) continue;
    const set = parse<{ editorial?: { querySet?: QuerySetMeasure[] } }>(page.aiEvaluationRaw)?.editorial?.querySet ?? [];
    for (const entry of set) {
      const key = normalizeText(entry.query);
      const current = byQuery.get(key);
      const rank = (value: number | null | undefined) => (value === undefined ? 1000 : value === null ? 999 : value);
      if (!current || rank(entry.position) < rank(current.position)) {
        byQuery.set(key, { query: entry.query, volume: entry.volume ?? current?.volume, path: page.path, position: entry.position });
      }
    }
  }
  const queries = [...byQuery.values()];
  if (queries.length === 0) return undefined;
  const order: PositionBucket[] = ['top3', 'top10', 'top30', 'absent', 'unmeasured'];
  const buckets = order.map((key) => {
    const inBucket = queries.filter((query) => bucketOf(query.position) === key);
    return { key, queries: inBucket.length, volume: inBucket.reduce((sum, query) => sum + (query.volume ?? 0), 0) };
  });
  const totalVolume = buckets.reduce((sum, bucket) => sum + bucket.volume, 0);
  const opportunities = queries
    .filter((query) => !['top3', 'top10'].includes(bucketOf(query.position)))
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 3);
  return { hasVolumes: totalVolume > 0, totalVolume, totalQueries: queries.length, buckets, opportunities };
}

export interface PageHealth {
  pillar: 'tech' | 'editorial' | 'geo';
  counts: Record<HealthBand, number>;
}

/** Pages par tranche de note : technique sur les pages comptées dans sa moyenne, éditorial et GEO sur les piliers */
export function pageHealthOf(pages: PageLike[], withAi: boolean): PageHealth[] {
  const count = (scores: number[]) => {
    const counts: Record<HealthBand, number> = { weak: 0, medium: 0, strong: 0 };
    for (const score of scores) counts[bandOf(score)] += 1;
    return counts;
  };
  const techPages = pages.filter((page) => !excludedFromTechAverage(page));
  const pillars = pages.filter((page) => page.isPillar && page.httpStatus < 400 && page.isIndexable);
  return [
    { pillar: 'tech', counts: count(techPages.map((page) => Math.round(page.techScore ?? 0))) },
    ...(withAi
      ? [
          // Pages non notées (contact, légal, utilitaire : note nulle) hors de la répartition
          { pillar: 'editorial' as const, counts: count(pillars.flatMap((page) => (typeof page.editorialScore === 'number' ? [Math.round(page.editorialScore)] : []))) },
          ...(GEO_ENABLED ? [{ pillar: 'geo' as const, counts: count(pillars.map((page) => Math.round(page.geoScore ?? 0))) }] : [])
        ]
      : [])
  ];
}
