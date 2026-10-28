import { napMeasuredPoints } from '@/core/domain/scoring/nap';
import { geoMeasuredPoints } from '@/core/domain/scoring/GeoScoringEngine';
import {
  ProjectAuditData,
  PillarPage,
  SubpageItem,
  GlobalIssue,
  InspectionData,
  PageDetails,
  IssueSeverity,
  IssuePillar,
  InspectionDetail,
} from '@/lib/audit-data';
import type {
  EditorialEvaluation,
  EditorialSignals,
  GeoEvaluation,
  PageRole,
  RoleSignals,
  SerpAnalysis,
  SerpHistoryEntry,
} from '@/core/domain/types';
import {
  freshnessAccordion,
  inContentLinksAccordion,
  qualityAccordion,
  readabilityAccordion,
  unavailableAccordion,
} from './editorial-diagnostics';
import { TECH_THRESHOLDS } from '@/core/domain/scoring/thresholds';
import { buildEeatSchema } from '@/core/domain/scoring/eeat-schema';
import { compareIssues, getIssueImpact, IMPACT_RANK } from '@/lib/issue-impact';
import { getScoreEffect } from '@/lib/score-effect';
import { buildEditorialSections, editorialCategories, intentSummary, positionSummary } from './editorial-sections';
import { classifyPageRole, resolvePageRole, ROLE_LABEL } from '@/core/domain/scoring/page-role';
import { getInspectionTarget } from '@/lib/issue-routing';
import { describePagePosition } from '@/lib/serp-labels';
import { buildSynthesisAdvice } from './synthesis-advice';

// Types d'entrée découplés (représentation des données de persistance)
export type PersistenceProjectWithAudit = {
  id: string;
  domain: string;
  name: string;
  faviconUrl?: string | null;
  audits: PersistenceAuditWithRelations[];
};

export type PersistenceAuditWithRelations = {
  id: string;
  projectId: string;
  status: string;
  progress: number;
  overallScore?: number | null;
  techScore?: number | null;
  editorialScore?: number | null;
  geoScore?: number | null;
  totalPagesCount: number;
  pillarPagesCount: number;
  crawlStartedAt?: Date | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
  project?: {
    id: string;
    domain: string;
    name: string;
    faviconUrl?: string | null;
  };
  pages: PersistencePageRecord[];
  issues: PersistenceIssueRecord[];
};

export type PersistencePageRecord = {
  id: string;
  auditId: string;
  url: string;
  path: string;
  httpStatus: number;
  depth: number;
  isPillar: boolean;
  isIndexable: boolean;
  title?: string | null;
  metaDescription?: string | null;
  h1?: string | null;
  h2Count: number;
  wordCount: number;
  inlinksCount: number;
  outlinksCount: number;
  pageScore?: number | null;
  techScore?: number | null;
  editorialScore?: number | null;
  geoScore?: number | null;
  targetQuery?: string | null;
  targetQuerySource?: string | null;
  metricsRaw?: string | null;
  aiEvaluationRaw?: string | null;
};

export type PersistenceIssueRecord = {
  id: string;
  auditId: string;
  pillar: string;
  severity: string;
  code: string;
  title: string;
  description: string;
  recommendation: string;
  stepsToResolve: string | string[];
  affectedUrl?: string | null;
  metadata?: string | null;
};

type ItemStatus = 'valid' | 'warning' | 'error';
type InspectionItem = { text: string; status: ItemStatus; details?: InspectionDetail[] };

type PageMetrics = {
  responseTimeMs?: number;
  canonicalUrl?: string;
  robotsMeta?: string;
  finalUrl?: string;
  cwv?: { lcp?: number; inp?: number; cls?: number; source?: Partial<Record<'lcp' | 'inp' | 'cls', 'field' | 'lab'>> };
  imagesTotal?: number;
  imagesWithAlt?: number;
  images?: { src: string; alt?: string }[];
  content?: {
    signals?: EditorialSignals;
    hasPublicationDate?: boolean;
    schemaTypes?: string[];
    roleSignals?: RoleSignals;
  };
  roleOverride?: PageRole;
  techMeasuredPoints?: number;
  links?: { href: string; text: string; internal: boolean; nofollow: boolean }[];
  inlinkSources?: string[];
  domain?: { hasLlmsTxt?: boolean; llmsTxtValid?: boolean };
};

type PageEvaluation = {
  editorial?: EditorialEvaluation;
  geo?: GeoEvaluation;
  editorialStatus?: { engine: 'LLM' | 'HEURISTIC'; error?: string };
  serp?: SerpAnalysis;
  serpHistory?: SerpHistoryEntry[];
};

function parseJson<T>(raw?: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readMetrics(page: PersistencePageRecord): PageMetrics | null {
  return parseJson<PageMetrics>(page.metricsRaw);
}

function readEvaluation(page: PersistencePageRecord): PageEvaluation | null {
  return parseJson<PageEvaluation>(page.aiEvaluationRaw);
}

function formatResponseTime(page: PersistencePageRecord): string {
  const ms = readMetrics(page)?.responseTimeMs;
  return typeof ms === 'number' ? `${(ms / 1000).toFixed(2)} s` : '—';
}

/** Nom lisible d'une ressource à partir de son URL (dernier segment du chemin) */
function fileLabel(src: string): string {
  if (src.startsWith('data:')) return 'Image intégrée (data URI)';
  try {
    const last = new URL(src, 'http://placeholder.invalid').pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : src.slice(0, 60);
  } catch {
    return src.slice(0, 60);
  }
}

function absoluteUrl(href: string, pageUrl: string): string | undefined {
  if (href.startsWith('data:')) return undefined;
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return undefined;
  }
}

function imageDetails(page: PersistencePageRecord, metrics: PageMetrics | null): InspectionDetail[] | undefined {
  if (!metrics?.images) return undefined;
  return metrics.images
    .map((image) => ({
      label: fileLabel(image.src),
      note: image.alt?.trim() ? `alt : « ${image.alt.trim()} »` : 'attribut alt manquant',
      href: absoluteUrl(image.src, page.url),
      status: (image.alt?.trim() ? 'valid' : 'error') as ItemStatus,
    }))
    .sort((a, b) => Number(a.status === 'valid') - Number(b.status === 'valid'));
}

function linkDetails(page: PersistencePageRecord, metrics: PageMetrics | null): InspectionDetail[] | undefined {
  if (!metrics?.links) return undefined;
  return metrics.links.map((link) => ({
    label: link.text || '(lien sans texte d’ancre)',
    note: link.href,
    href: absoluteUrl(link.href, page.url),
    tag: `${link.internal ? 'Interne' : 'Externe'}${link.nofollow ? ' · nofollow' : ''}`,
    status: (link.text ? 'valid' : 'warning') as ItemStatus,
  }));
}

function toPageDetails(page: PersistencePageRecord): PageDetails {
  const metrics = readMetrics(page);
  return {
    imagesWithoutAlt: metrics?.images
      ?.filter((image) => !image.alt?.trim())
      .map((image) => fileLabel(image.src)),
    inlinkSources: metrics?.inlinkSources,
    httpStatus: page.httpStatus,
    responseTime: formatResponseTime(page),
    redirectUrl: metrics?.finalUrl,
    title: page.title ?? undefined,
    metaDescription: page.metaDescription ?? undefined,
    h1: page.h1 ?? undefined,
    wordCount: page.wordCount ?? 0,
    depthLevel: page.depth ?? 0,
    inlinks: page.inlinksCount ?? 0,
    robots: metrics?.robotsMeta,
    canonical: metrics?.canonicalUrl,
  };
}

/** Rôle retenu : correction manuelle, puis avis de l'IA, puis détection automatique (chemin, balisage, date) */
function roleOf(page: PersistencePageRecord) {
  const metrics = readMetrics(page);
  const editorial = readEvaluation(page)?.editorial;
  const detected = classifyPageRole({
    path: page.path || '/',
    depth: page.depth ?? 0,
    wordCount: page.wordCount ?? 0,
    hasPublicationDate: metrics?.content?.hasPublicationDate,
    schemaTypes: metrics?.content?.schemaTypes,
    ...metrics?.content?.roleSignals,
  });
  const { role, source } = resolvePageRole({ manual: metrics?.roleOverride, ai: editorial?.role, detected });
  return {
    role,
    roleLabel: ROLE_LABEL[role],
    roleSource: source,
    roleReason: source === 'ai' ? editorial?.roleReason : undefined,
  };
}

/** Étapes de résolution : tableau, ou chaîne JSON issue de la base */
function parseSteps(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((step): step is string => typeof step === 'string') : [];
  } catch {
    return [];
  }
}

function pathOf(page: PersistencePageRecord): string {
  return page.path || (page.url.startsWith('http') ? new URL(page.url).pathname : page.url);
}

function percent(score: number, max: number): number {
  return Math.min(100, Math.max(0, Math.round((score / max) * 100)));
}

function ratioText(items: InspectionItem[]): string {
  return `${items.filter((i) => i.status === 'valid').length}/${items.length}`;
}

function isBlockedPage(page: PersistencePageRecord): boolean {
  return page.httpStatus >= 400 || !page.isIndexable;
}

/**
 * Adaptateur Primaire / Presenter :
 * Transforme les entités de persistance vers les structures attendues par l'UI React.
 *
 * Règles strictes :
 * 1. Cycle de vie en 2 phases : tant que l'audit n'est pas COMPLETED (CRAWLING_TECH,
 *    AWAITING_AI_SELECTION, ANALYZING_AI), `isLocked` vaut true et les scores
 *    éditorial, GEO et global sont null, les pages piliers et les anomalies
 *    éditoriales/GEO ne sont pas exposées.
 * 2. Invariants 4xx/5xx/noindex :
 *    - Si page.httpStatus >= 400 ou page.isIndexable === false, forçage à 0
 *      de editorialScore, geoScore, intentMatchScore et hotZonesScore.
 *    - Aucun fallback arbitraire ne doit masquer un échec de crawl.
 * 3. Les sous-scores d'évaluation sont lus tels que stockés (intentMatch sur 20,
 *    hotZones sur 15) : aucune renormalisation.
 * 4. Sécurisation des valeurs nulles/indéfinies (tableaux vides []).
 */
export class AuditPresenter {
  /**
   * Convertit un audit complet avec ses pages et anomalies en ProjectAuditData pour l'UI
   */
  public static toProjectAuditData(
    audit: PersistenceAuditWithRelations,
    projectInfo?: { id: string; domain: string; name: string }
  ): ProjectAuditData {
    const domain = projectInfo?.domain || audit.project?.domain || 'domaine-inconnu.fr';
    const projectName = projectInfo?.name || audit.project?.name || domain.split('.')[0];
    const projectId = projectInfo?.id || audit.projectId;

    const isLocked = audit.status !== 'COMPLETED';

    const pages = audit.pages ?? [];
    // Phase 1 : seules les anomalies techniques sont exposées
    const issues = (audit.issues ?? []).filter(
      (i) => !isLocked || i.pillar.toUpperCase() === 'TECH'
    );

    const isCrawling = audit.status === 'CRAWLING_TECH' || audit.status === 'QUEUED';
    const totalPages = Math.max(pages.length, audit.totalPagesCount || 0);
    const crawledPages = pages.length;

    // Normalisation des scores globaux en entiers
    const techScore = Math.round(audit.techScore ?? 0);
    const editorialScore = isLocked ? null : Math.round(audit.editorialScore ?? 0);
    const geoScore = isLocked ? null : Math.round(audit.geoScore ?? 0);
    const globalScore = isLocked
      ? null
      : Math.round(
          audit.overallScore ??
            techScore * 0.4 + (editorialScore ?? 0) * 0.35 + (geoScore ?? 0) * 0.25
        );

    const subpages = pages.map((p) => this.toSubpageItem(p));
    const pillarPages = isLocked
      ? []
      : pages.filter((p) => p.isPillar).map((p) => this.toPillarPage(p));

    const globalIssues = this.toGlobalIssues(issues, pages);

    const criticalIssuesCount = globalIssues.filter((i) => i.severity === 'critical').length;
    const warningsCount = globalIssues.filter((i) => i.severity === 'warning').length;
    const goodPracticesCount = globalIssues.filter((i) => i.severity === 'passed').length;

    // Moyennes sur les pages piliers réelles
    const validPillars = pillarPages.filter((p) => p.indexable && p.httpStatus < 400);

    const editorialMean =
      validPillars.length > 0
        ? Math.round(validPillars.reduce((acc, p) => acc + p.editorialScore, 0) / validPillars.length)
        : 0;

    const geoMean =
      validPillars.length > 0
        ? Math.round(validPillars.reduce((acc, p) => acc + p.geoScore, 0) / validPillars.length)
        : 0;

    const cannibalizationConflicts = pillarPages.filter(
      (p) => p.cannibalizationStatus === 'conflict'
    ).length;

    const intentMatchGlobal =
      validPillars.length > 0
        ? Math.round(
            validPillars.reduce((acc, p) => acc + percent(p.intentMatchScore, 20), 0) /
              validPillars.length
          )
        : 0;

    const pillarPageIds = new Set(validPillars.map((p) => p.id));
    const citabilityScores = pages
      .filter((p) => pillarPageIds.has(p.id))
      .map((p) => readEvaluation(p)?.geo?.aiCitability)
      .filter((citability) => citability && citability.applicable !== false)
      .map((citability) => citability?.score)
      .filter((score): score is number => typeof score === 'number');
    const citabilityMean =
      citabilityScores.length > 0
        ? Math.round(
            citabilityScores.reduce((acc, s) => acc + percent(s, 40), 0) / citabilityScores.length
          )
        : 0;

    const domainMeta = pages
      .map((p) => readMetrics(p)?.domain)
      .find((meta) => meta !== undefined);

    const inspections: Record<string, InspectionData> = {};
    for (const page of pages) {
      inspections[page.id] = this.toInspectionData(
        page,
        issues.filter((i) => i.affectedUrl === page.url),
        isLocked
      );
    }

    return {
      projectId,
      domain,
      projectName,
      crawlStats: {
        crawledPages,
        totalPages: totalPages > 0 ? totalPages : 1,
        isCrawling,
      },
      status: audit.status,
      isLocked,
      scores: {
        global: globalScore,
        tech: techScore,
        editorial: editorialScore,
        geo: geoScore,
      },
      kpis: {
        criticalIssuesCount,
        warningsCount,
        goodPracticesCount,
        editorialMean: isLocked ? 0 : editorialMean,
        cannibalizationConflicts: isLocked ? 0 : cannibalizationConflicts,
        intentMatchGlobal: isLocked ? 0 : intentMatchGlobal,
        geoMean: isLocked ? 0 : geoMean,
        llmsTxtStatus: domainMeta?.hasLlmsTxt ? 'Present' : 'Manquant',
        citabilityMean: isLocked ? 0 : citabilityMean,
      },
      pillarPages,
      advice: isLocked
        ? null
        : buildSynthesisAdvice(
            pages
              .filter((p) => p.isPillar && !isBlockedPage(p))
              .flatMap((p) => {
                const evaluation = readEvaluation(p);
                if (!evaluation?.editorial) return [];
                return [
                  {
                    path: pathOf(p),
                    editorialScore: p.editorialScore ?? 0,
                    engine: evaluation.editorialStatus?.engine ?? ('HEURISTIC' as const),
                    evaluation: evaluation.editorial,
                  },
                ];
              })
          ),
      subpages,
      globalIssues,
      inspections,
    };
  }

  /**
   * Convertit un enregistrement Page en SubpageItem pour le tableau d'exploration
   */
  public static toSubpageItem(page: PersistencePageRecord): SubpageItem {
    const wordCount = page.wordCount ?? 0;
    // Google n'impose aucune longueur minimale : seul un contenu quasi vide est signalé
    const wordCountStatus: 'good' | 'warning' | 'critical' = wordCount < 150 ? 'warning' : 'good';

    const statusLabel = `${page.httpStatus} ${page.httpStatus >= 400 ? 'Erreur' : 'OK'}`;

    return {
      id: page.id,
      url: page.url,
      path: pathOf(page),
      title: page.title || page.h1 || 'Page sans titre',
      httpStatus: page.httpStatus,
      statusLabel,
      wordCount,
      wordCountStatus,
      depth: (page.depth ?? 0) < 0 ? 'Sitemap' : `Niv ${page.depth ?? 0}`,
      inlinks: page.inlinksCount ?? 0,
      targetKeyword: page.targetQuery || page.h1?.slice(0, 40) || '',
      isPillar: Boolean(page.isPillar),
      indexable: Boolean(page.isIndexable),
      responseTime: formatResponseTime(page),
      techScore: Math.round(page.techScore ?? 0),
      ...roleOf(page),
      serp: readEvaluation(page)?.serp,
      serpHistory: readEvaluation(page)?.serpHistory,
    };
  }

  /**
   * Convertit une Page pilier avec normalisation stricte :
   * - Si httpStatus >= 400 OU isIndexable === false -> tous les scores éditoriaux/GEO à 0
   * - Sinon les sous-scores sont lus tels que stockés (intentMatch /20, hotZones /15)
   */
  public static toPillarPage(page: PersistencePageRecord): PillarPage {
    const path = pathOf(page);

    // Invariants stricts en cas d'échec de crawl ou noindex
    if (isBlockedPage(page)) {
      return {
        id: page.id,
        url: page.url,
        path,
        title: page.title || page.h1 || 'Page inaccessible ou non indexable',
        targetKeyword: 'Non applicable',
        isAutoDetectedKeyword: false,
        editorialScore: 0,
        intentMatchScore: 0,
        hotZonesScore: 0,
        cannibalizationStatus: 'none',
        cannibalizationTarget: undefined,
        geoScore: 0,
        aiAccessibility: false,
        citability: 'Faible',
        schemaOrgPresent: false,
        techScore: Math.round(page.techScore ?? 0),
        httpStatus: page.httpStatus,
        responseTime: formatResponseTime(page),
        indexable: Boolean(page.isIndexable),
        follow: false,
        ...roleOf(page),
      };
    }

    const evaluation = readEvaluation(page);
    const editorial = evaluation?.editorial;
    const geo = evaluation?.geo;

    // Conflit : score < 10 ET page concurrente identifiée. Recoupement partiel : score < 15 ET page identifiée.
    const cannibal = editorial?.cannibalizationRisk;
    const competingUrl = cannibal?.competingUrl;
    const cannibalizationStatus: PillarPage['cannibalizationStatus'] =
      !competingUrl || !cannibal ? 'none' : cannibal.score < 10 ? 'conflict' : cannibal.score < 15 ? 'partial' : 'none';
    const competingPath = competingUrl
      ? (() => {
          try {
            return new URL(competingUrl).pathname || '/';
          } catch {
            return competingUrl;
          }
        })()
      : undefined;
    const citabilityScore = geo?.aiCitability?.score ?? 0;
    const citability: PillarPage['citability'] =
      citabilityScore >= 28 ? 'Elevée' : citabilityScore >= 16 ? 'Moyenne' : 'Faible';

    return {
      id: page.id,
      url: page.url,
      path,
      title: page.title || page.h1 || 'Page stratégique',
      targetKeyword:
        editorial?.search?.targetQuery.query || page.targetQuery || page.h1?.slice(0, 40) || 'Non détecté',
      isAutoDetectedKeyword: page.targetQuerySource !== 'MANUAL',
      editorialScore: Math.round(page.editorialScore ?? 0),
      intentMatchScore: Math.min(20, Math.max(0, Math.round(editorial?.intentMatch?.score ?? 0))),
      hotZonesScore: Math.min(
        15,
        Math.max(0, Math.round(editorial?.hotZonesOptimization?.score ?? 0))
      ),
      cannibalizationStatus,
      cannibalizationTarget: cannibalizationStatus === 'none' ? undefined : competingPath,
      cannibalizationQuery: cannibalizationStatus === 'none' ? undefined : cannibal?.sharedQuery,
      geoScore: Math.round(page.geoScore ?? 0),
      aiAccessibility: Boolean(
        geo?.aiBotsAccessibility?.gptBotAllowed &&
          geo.aiBotsAccessibility.claudeBotAllowed &&
          geo.aiBotsAccessibility.perplexityBotAllowed
      ),
      citability,
      schemaOrgPresent: Boolean(geo?.schemaOrgLdJson?.hasValidSchema),
      techScore: Math.round(page.techScore ?? 0),
      httpStatus: page.httpStatus,
      responseTime: formatResponseTime(page),
      indexable: Boolean(page.isIndexable),
      follow: true,
      ...roleOf(page),
      serp: evaluation?.serp,
    };
  }

  /**
   * Regroupe les anomalies de la base par code : une entrée par type d'anomalie,
   * avec la liste des URLs impactées.
   */
  public static toGlobalIssues(
    issues: PersistenceIssueRecord[],
    pages: PersistencePageRecord[]
  ): GlobalIssue[] {
    const pagesByUrl = new Map<string, PersistencePageRecord>();
    for (const p of pages) {
      pagesByUrl.set(p.url, p);
      pagesByUrl.set(p.path, p);
    }

    const severityRank: Record<IssueSeverity, number> = { critical: 2, warning: 1, passed: 0 };
    const toSeverity = (raw: string): IssueSeverity => {
      const upper = raw.toUpperCase();
      if (upper === 'CRITICAL' || upper === 'BLOCKING') return 'critical';
      if (upper === 'PASSED' || upper === 'INFO') return 'passed';
      return 'warning';
    };

    const groups = new Map<string, PersistenceIssueRecord[]>();
    for (const issue of issues) {
      const group = groups.get(issue.code) ?? [];
      group.push(issue);
      groups.set(issue.code, group);
    }

    return Array.from(groups.entries()).map(([code, group]) => {
      const first = group[0];
      const severity = group
        .map((i) => toSeverity(i.severity))
        .reduce((max, s) => (severityRank[s] > severityRank[max] ? s : max));

      const pillar = first.pillar.toUpperCase() as IssuePillar;

      let categoryKey: GlobalIssue['categoryKey'] = 'tech';
      let category: GlobalIssue['category'] = 'Tech. & Meta';
      if (pillar === 'EDITORIAL' || pillar === 'GEO') {
        categoryKey = 'content';
        category = 'Content';
      } else if (/H1|HEADING|LINK|ORPHAN|DEPTH|REDIRECT|SITEMAP|CANONICAL/.test(code)) {
        categoryKey = 'structure';
        category = 'Structure';
      }

      const impactedUrls: NonNullable<GlobalIssue['impactedUrls']> = [];
      const previewItems: NonNullable<GlobalIssue['previewItems']> = [];
      const seenUrls = new Set<string>();

      for (const issue of group) {
        if (!issue.affectedUrl || seenUrls.has(issue.affectedUrl)) continue;
        seenUrls.add(issue.affectedUrl);

        const matchedPage = pagesByUrl.get(issue.affectedUrl);
        const path = matchedPage ? pathOf(matchedPage) : issue.affectedUrl;

        impactedUrls.push({
          id: matchedPage?.id || issue.id,
          path,
          fullUrl: issue.affectedUrl,
          title: matchedPage?.title || matchedPage?.h1 || path,
          wordCount: matchedPage?.wordCount ?? 0,
          depth: (matchedPage?.depth ?? 0) < 0 ? 'Sitemap' : `Niv ${matchedPage?.depth ?? 0}`,
          inlinks: matchedPage?.inlinksCount ?? 0,
          details: matchedPage
            ? toPageDetails(matchedPage)
            : {
                httpStatus: 0,
                responseTime: '—',
                wordCount: 0,
                depthLevel: 0,
                inlinks: 0,
              },
        });

        previewItems.push({
          path,
          note: matchedPage
            ? `HTTP ${matchedPage.httpStatus} · ${matchedPage.wordCount} mots`
            : 'Page non répertoriée',
          severity,
        });
      }

      return {
        id: code,
        pillar,
        code,
        title: first.title,
        category,
        categoryKey,
        severity,
        impact: getIssueImpact({ pillar, code, severity }),
        impactCount: impactedUrls.length,
        description: first.description,
        recommendation: first.recommendation,
        steps: parseSteps(first.stepsToResolve),
        previewItems: previewItems.slice(0, 5),
        impactedUrls,
      };
    }).sort(compareIssues);
  }

  /**
   * Construit la structure d'inspection détaillée d'une page pour le tiroir latéral
   * (?inspect=[id]&tab=[tech|editorial|geo]&section=[index d'accordéon]).
   * `locked` (audit non COMPLETED) force les scores éditorial/GEO à 0 et sans détail.
   */
  public static toInspectionData(
    page: PersistencePageRecord,
    pageIssues: PersistenceIssueRecord[] = [],
    locked = false
  ): InspectionData {
    const blocked = isBlockedPage(page);
    const hideAi = blocked || locked;

    const metrics = readMetrics(page);
    const { role } = roleOf(page);
    const evaluation = hideAi ? null : readEvaluation(page);
    const editorial = evaluation?.editorial;
    const geo = evaluation?.geo;
    // Positionnement mesuré (SERP) : n'est utilisé que lorsque l'analyse est terminée
    const serp = evaluation?.serp?.status === 'DONE' ? evaluation.serp : undefined;

    const responseTime = formatResponseTime(page);
    const responseMs = metrics?.responseTimeMs;

    // Points à traiter, triés par impact sur le classement puis par gravité
    const toPriorities = (pillar: string) =>
      pageIssues
        .filter((i) => i.pillar.toUpperCase() === pillar)
        .map((i) => {
          const severity = i.severity.toUpperCase();
          return {
            issue: i,
            critical: severity === 'CRITICAL',
            rank: IMPACT_RANK[
              getIssueImpact({
                pillar: pillar as IssuePillar,
                code: i.code,
                severity: severity === 'CRITICAL' ? 'critical' : severity === 'WARNING' ? 'warning' : 'passed',
              })
            ],
          };
        })
        .sort((a, b) => b.rank - a.rank || Number(b.critical) - Number(a.critical))
        .map(({ issue, critical }) => ({
          type: (critical ? 'alert' : 'optimization') as 'alert' | 'optimization',
          text: issue.title,
          section: getInspectionTarget({ pillar: pillar as IssuePillar, code: issue.code }).section,
          affectsScore: getScoreEffect(issue.code).affects,
          maxPoints: getScoreEffect(issue.code).maxPoints,
        }));

    // ---------------- Technique ----------------
    const titleLength = page.title?.length ?? 0;
    const metaLength = page.metaDescription?.length ?? 0;

    const httpItems: InspectionItem[] = [
      {
        text: `Code de statut HTTP ${page.httpStatus}`,
        status: page.httpStatus < 300 ? 'valid' : page.httpStatus < 400 ? 'warning' : 'error',
      },
      {
        text: page.isIndexable ? 'Page indexable' : 'Page non indexable (noindex ou erreur HTTP)',
        status: page.isIndexable ? 'valid' : 'error',
      },
      {
        text: page.url.startsWith('https') ? 'Protocole HTTPS' : 'Page servie sans HTTPS',
        status: page.url.startsWith('https') ? 'valid' : 'error',
      },
      metrics?.canonicalUrl
        ? { text: `Balise canonique déclarée : ${metrics.canonicalUrl}`, status: 'valid' }
        : { text: 'Balise canonique absente', status: 'warning' },
      ...(metrics?.finalUrl
        ? [{ text: `Redirection unique vers ${metrics.finalUrl}`, status: 'valid' as const }]
        : []),
    ];

    // Statuts pilotés par les anomalies du moteur : le détail ne contredit jamais la To-Do
    const issueFor = (code: string) => pageIssues.find((i) => i.code === code);
    const h1Issue = issueFor('MISSING_H1') ?? issueFor('MULTIPLE_H1') ?? issueFor('H1_LENGTH_UNOPTIMIZED');
    const hierarchyIssue = issueFor('HEADING_HIERARCHY_SKIP');

    const headingItems: InspectionItem[] = [
      h1Issue
        ? {
            text: h1Issue.code === 'MISSING_H1' ? 'Balise H1 absente ou vide' : h1Issue.title,
            status: h1Issue.code === 'MISSING_H1' ? 'error' : 'warning',
          }
        : {
            text: `Balise H1 unique et conforme : "${(page.h1 ?? '').slice(0, 45)}"`,
            status: 'valid',
          },
      hierarchyIssue
        ? { text: hierarchyIssue.description, status: 'warning' }
        : { text: 'Hiérarchie des titres Hn cohérente', status: 'valid' },
      {
        text: `${page.h2Count} balise(s) H2 détectée(s)`,
        status: page.h2Count > 0 ? 'valid' : 'warning',
      },
    ];

    const { title: titleRange, metaDescription: metaRange } = TECH_THRESHOLDS;
    const metaItems: InspectionItem[] = [
      {
        text: page.title
          ? `Balise title présente (${titleLength} caractères, optimal ${titleRange.min} à ${titleRange.max})`
          : 'Balise title manquante',
        status: !page.title
          ? 'error'
          : titleLength >= titleRange.min && titleLength <= titleRange.max
            ? 'valid'
            : 'warning',
      },
      {
        text: page.metaDescription
          ? `Méta description présente (${metaLength} caractères, optimal ${metaRange.min} à ${metaRange.max})`
          : 'Méta description manquante',
        status: !page.metaDescription
          ? 'error'
          : metaLength >= metaRange.min && metaLength <= metaRange.max
            ? 'valid'
            : 'warning',
      },
    ];
    if (typeof metrics?.imagesTotal === 'number' && metrics.imagesTotal > 0) {
      const withAlt = metrics.imagesWithAlt ?? 0;
      metaItems.push({
        text: `${withAlt}/${metrics.imagesTotal} images avec attribut alt`,
        status: withAlt === metrics.imagesTotal ? 'valid' : 'warning',
        details: imageDetails(page, metrics),
      });
    }

    const performanceItems: InspectionItem[] = [
      {
        text:
          typeof responseMs === 'number'
            ? `Temps de réponse du serveur : ${responseTime}`
            : 'Temps de réponse non mesuré',
        status:
          typeof responseMs !== 'number'
            ? 'warning'
            : responseMs < 800
            ? 'valid'
            : responseMs < 1800
            ? 'warning'
            : 'error',
      },
    ];
    if (metrics?.cwv) {
      const origin = (metric: 'lcp' | 'inp' | 'cls') =>
        metrics.cwv?.source?.[metric] === 'field' ? 'utilisateurs réels' : 'mesure de laboratoire';
      const { lcp, inp, cls } = metrics.cwv;
      performanceItems.push(
        typeof lcp === 'number'
          ? {
              text: `LCP : ${lcp} s (${origin('lcp')})`,
              status: lcp <= 2.5 ? 'valid' : lcp <= 4 ? 'warning' : 'error',
            }
          : { text: 'LCP non mesuré', status: 'warning' },
        typeof inp === 'number'
          ? {
              text: `INP : ${inp} ms (${origin('inp')})`,
              status: inp <= 200 ? 'valid' : inp <= 500 ? 'warning' : 'error',
            }
          : {
              text: 'INP non disponible : Google ne le fournit que pour les pages avec assez de trafic réel',
              status: 'warning',
            },
        typeof cls === 'number'
          ? {
              text: `CLS : ${cls} (${origin('cls')})`,
              status: cls <= 0.1 ? 'valid' : cls <= 0.25 ? 'warning' : 'error',
            }
          : { text: 'CLS non mesuré', status: 'warning' }
      );
    } else {
      performanceItems.push({
        text: 'Core Web Vitals non mesurés pour cette page (seules l’accueil et les pages les plus liées sont mesurées)',
        status: 'warning',
      });
    }

    const linkItems: InspectionItem[] = [
      {
        text: `Profondeur de clic : niveau ${page.depth}`,
        status: page.depth <= 3 ? 'valid' : page.depth <= 4 ? 'warning' : 'error',
      },
      {
        text: `${page.inlinksCount} lien(s) interne(s) entrant(s)`,
        status: page.inlinksCount === 0 ? 'error' : page.inlinksCount < 3 ? 'warning' : 'valid',
        details: metrics?.inlinkSources?.map((source) => ({
          label: source,
          href: absoluteUrl(source, page.url),
          tag: 'Page source',
        })),
      },
      {
        text: `${page.outlinksCount} lien(s) sortant(s)${
          metrics?.links && metrics.links.length < page.outlinksCount
            ? ` (${metrics.links.length} premiers listés)`
            : ''
        }`,
        status: 'valid',
        details: linkDetails(page, metrics),
      },
    ];

    const performanceScore =
      typeof responseMs !== 'number' ? null : responseMs < 800 ? 100 : responseMs < 1800 ? 70 : 40;

    const techCategories = [
      { name: 'Indexabilité & HTTP', score: page.httpStatus < 400 && page.isIndexable ? 100 : 0 },
      { name: 'Balises Title & Meta', score: (page.title ? 50 : 0) + (page.metaDescription ? 50 : 0) },
      { name: 'Structure Hn', score: page.h1 ? 100 : 0 },
      ...(performanceScore !== null ? [{ name: 'Performance', score: performanceScore }] : []),
      { name: 'Sécurité HTTPS', score: page.url.startsWith('https') ? 100 : 0 },
    ];

    // ---------------- Éditorial ----------------
    const editorialAccordions: InspectionData['editorial']['accordions'] = editorial
      ? buildEditorialSections({
          editorial,
          role,
          serp,
          signals: metrics?.content?.signals,
          page: { title: page.title, metaDescription: page.metaDescription, wordCount: page.wordCount ?? 0 },
        })
      : [];
    const editorialCategoryBars = editorial ? editorialCategories(editorial, role) : [];

    // ---------------- GEO ----------------
    // Balisage Schema.org (porte aussi les signaux E-E-A-T) : mis en avant si une anomalie le réclame
    const schemaSnippet =
      !hideAi && geo
        ? {
            ...buildEeatSchema({
              url: page.url,
              path: page.path,
              depth: page.depth,
              canonicalUrl: metrics?.canonicalUrl,
              title: page.title ?? undefined,
              h1: page.h1 ?? undefined,
              metaDescription: page.metaDescription ?? undefined,
              hasPublicationDate: Boolean(metrics?.content?.hasPublicationDate),
              lastUpdated: metrics?.content?.signals?.freshness.lastUpdated,
              wordCount: page.wordCount,
              existingSchemaTypes: metrics?.content?.schemaTypes ?? [],
              isLocalBusiness: editorial?.search?.local.isLocalBusiness,
              city: editorial?.search?.local.city,
            }),
            recommended: pageIssues.some(
              (i) => i.code === 'LOW_EEAT_SIGNALS' || i.code === 'MISSING_SCHEMA_ORG_JSONLD' || i.code === 'WEAK_SCHEMA_ORG'
            ),
          }
        : undefined;

    const geoAccordions: InspectionData['geo']['accordions'] = geo
      ? [
          {
            title: '1. Accessibilité & Standards GEO',
            scoreText: `${geo.aiBotsAccessibility.score}/15`,
            aiReasoning: `${geo.aiBotsAccessibility.critique} ${geo.llmsTxtStandard.critique}`,
            items: [
              {
                text: 'Autorisation GPTBot',
                status: geo.aiBotsAccessibility.gptBotAllowed ? 'valid' : 'error',
              },
              {
                text: 'Autorisation ClaudeBot',
                status: geo.aiBotsAccessibility.claudeBotAllowed ? 'valid' : 'error',
              },
              {
                text: 'Autorisation PerplexityBot',
                status: geo.aiBotsAccessibility.perplexityBotAllowed ? 'valid' : 'error',
              },
              // /llms.txt : signalé, hors score (aucun moteur n'a confirmé l'utiliser)
              {
                text: geo.llmsTxtStandard.exists
                  ? `Fichier /llms.txt présent${geo.llmsTxtStandard.isValidFormat ? '' : ' (format à vérifier)'} : hors score`
                  : 'Pas de fichier /llms.txt : hors score, aucun moteur n’a confirmé l’utiliser',
                status: 'info',
                source: 'measured',
              },
            ],
          },
          {
            title: '2. Citabilité & Autorité',
            scoreText: geo.aiCitability.applicable === false ? `${geo.authoritySources.score}/5` : `${geo.aiCitability.score + geo.authoritySources.score}/45`,
            aiReasoning: `${geo.aiCitability.critique} ${geo.aiCitability.source === 'AI' ? geo.aiCitability.actionableAdvice : ''} ${geo.authoritySources.critique}`.replace(/\s+/g, ' ').trim(),
            items: [
              ...(geo.aiCitability.applicable === false
                ? [
                    {
                      text: 'Citabilité sans objet pour une page de contact ou utilitaire : ses 40 pts sortent du calcul',
                      status: 'info' as const,
                    },
                  ]
                : geo.aiCitability.source === 'AI'
                ? [
                    {
                      text: geo.aiCitability.checks
                        ? `Citabilité : ${geo.aiCitability.score}/40, calculée sur des extraits de la page retrouvés mot pour mot`
                        : `Citabilité jugée par l'IA : ${geo.aiCitability.score}/40 (ancienne grille : relancez l'analyse du pilier)`,
                      status: geo.aiCitability.score >= 28 ? ('valid' as const) : ('warning' as const),
                      source: 'ai' as const,
                    },
                    {
                      text: geo.aiCitability.checks
                        ? `${geo.aiCitability.checks.passages} passage(s) citable(s) vérifié(s), compréhensible(s) seul(s) (${[0, 8, 12, 16][Math.min(3, geo.aiCitability.checks.passages)]}/16)`
                        : `${geo.aiCitability.extractableBlocksCount} passage(s) compréhensible(s) seul(s) et repris tel(s) quel(s) par un moteur de réponse`,
                      status: (geo.aiCitability.checks?.passages ?? geo.aiCitability.extractableBlocksCount) > 0 ? ('valid' as const) : ('warning' as const),
                      source: 'ai' as const,
                      details: (geo.aiCitability.quotablePassages ?? []).map((passage) => ({
                        label: `« ${passage} »`,
                        tag: 'Citable',
                        status: 'valid' as const,
                      })),
                    },
                    {
                      text: geo.aiCitability.hasDirectDefinitions
                        ? `La page dit clairement ce qu’elle propose ou explique${geo.aiCitability.checks ? ' (8/8)' : ''}`
                        : `Aucune définition claire de ce que propose la page${geo.aiCitability.checks ? ' (0/8)' : ''}`,
                      status: geo.aiCitability.hasDirectDefinitions ? ('valid' as const) : ('warning' as const),
                      source: 'ai' as const,
                    },
                    {
                      text: geo.aiCitability.hasVerifiableFacts
                        ? `Fait précis et chiffré, vérifiable${geo.aiCitability.checks ? ' (8/8)' : ''}`
                        : `Aucun fait précis et chiffré${geo.aiCitability.checks ? ' (0/8)' : ''}`,
                      status: geo.aiCitability.hasVerifiableFacts ? ('valid' as const) : ('warning' as const),
                      source: 'ai' as const,
                    },
                    ...(geo.aiCitability.checks
                      ? [
                          {
                            text: `${geo.aiCitability.checks.questionHeadings} sous-titre(s) H2/H3 formulé(s) en question (${geo.aiCitability.checks.questionHeadings >= 2 ? 8 : geo.aiCitability.checks.questionHeadings === 1 ? 4 : 0}/8)`,
                            status: geo.aiCitability.checks.questionHeadings >= 2 ? ('valid' as const) : ('warning' as const),
                            source: 'measured' as const,
                          },
                        ]
                      : []),
                  ]
                : [
                    {
                      text: `Citabilité estimée sans IA d'après les sous-titres : ${geo.aiCitability.score}/40 (relancez l'analyse du pilier pour une évaluation du contenu)`,
                      status: 'info' as const,
                      source: 'measured' as const,
                    },
                  ]),
              {
                text: `${geo.authoritySources.externalAuthoritativeLinksCount} lien(s) vers des sources d’autorité`,
                status: geo.authoritySources.externalAuthoritativeLinksCount > 0 ? 'valid' : 'warning',
                source: 'measured',
              },
            ],
          },
          {
            title: '3. Schema.org & Cohérence NAP',
            scoreText: `${geo.schemaOrgLdJson.score + geo.napConsistency.score}/${25 + napMeasuredPoints(geo.napConsistency)}`,
            aiReasoning: `${geo.schemaOrgLdJson.critique} ${geo.napConsistency.actionableAdvice}`,
            schemaSnippet,
            items: [
              {
                text: geo.schemaOrgLdJson.hasValidSchema
                  ? `Données structurées détectées : ${geo.schemaOrgLdJson.schemaTypes.join(', ')}`
                  : 'Aucune donnée structurée détectée dans le HTML initial',
                status: geo.schemaOrgLdJson.hasValidSchema ? 'valid' : 'error',
              },
              ...(geo.napConsistency.measured === false
                ? [
                    {
                      text: 'Aucune coordonnée (téléphone, adresse) détectée sur le site : critère exclu du score',
                      status: 'warning' as const,
                    },
                  ]
                : [
                    {
                      text: geo.napConsistency.detectedPhone
                        ? `Téléphone visible : ${geo.napConsistency.detectedPhone}`
                        : 'Aucun téléphone visible sur cette page',
                      status: geo.napConsistency.detectedPhone ? ('valid' as const) : ('warning' as const),
                    },
                    {
                      text: geo.napConsistency.detectedAddress
                        ? `Adresse visible : ${geo.napConsistency.detectedAddress}`
                        : 'Aucune adresse visible sur cette page',
                      status: geo.napConsistency.detectedAddress ? ('valid' as const) : ('warning' as const),
                    },
                    geo.napConsistency.consistencyMeasured === false
                      ? {
                          text: 'Pas de JSON-LD de coordonnées sur cette page : cohérence non notée (5 pts hors calcul)',
                          status: 'info' as const,
                        }
                      : {
                          text: geo.napConsistency.isConsistent
                            ? 'Coordonnées visibles conformes au JSON-LD de la page'
                            : 'Coordonnées visibles différentes du JSON-LD de la page',
                          status: geo.napConsistency.isConsistent ? ('valid' as const) : ('error' as const),
                        },
                  ]),
            ],
          },
        ]
      : [];

    const geoCategories = geo
      ? [
          { name: 'Autorisations IA', score: percent(geo.aiBotsAccessibility.score, 15) },
          { name: 'Citabilité (Passages)', score: percent(geo.aiCitability.score, 40) },
          { name: 'Preuves & Sources', score: percent(geo.authoritySources.score, 5) },
          { name: 'Entité Schema.org', score: percent(geo.schemaOrgLdJson.score, 25) },
          ...(napMeasuredPoints(geo.napConsistency) === 0
            ? []
            : [{ name: 'Cohérence NAP', score: percent(geo.napConsistency.score, napMeasuredPoints(geo.napConsistency)) }]),
        ]
      : [];

    return {
      pageId: page.id,
      title: page.title || page.h1 || 'Page sans titre',
      url: page.url,
      httpStatus: page.httpStatus,
      indexable: Boolean(page.isIndexable),
      follow: !blocked,
      responseTime,
      details: toPageDetails(page),
      tech: {
        score: Math.round(page.techScore ?? 0),
        coverage:
          typeof metrics?.techMeasuredPoints === 'number' ? { measured: metrics.techMeasuredPoints, total: 100 } : undefined,
        categories: techCategories,
        priorities: toPriorities('TECH'),
        accordions: [
          { title: '1. Indexabilité et Réponses HTTP', scoreText: ratioText(httpItems), items: httpItems },
          { title: '2. Titres & En-têtes (H1-H6)', scoreText: ratioText(headingItems), items: headingItems },
          { title: '3. Balises Title & Meta', scoreText: ratioText(metaItems), items: metaItems },
          { title: '4. Performance', scoreText: ratioText(performanceItems), items: performanceItems },
          { title: '5. Maillage & Architecture', scoreText: ratioText(linkItems), items: linkItems },
        ],
      },
      editorial: {
        score: hideAi ? 0 : Math.round(page.editorialScore ?? 0),
        coverage: hideAi ? undefined : editorial?.coverage,
        targetKeyword:
          editorial?.search?.targetQuery.query || page.targetQuery || page.h1?.slice(0, 40) || 'Non détecté',
        isForcedTarget: page.targetQuerySource === 'MANUAL',
        ...roleOf(page),
        engine: hideAi
          ? undefined
          : (readEvaluation(page)?.editorialStatus ?? { engine: 'HEURISTIC' as const }),
        search: editorial?.search,
        categories: editorialCategoryBars,
        intentSummary: editorial ? intentSummary(editorial, role, serp) : undefined,
        queryConfidence: editorial?.search?.targetQuery.confidence,
        queryKept: editorial?.search?.targetQuery.kept,
        position: editorial ? positionSummary(editorial, role, serp) : undefined,
        priorities: hideAi ? [] : toPriorities('EDITORIAL'),
        accordions: editorialAccordions,
      },
      geo: {
        score: hideAi ? 0 : Math.round(page.geoScore ?? 0),
        coverage: geo && !hideAi ? { measured: geoMeasuredPoints(geo), total: 100 } : undefined,
        categories: geoCategories,
        priorities: hideAi ? [] : toPriorities('GEO'),
        accordions: geoAccordions,
      },
    };
  }
}
