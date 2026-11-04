import { createHash } from 'crypto';
import type { Page } from '@prisma/client';
import { prisma } from '@/adapters/secondary/database/prisma';
import { GoogleAutocomplete } from '@/adapters/secondary/search-data/google-autocomplete';
import { keywordVolumeProvider } from '@/adapters/secondary/search-data/keyword-volume-provider';
import { buildKeywordRows, keywordSeeds, matchEvidenceVerified, MAX_JUDGED_KEYWORDS, type KeywordResearch } from '../domain/keyword-research';
import { buildQuerySet, MIN_SCORED_VOLUME } from '../domain/scoring/query-set';
import { jobRegistry } from './job-registry';
import type { PageRewrite } from '../domain/page-rewrite';
import { llmGateway } from '@/adapters/secondary/llm/llm-gateway';
import { RenderedSchema } from '@/adapters/secondary/crawler/rendered-schema';
import { SiteCrawler } from '@/adapters/secondary/crawler/site-crawler';
import { TechScoringEngine } from '../domain/scoring/TechScoringEngine';
import { EditorialScoringEngine } from '../domain/scoring/EditorialScoringEngine';
import { GeoScoringEngine, geoMeasuredPoints } from '../domain/scoring/GeoScoringEngine';
import { GlobalScoringEngine } from '../domain/scoring/GlobalScoringEngine';
import { napMeasuredPoints, analyzeNap } from '../domain/scoring/nap';
import { PageSpeedInsights } from '@/adapters/secondary/speed/pagespeed';
import { CommonCrawlBacklinkIndex } from '@/adapters/secondary/backlinks/common-crawl-index';
import { verifyReferringDomains } from '@/adapters/secondary/backlinks/backlink-verifier';
import type { BacklinkIndexPort } from '../ports/backlink-index';
import { compareReferringDomains } from '../domain/backlinks';
import { isArchivePath, resolveCrawlScope } from '../domain/crawl-scope';
import { prioritizeSearches, remainingSearches, resolveSerpBudget, usageDay, type SerpBudget } from '../domain/serp-budget';
import { serpFacts } from '../domain/serp-insights';
import { MAX_PROJECT_ZONES, measurementZones, queryForZone, zoneTag, type GeoZone } from '../domain/zones';
import { GeoApi } from '@/adapters/secondary/geo/geo-api';
import { createSerpProvider } from '@/adapters/secondary/serp/create-serp-provider';
import { SerpBlockedError, type SerpProviderPort } from '../ports/serp-provider';
import { buildSerpAnalysis } from '../domain/scoring/serp-analysis';
import { classifyPageRole, hubChildKind, resolvePageRole } from '../domain/scoring/page-role';
import { resolveGoal } from '../domain/scoring/page-goal';
import {
  brandVariants,
  filterRelevantSuggestions,
  isSameQuery,
  isUsableSeed,
  normalizeText,
  stripBrand,
  stripPlaces,
  suggestionSeeds
} from '../domain/scoring/autocomplete-relevance';
import { buildSiteCoherenceIssues, DETERMINISTIC_SITE_CODES } from '../domain/scoring/site-coherence';
import {
  serpForQuery,
  betterMeasuredTarget,
  chooseTargetQuery,
  CANDIDATES_VERSION,
  chosenSerpQueries,
  containsBrand,
  mentionedInPage,
  sanitizeCandidates,
  serpQueriesFor
} from '../domain/scoring/query-candidates';
import {
  BacklinkReport,
  CrawlScope,
  EditorialEvaluation,
  GeoEvaluation,
  Issue,
  EditorialSignals,
  PageGoal,
  PageRole,
  QueryCandidate,
  RawPageData,
  RoleSignals,
  SerpAnalysis,
  SerpCompetitorPage,
  SerpHistoryEntry
} from '../domain/types';

/** Extrait du contenu conservé au crawl : base de l'analyse IA (pas de nouveau fetch en phase 2) */
type ContentSnapshot = {
  headings: { level: number; text: string }[];
  excerpt: string;
  hasAuthor: boolean;
  hasPublicationDate: boolean;
  externalAuthoritativeLinksCount: number;
  schemaTypes: string[];
  signals?: EditorialSignals;
  roleSignals?: RoleSignals;
};

/** Recherches Google d'une page dans un lancement : requêtes, relevés (dans le même ordre), indices à mesurer */
/**
 * Recherches Google d'une page dans un lancement : requêtes × zones. Le relevé de la requête `q` dans la zone `z` est à
 * l'indice `q * zones.length + z` ; `todo` liste les indices à mesurer.
 */
type SerpJob = {
  page: Page;
  isPillar: boolean;
  queries: string[];
  zones: (GeoZone | undefined)[];
  zoneCount: number;
  analyses: SerpAnalysis[];
  todo: Set<number>;
};

/** Requête cible d'une page lors de l'audit précédent, reprise au suivant */
type PreviousQuery = { query: string; manual: boolean; basisHash: string; candidates?: QueryCandidate[]; problem?: string };

export class AuditService {
  /**
   * Pages explorées au plus quand l'interface n'en donne pas (variable CRAWL_MAX_PAGES) ; sinon le réglage des
   * paramètres, transmis au lancement
   */
  private static readonly MAX_CRAWL_PAGES = Math.max(10, Number(process.env.CRAWL_MAX_PAGES) || 150);
  /** Relevés de position conservés par page */
  private static readonly MAX_SERP_HISTORY = 30;
  /** Compromis tokens : Title, méta, Hn et les 1 000 premiers mots seulement */
  private static readonly EXCERPT_WORDS = 1000;
  private static readonly MAX_SNAPSHOT_HEADINGS = 60;
  private static readonly AI_CONCURRENCY = 3;
  /** Plafonds de stockage des listes détaillées (images, liens) par page */
  private static readonly MAX_LISTED_IMAGES = 60;
  private static readonly MAX_LISTED_LINKS = 150;

  /** Lien interne stocké en relatif (chemin + requête) pour alléger la base */
  private static toRelative(href: string, origin: string): string {
    try {
      const target = new URL(href);
      const base = new URL(origin);
      if (target.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) return href;
      return `${target.pathname}${target.search}` || '/';
    } catch {
      return href;
    }
  }

  /** Une seule analyse SERP à la fois : un navigateur visible, un éventuel captcha à résoudre à la main */
  private static readonly SERP_COMPETITORS_READ = 3;

  private static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private static buildSnapshot(page: RawPageData): ContentSnapshot {
    return {
      headings: page.headings.slice(0, this.MAX_SNAPSHOT_HEADINGS),
      excerpt: page.bodyText.split(' ').slice(0, this.EXCERPT_WORDS).join(' '),
      hasAuthor: page.hasAuthor,
      hasPublicationDate: page.hasPublicationDate,
      externalAuthoritativeLinksCount: page.externalAuthoritativeLinksCount,
      schemaTypes: page.schemaTypes,
      signals: page.editorialSignals,
      roleSignals: page.roleSignals
    };
  }

  /**
   * Empreinte de ce qui fonde la requête cible : Title, H1 et sous-titres, normalisés. Le corps de page n'y entre pas :
   * une date, un bandeau ou un widget qui change ne doit pas faire redéduire la requête à chaque audit.
   */
  private static queryBasisHash(title: string | null | undefined, h1: string | null | undefined, headings: { text: string }[]): string {
    const norm = (value: string | null | undefined) => normalizeText(value ?? '');
    return this.sha256(JSON.stringify([norm(title), norm(h1), headings.map((h) => norm(h.text))]));
  }

  private static hashContent(page: RawPageData, snapshot: ContentSnapshot): string {
    return this.sha256(
      JSON.stringify([page.title, page.metaDescription, page.h1, snapshot.headings, snapshot.excerpt])
    );
  }

  /**
   * Normalise un nom de domaine ou une URL
   */
  public static normalizeDomain(input: string): { url: string; domain: string; name: string } {
    let clean = input.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `https://${clean}`;
    }
    const parsed = new URL(clean);
    const domain = parsed.hostname.replace(/^www\./, '');
    const name = domain.split('.')[0].toUpperCase();
    return {
      url: parsed.origin,
      domain,
      name
    };
  }

  /**
   * Lance un nouvel audit avec politique stricte de Zéro-Historique (suppression cascade)
   */
  public static async launchAudit(
    rawInput: string,
    /** Périmètre choisi (absent : celui gardé pour le projet, sinon tout le site) et plafond de pages des paramètres */
    options: { scope?: Partial<CrawlScope> | null; maxPages?: number } = {}
  ) {
    const { url, domain, name } = this.normalizeDomain(rawInput);

    // 1. Trouver ou créer le projet
    const serpHistoryByUrl = new Map<string, SerpHistoryEntry[]>();
    const previousQueries = new Map<string, PreviousQuery>();
    let previousBacklinks: BacklinkReport | null = null;
    let project = await prisma.project.findUnique({
      where: { domain }
    });

    if (!project) {
      project = await prisma.project.create({
        data: {
          domain,
          name,
          faviconUrl: `https://${domain}/favicon.ico`
        }
      });
    } else {
      // Survivent à l'audit précédent : l'historique des positions (suivi des progrès) et les requêtes cibles
      // (saisies, ou déduites tant que le contenu ne change pas), pour comparer les relevés d'un audit à l'autre
      const previousPages = await prisma.page.findMany({
        where: { audit: { projectId: project.id } },
        select: { url: true, aiEvaluationRaw: true, targetQuery: true, targetQuerySource: true, title: true, h1: true, metricsRaw: true }
      });
      for (const previous of previousPages) {
        const key = SiteCrawler.urlKey(previous.url);
        const history = this.parseJson<{ serpHistory?: SerpHistoryEntry[] }>(previous.aiEvaluationRaw)?.serpHistory;
        if (history?.length) serpHistoryByUrl.set(key, history);
        if (previous.targetQuery) {
          const previousMetrics = this.parseJson<{
            content?: ContentSnapshot;
            keptCandidates?: QueryCandidate[];
            candidatesVersion?: number;
            keptProblem?: string;
          }>(previous.metricsRaw);
          previousQueries.set(key, {
            query: previous.targetQuery,
            manual: previous.targetQuerySource === 'MANUAL',
            basisHash: this.queryBasisHash(previous.title, previous.h1, previousMetrics?.content?.headings ?? []),
            candidates: previousMetrics?.candidatesVersion === CANDIDATES_VERSION ? previousMetrics.keptCandidates : undefined,
            problem: previousMetrics?.candidatesVersion === CANDIDATES_VERSION ? previousMetrics.keptProblem : undefined
          });
        }
      }

      // Backlinks de l'audit précédent : comparés au nouveau relevé (domaines gagnés et perdus)
      const previousAudit = await prisma.audit.findFirst({
        where: { projectId: project.id, backlinksRaw: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { backlinksRaw: true }
      });
      previousBacklinks = this.parseJson<BacklinkReport>(previousAudit?.backlinksRaw);

      // INVARIANT ZÉRO-HISTORIQUE : Supprimer l'audit précédent (cascade Prisma)
      await prisma.audit.deleteMany({
        where: { projectId: project.id }
      });
    }

    // Périmètre : choisi au lancement, sinon celui gardé pour le projet (relance), sinon tout le site
    const requested = options.scope ?? this.parseJson<Partial<CrawlScope>>(project.crawlScope);
    // Seuls les sitemaps du domaine audité sont lus : le serveur ne va pas chercher une adresse quelconque
    const sameSite = (sitemap: string) => {
      try {
        return new URL(sitemap).hostname.replace(/^www\./, '') === domain;
      } catch {
        return false;
      }
    };
    const scope = resolveCrawlScope(
      requested ? { ...requested, sitemaps: (requested.sitemaps ?? []).filter(sameSite) } : null,
      options.maxPages ?? this.MAX_CRAWL_PAGES
    );
    await prisma.project.update({ where: { id: project.id }, data: { crawlScope: JSON.stringify(scope) } });

    // 2. Créer le nouvel audit unique
    const audit = await prisma.audit.create({
      data: {
        projectId: project.id,
        status: 'CRAWLING_TECH',
        progress: 10,
        crawlStartedAt: new Date(),
        crawlScopeRaw: JSON.stringify(scope)
      }
    });

    // 3. Exécuter le crawl et le calcul des scores (en arrière-plan asynchrone), suivi dans le registre des travaux
    jobRegistry.startAudit(audit.id);
    this.runCrawlPipeline(audit.id, url, serpHistoryByUrl, previousQueries, previousBacklinks, scope)
      .catch((err) => {
        console.error('Erreur crawl pipeline:', err);
        prisma.audit.update({
          where: { id: audit.id },
          data: {
            status: 'FAILED',
            errorMessage: err?.message || 'Erreur inconnue lors du crawl'
          }
        }).catch(console.error);
      })
      .finally(() => jobRegistry.endAudit(audit.id));

    return {
      projectId: project.id,
      auditId: audit.id,
      domain,
      status: 'CRAWLING_TECH'
    };
  }

  /** Une page citée dans le contenu d'une rubrique (« clients », « actualités »…) en reprend la nature */
  private static markHubChildren(pages: RawPageData[]) {
    const byKey = new Map(pages.map((page) => [SiteCrawler.urlKey(page.url), page]));
    for (const hub of pages) {
      const slug = hub.path.split('/').filter(Boolean).pop() ?? '';
      const kind = hubChildKind(slug);
      if (!kind || hub.depth === 0) continue;
      for (const link of hub.editorialSignals?.inContentLinks.links ?? []) {
        if (!link.internal) continue;
        const child = byKey.get(SiteCrawler.urlKey(link.href));
        if (!child || child === hub || child.depth === 0) continue;
        const signals = child.roleSignals ?? { articleElements: 0, hasPublishedMeta: false };
        child.roleSignals = { ...signals, hubChild: signals.hubChild ?? kind };
      }
    }
  }

  /**
   * Mesure les Core Web Vitals via PageSpeed Insights pour l'accueil et les pages les plus liées
   * (PSI_MAX_PAGES, 10 par défaut), 2 mesures en parallèle. Les autres pages restent non mesurées.
   */
  private static async measureCoreWebVitals(auditId: string, pages: RawPageData[]) {
    if (!PageSpeedInsights.isConfigured()) return;

    const limit = Number(process.env.PSI_MAX_PAGES) || 10;
    const targets = pages
      .filter((page) => page.httpStatus < 400 && page.isIndexable && !page.fetchError)
      .sort((a, b) => (a.depth === 0 ? -1 : b.depth === 0 ? 1 : b.inlinksCount - a.inlinksCount))
      .slice(0, limit);

    let done = 0;
    for (let i = 0; i < targets.length; i += 2) {
      await Promise.all(
        targets.slice(i, i + 2).map(async (page) => {
          const vitals = await PageSpeedInsights.measure(page.url);
          if (vitals) page.coreWebVitals = vitals;
          done++;
        })
      );
      await prisma.audit.update({
        where: { id: auditId },
        data: { progress: 70 + Math.round((done / targets.length) * 20) }
      });
    }
  }

  /**
   * Pipeline de crawl Phase 1 (Technique)
   */
  private static async runCrawlPipeline(
    auditId: string,
    originUrl: string,
    serpHistoryByUrl: Map<string, SerpHistoryEntry[]> = new Map(),
    previousQueries: Map<string, PreviousQuery> = new Map(),
    previousBacklinks: BacklinkReport | null = null,
    scope: CrawlScope = resolveCrawlScope(null, this.MAX_CRAWL_PAGES)
  ) {
    // Backlinks en parallèle du crawl : graphe Common Crawl (moins d'une seconde) puis vérification en direct
    const backlinks = this.collectBacklinks(new URL(originUrl).hostname, previousBacklinks);

    // Étape A : Métadonnées du domaine (robots.txt, llms.txt)
    const domainMeta = await SiteCrawler.analyzeDomainMetadata(originUrl);

    await prisma.audit.update({
      where: { id: auditId },
      data: { progress: 30 }
    });

    // Sitemap : déclaré dans le robots.txt ou à un emplacement usuel (null : aucun trouvé, critère non mesuré)
    const sitemapUrls = await SiteCrawler.loadSitemapUrls(
      new URL(originUrl).origin,
      domainMeta.robots?.sitemaps ?? []
    );

    // Sitemaps choisis : leurs pages forment le périmètre (l'accueil est toujours exploré)
    const allowedUrls =
      scope.mode === 'sitemaps'
        ? await SiteCrawler.loadSitemapUrls(new URL(originUrl).origin, scope.sitemaps ?? [], true)
        : null;
    if (scope.mode === 'sitemaps' && !allowedUrls) {
      console.warn(`[AuditService] Sitemaps choisis illisibles pour ${originUrl} : exploration de tout le site`);
    }

    // Étape B : Crawl réel par suivi des liens internes depuis la racine, dans le périmètre choisi
    const crawledPages: RawPageData[] = await SiteCrawler.crawlSite(originUrl, {
      maxPages: scope.maxPages,
      maxDepth: scope.maxDepth,
      robots: domainMeta.robots,
      sitemapUrls,
      allowedUrls,
      excludePath: scope.mode === 'main' ? isArchivePath : undefined,
      onProgress: async (crawled, maxPages) => {
        jobRegistry.beatAudit(auditId);
        await prisma.audit.update({
          where: { id: auditId },
          data: { progress: 30 + Math.round(Math.min(1, crawled / maxPages) * 40) }
        });
      }
    });

    // Pages liées depuis le contenu d'une liste de réalisations ou d'articles : indice de leur rôle
    this.markHubChildren(crawledPages);

    // Core Web Vitals (PageSpeed Insights, mobile) pour l'accueil et les pages les plus liées
    await this.measureCoreWebVitals(auditId, crawledPages);

    // Cohérence NAP (nom, adresse, téléphone) à l'échelle du site
    const napByUrl = analyzeNap(crawledPages.map((page) => ({ url: page.url, nap: page.nap })));

    // Étape C : Calculs des scores et sauvegarde en base
    const pageRecords = [];
    const issueRecords = [];

    for (let i = 0; i < crawledPages.length; i++) {
      const page = crawledPages[i];
      const isHomepage = i === 0;

      // 1. Score Technique
      const techRes = TechScoringEngine.calculate(page);

      // 2. Score Éditorial
      const editoRes = EditorialScoringEngine.calculate(page);

      // 3. Score GEO
      const geoRes = GeoScoringEngine.calculate(page, undefined, domainMeta, napByUrl.get(page.url));

      const pageScore = GlobalScoringEngine.computePageScore(
        techRes.score,
        editoRes.score,
        geoRes.score,
        isHomepage // Par défaut, la page d'accueil est pilier initial
      );

      const snapshot = this.buildSnapshot(page);
      const contentHash = this.hashContent(page, snapshot);
      // Requête saisie : toujours reprise. Requête déduite : reprise si Title, H1 et sous-titres n'ont pas changé
      const previousQuery = previousQueries.get(SiteCrawler.urlKey(page.url));
      const sameBasis = previousQuery?.basisHash === this.queryBasisHash(page.title, page.h1, snapshot.headings);
      const keptQuery = previousQuery && (previousQuery.manual || sameBasis) ? previousQuery : undefined;
      // Requêtes candidates reprises tant que Title, H1 et sous-titres n'ont pas changé
      const keptCandidates = sameBasis && previousQuery?.candidates?.length ? previousQuery.candidates : undefined;

      // Sauvegarder la Page
      const createdPage = await prisma.page.create({
        data: {
          auditId,
          url: page.url,
          path: page.path,
          httpStatus: page.httpStatus,
          depth: page.depth,
          isPillar: isHomepage,
          isIndexable: page.isIndexable,
          title: page.title,
          metaDescription: page.metaDescription,
          h1: page.h1,
          h2Count: page.headings.filter((h) => h.level === 2).length,
          wordCount: page.wordCount,
          inlinksCount: page.inlinksCount,
          outlinksCount: page.outlinksCount,
          pageScore,
          techScore: techRes.score,
          editorialScore: editoRes.score,
          geoScore: geoRes.score,
          contentHash,
          ...(keptQuery ? { targetQuery: keptQuery.query, targetQuerySource: keptQuery.manual ? 'MANUAL' : 'AUTO' } : {}),
          metricsRaw: JSON.stringify({
            ...(keptQuery && !keptQuery.manual ? { keptQuery: keptQuery.query } : {}),
            ...(keptCandidates ? { keptCandidates, candidatesVersion: CANDIDATES_VERSION, keptProblem: previousQuery?.problem } : {}),
            content: snapshot,
            images: page.images
              .slice(0, this.MAX_LISTED_IMAGES)
              .map((image) => ({ src: image.src, alt: image.alt })),
            links: page.links
              .slice(0, this.MAX_LISTED_LINKS)
              .map((link) => ({ ...link, href: link.internal ? this.toRelative(link.href, originUrl) : link.href })),
            inlinkSources: page.inlinkSources?.slice(0, this.MAX_LISTED_LINKS),
            cwv: page.coreWebVitals,
            imagesTotal: page.imagesTotal,
            imagesWithAlt: page.imagesWithAlt,
            hasSsl: page.hasSsl,
            responseTimeMs: page.responseTimeMs,
            canonicalUrl: page.canonicalUrl,
            robotsMeta: page.robotsMeta,
            finalUrl: page.finalUrl,
            redirectHops: page.redirectHops,
            redirectStatuses: page.redirectStatuses,
            techMeasuredPoints: 100 - (techRes.unmeasuredPoints ?? 0),
            discoveredVia: page.discoveredVia,
            linkGraphComplete: page.linkGraphComplete,
            domain: {
              hasLlmsTxt: domainMeta.hasLlmsTxt,
              llmsTxtValid: domainMeta.llmsTxtValid
            }
          }),
          aiEvaluationRaw: JSON.stringify({
            editorial: editoRes.evaluation,
            geo: geoRes.evaluation,
            serpHistory: serpHistoryByUrl.get(SiteCrawler.urlKey(page.url))
          })
        }
      });
      pageRecords.push(createdPage);

      // Agréger les anomalies issues des moteurs
      const allIssues = [...techRes.issues, ...editoRes.issues, ...geoRes.issues];
      for (const issue of allIssues) {
        issueRecords.push({
          auditId,
          pillar: issue.pillar,
          severity: issue.severity,
          code: issue.code,
          title: issue.title,
          description: issue.description,
          recommendation: issue.recommendation,
          stepsToResolve: JSON.stringify(issue.stepsToResolve),
          affectedUrl: issue.affectedUrl,
          metadata: issue.metadata ? JSON.stringify(issue.metadata) : null
        });
      }
    }

    // Sauvegarder les anomalies en lot
    if (issueRecords.length > 0) {
      await prisma.issue.createMany({
        data: issueRecords
      });
    }

    // Étape D : Calculer les scores globaux du projet
    const globalScores = GlobalScoringEngine.computeProjectScore(
      pageRecords.map((p) => ({
        techScore: p.techScore ?? 0,
        editorialScore: p.editorialScore ?? undefined,
        geoScore: p.geoScore ?? undefined,
        isPillar: p.isPillar,
        excludedFromTechAverage: !p.isIndexable && p.httpStatus < 400,
        ...this.measuredPoints(p)
      }))
    );

    // Étape E : Clôturer la Phase 1 -> Statut AWAITING_AI_SELECTION
    await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'AWAITING_AI_SELECTION',
        progress: 100,
        totalPagesCount: pageRecords.length,
        pillarPagesCount: pageRecords.filter((p) => p.isPillar).length,
        techScore: globalScores.techAvg,
        editorialScore: globalScores.editorialAvg,
        geoScore: globalScores.geoAvg,
        overallScore: globalScores.overallScore,
        backlinksRaw: JSON.stringify(await backlinks)
      }
    });
  }

  /**
   * Backlinks du site (hors score) : domaines référents du graphe Common Crawl préparé localement, puis vérification
   * en direct des 20 premiers (page source, texte du lien, nofollow). Ne fait jamais échouer le crawl.
   */
  private static async collectBacklinks(
    host: string,
    previous: BacklinkReport | null,
    index: BacklinkIndexPort = new CommonCrawlBacklinkIndex()
  ): Promise<BacklinkReport> {
    const domain = host.replace(/^www\./, '');
    const base = { source: 'COMMON_CRAWL' as const, fetchedAt: new Date().toISOString(), referringDomains: [] };
    if (!index.isAvailable()) {
      return {
        ...base,
        status: 'UNAVAILABLE',
        message: 'Base Common Crawl absente : lancez « npm run backlinks:build » (environ 8 Go à télécharger, 30 minutes).'
      };
    }
    try {
      const found = await index.referringDomains(domain);
      if (!found) {
        return { ...base, status: 'DONE', release: index.release(), domainInGraph: false, changes: compareReferringDomains(previous, []) };
      }
      const referringDomains = await verifyReferringDomains(found.domains, domain);
      return {
        ...base,
        status: 'DONE',
        release: found.release,
        domainInGraph: true,
        referringDomains,
        changes: compareReferringDomains(previous, referringDomains)
      };
    } catch (err: any) {
      console.error(`[AuditService] Backlinks indisponibles pour ${domain} : ${err?.message ?? err}`);
      return { ...base, status: 'ERROR', message: String(err?.message ?? err).slice(0, 300) };
    }
  }

  /**
   * Phase 2 : enregistre les pages piliers puis lance l'analyse éditoriale en arrière-plan.
   * L'audit passe en ANALYZING_AI immédiatement ; le front interroge le statut jusqu'à COMPLETED.
   */
  public static async selectPillarsAndAnalyze(
    auditId: string,
    pillarPageIds: string[],
    targetQueries: Record<string, string> = {}
  ) {
    await prisma.page.updateMany({
      where: { auditId },
      data: { isPillar: false }
    });

    await prisma.page.updateMany({
      where: {
        auditId,
        id: { in: pillarPageIds }
      },
      data: { isPillar: true }
    });

    // Requêtes saisies par l'utilisateur : manuelles, donc prioritaires sur la détection automatique
    for (const [pageId, query] of Object.entries(targetQueries)) {
      if (!pillarPageIds.includes(pageId)) continue;
      await prisma.page.updateMany({
        where: { id: pageId, auditId },
        data: { targetQuery: query, targetQuerySource: 'MANUAL' }
      });
    }

    // Les anomalies éditoriales de la phase 1 sont heuristiques : elles sont régénérées pour les piliers
    await prisma.issue.deleteMany({ where: { auditId, pillar: 'EDITORIAL' } });

    const audit = await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'ANALYZING_AI',
        progress: 0,
        pillarPagesCount: pillarPageIds.length,
        errorMessage: null
      }
    });

    jobRegistry.startAudit(auditId);
    this.runEditorialAnalysis(auditId)
      .catch((err) => {
        console.error('Erreur analyse éditoriale:', err);
        prisma.audit
          .update({
            where: { id: auditId },
            data: { status: 'FAILED', errorMessage: err?.message || 'Erreur inconnue lors de l’analyse IA' }
          })
          .catch(console.error);
      })
      .finally(() => jobRegistry.endAudit(auditId));

    return audit;
  }

  private static async runEditorialAnalysis(auditId: string) {
    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      include: { project: true }
    });
    if (!audit) throw new Error('Audit introuvable');

    const pillars = await prisma.page.findMany({ where: { auditId, isPillar: true } });
    let done = 0;

    for (let i = 0; i < pillars.length; i += this.AI_CONCURRENCY) {
      const batch = pillars.slice(i, i + this.AI_CONCURRENCY);
      await Promise.all(
        batch.map(async (page) => {
          try {
            await this.analyzeEditorial(page, pillars, audit.project.domain, { force: false });
          } catch (err) {
            console.error(`[AuditService] Analyse éditoriale impossible : ${page.url}`, err);
          }
          done++;
          jobRegistry.beatAudit(auditId);
          await prisma.audit.update({
            where: { id: auditId },
            data: { progress: Math.round((done / pillars.length) * 100) }
          });
        })
      );
    }

    // Relecture de cohérence entre les piliers (balises en doublon, chiffres divergents, un appel IA)
    await this.refreshSiteCoherence(auditId, true);
    await this.finalizeAudit(auditId);
  }

  /** Recalcule les scores globaux et clôture l'audit en COMPLETED */
  private static async finalizeAudit(auditId: string) {
    const pages = await prisma.page.findMany({ where: { auditId } });
    const globalScores = GlobalScoringEngine.computeProjectScore(
      pages.map((p) => ({
        techScore: p.techScore ?? 0,
        editorialScore: p.editorialScore ?? undefined,
        geoScore: p.geoScore ?? undefined,
        isPillar: p.isPillar,
        excludedFromTechAverage: !p.isIndexable && p.httpStatus < 400,
        ...this.measuredPoints(p)
      }))
    );

    return prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        completedAt: new Date(),
        overallScore: globalScores.overallScore,
        techScore: globalScores.techAvg,
        editorialScore: globalScores.editorialAvg,
        geoScore: globalScores.geoAvg
      }
    });
  }

  /**
   * Ré-analyse éditoriale d'une page pilier, avec une requête cible optionnelle.
   * `targetQuery` : texte = requête manuelle ; null = retour à la détection automatique ;
   * undefined = requête inchangée.
   */
  public static async reanalyzePage(
    auditId: string,
    pageId: string,
    options: { targetQuery?: string | null; force?: boolean } = {}
  ) {
    const page = await prisma.page.findFirst({
      where: { id: pageId, auditId },
      include: { audit: { include: { project: true } } }
    });
    if (!page) throw new Error('Page introuvable');
    if (!page.isPillar) throw new Error('Seules les pages piliers sont analysées par l’IA');

    let current: Page = page;
    if (options.targetQuery !== undefined) {
      const query = options.targetQuery?.trim() || null;
      current = await prisma.page.update({
        where: { id: pageId },
        data: query
          ? { targetQuery: query, targetQuerySource: 'MANUAL' }
          : {
              targetQuery: null,
              targetQuerySource: 'AUTO',
              // Retour à la détection automatique : requête et candidates conservées oubliées, l'IA en propose d'autres
              metricsRaw: JSON.stringify({
                ...this.parseJson<Record<string, unknown>>(page.metricsRaw),
                keptQuery: undefined,
                keptCandidates: undefined
              })
            }
      });
    }

    const pillars = await prisma.page.findMany({ where: { auditId, isPillar: true } });
    await this.analyzeEditorial(current, pillars, page.audit.project.domain, {
      force: options.force ?? false
    });
    await this.refreshSiteCoherence(auditId, false);
    await this.finalizeAudit(auditId);
  }

  /**
   * Analyse éditoriale d'une page pilier : Autocomplete, LLM (repli heuristique si indisponible),
   * mise à jour du score, de la requête cible et des anomalies. Réutilise l'analyse précédente
   * si le contenu et la requête manuelle n'ont pas changé.
   */
  private static async analyzeEditorial(
    page: Page,
    pillars: Page[],
    domain: string,
    options: { force: boolean }
  ) {
    const stored = this.parseJson<{
      editorial?: EditorialEvaluation;
      geo?: unknown;
      serp?: SerpAnalysis;
      editorialStatus?: { engine: string; error?: string };
    }>(page.aiEvaluationRaw);
    const metrics = this.parseJson<{
      content?: ContentSnapshot;
      roleOverride?: PageRole;
      goalOverride?: PageGoal;
      keptQuery?: string;
      keptCandidates?: QueryCandidate[];
      candidatesVersion?: number;
      keptProblem?: string;
    }>(page.metricsRaw);
    const snapshot: ContentSnapshot = metrics?.content ?? {
      headings: [],
      excerpt: '',
      hasAuthor: false,
      hasPublicationDate: false,
      externalAuthoritativeLinksCount: 0,
      schemaTypes: []
    };

    const manualQuery =
      page.targetQuerySource === 'MANUAL' && page.targetQuery ? page.targetQuery : undefined;
    const raw = this.toRawPage(page, snapshot, metrics?.roleOverride, metrics?.goalOverride);
    // Rôle de départ, transmis à l'IA qui peut le corriger ; une correction manuelle prime sur tout
    const role = resolvePageRole({
      manual: metrics?.roleOverride,
      detected: classifyPageRole({
        path: page.path,
        depth: page.depth,
        hasPublicationDate: snapshot.hasPublicationDate,
        wordCount: page.wordCount,
        schemaTypes: snapshot.schemaTypes,
        ...snapshot.roleSignals
      })
    }).role;
    // Objectif de la page : choix de l'utilisateur, sinon celui du rôle ; il décide ce que l'IA juge et propose
    const { goal } = resolveGoal({ manual: metrics?.goalOverride, role });

    // Requêtes génériques (sans la marque) pour toutes les pages, sauf contact et pages utilitaires : on y cherche
    // le site par son nom, l'IA déduit alors une requête de marque comme avant
    const brands = brandVariants(domain);
    const genericQueries = role !== 'contact' && role !== 'utility';
    // Candidates gardées seulement pour un rôle qui en reçoit : une page passée en contact ne garde pas
    // « agence web chartres » d'un ancien rôle d'offre
    // Mots-clés de départ d'une consigne précédente : non repris (l'IA en propose de nouveaux, et la requête déduite
    // avec eux est redéduite)
    let candidates: QueryCandidate[] =
      genericQueries && metrics?.candidatesVersion === CANDIDATES_VERSION ? metrics.keptCandidates ?? [] : [];
    let problem = genericQueries && metrics?.candidatesVersion === CANDIDATES_VERSION ? metrics.keptProblem : undefined;
    // Requête déduite conservée (analyse précédente sur le même contenu) : l'IA ne la redéduit pas. Une requête
    // déduite avant les candidates (souvent la marque) n'est pas reprise : elle est remplacée par une candidate.
    // Contact ou utilitaire : seule une requête de marque est reprise (une générique venait d'un autre rôle)
    const fixedQuery =
      manualQuery || !metrics?.keptQuery
        ? undefined
        : genericQueries
          ? candidates.length > 0 && !containsBrand(metrics.keptQuery, brands)
            ? metrics.keptQuery
            : undefined
          : containsBrand(metrics.keptQuery, brands)
            ? metrics.keptQuery
            : undefined;
    // Version du prompt et modèle dans la clé : un changement de barème ou de modèle relance l'analyse
    const hashFor = (kept: string | undefined) =>
      this.sha256(
        `${page.contentHash ?? ''}|${manualQuery ?? ''}|${kept ?? ''}|${llmGateway.cacheKey()}${
          metrics?.roleOverride ? `|${metrics.roleOverride}` : ''
        }|goal:${goal}`
      );

    if (
      !options.force &&
      page.analyzedHash === hashFor(fixedQuery) &&
      stored?.editorial?.search?.analyzedBy.engine === 'LLM'
    ) {
      // Rien n'a changé pour l'IA : pas de nouvel appel, mais le score et les anomalies sont recalculés depuis
      // l'analyse enregistrée (l'ajout d'une page stratégique efface les anomalies de contenu de toutes les pages)
      await this.rescoreEditorial(page);
      return;
    }

    let evaluation: EditorialEvaluation | undefined;
    let error: string | undefined;
    let autocomplete: Awaited<ReturnType<typeof AuditService.fetchSuggestionsFor>> | undefined;
    // Mots-clés et volumes, cherchés avant l'IA : les plus recherchés forment les requêtes notées qu'elle juge
    let keywords = (stored as { keywords?: KeywordResearch } | null)?.keywords;
    const blocked = page.httpStatus >= 400 || !page.isIndexable;

    if (!blocked) {
      if (!llmGateway.isConfigured()) {
        error = 'Aucun fournisseur IA configuré (LLM_BASE_URL + LLM_MODEL, ou GEMINI_API_KEY) : analyse heuristique locale utilisée.';
      } else {
        try {
          if (genericQueries && candidates.length === 0) {
            ({ candidates, problem } = await this.proposeCandidates(page, domain, role, snapshot, brands, pillars));
          }
          // Requête cible : la première candidate que Google suggère, sinon la première proposée par l'IA
          const chosenQuery = manualQuery || fixedQuery ? undefined : chooseTargetQuery(candidates)?.query;
          autocomplete = await this.fetchSuggestionsFor(page, domain, manualQuery ?? fixedQuery ?? chosenQuery, role);
          const suggestions = autocomplete.suggestions;
          // Requête cible sans lieu, comme après l'analyse : l'IA juge exactement les requêtes que le moteur notera
          const knownTarget =
            manualQuery ??
            ((fixedQuery ?? chosenQuery) ? stripPlaces(fixedQuery ?? chosenQuery ?? '', await this.placeNamesFor(page)) || (fixedQuery ?? chosenQuery) : undefined);
          const fresh = await this.buildKeywordResearch(page, domain, knownTarget, candidates, { problem, role }).catch((err) => {
            console.warn(`[AuditService] Mots-clés indisponibles pour ${page.url} : ${err?.message ?? err}`);
            return undefined;
          });
          keywords = fresh ? this.keepPreviousKeywords(keywords, fresh) : keywords;
          raw.keywordResearch = keywords;
          const queries = buildQuerySet({
            target: knownTarget ? { query: knownTarget, confirmed: true, isBrand: !genericQueries } : undefined,
            research: keywords,
            candidates,
            override: raw.querySetOverride,
            brandOnly: !genericQueries
          }).map((entry) => entry.query);
          evaluation = await llmGateway.evaluateEditorial({
            url: page.url,
            domain,
            role,
            goal,
            title: page.title ?? undefined,
            metaDescription: page.metaDescription ?? undefined,
            h1: page.h1 ?? undefined,
            headings: snapshot.headings,
            excerpt: snapshot.excerpt,
            wordCount: page.wordCount,
            signals: {
              hasAuthor: snapshot.hasAuthor,
              hasPublicationDate: snapshot.hasPublicationDate,
              externalAuthoritativeLinksCount: snapshot.externalAuthoritativeLinksCount,
              schemaTypes: snapshot.schemaTypes
            },
            manualQuery,
            fixedQuery,
            chosenQuery,
            queries,
            suggestions,
            siblingPages: pillars
              .filter((p) => p.id !== page.id)
              .map((p) => ({ url: p.url, title: p.title ?? undefined, h1: p.h1 ?? undefined }))
          });
        } catch (err: any) {
          error = err?.message || 'Erreur inconnue du modèle';
          console.error(`[AuditService] Échec LLM pour ${page.url} : ${error}`);
        }
      }
    }

    if (evaluation?.search) {
      const query = evaluation.search.targetQuery.query;
      // Requête déduite par l'IA : est-elle une vraie recherche ? Vérifiée avec les candidates, sinon Google
      // Autocomplete interrogé sur la requête exacte
      if (evaluation.search.targetQuery.source === 'AUTO') {
        const candidate = candidates.find((item) => normalizeText(item.query) === normalizeText(query));
        const already =
          candidate?.suggestedByGoogle === true ||
          evaluation.search.autocomplete.suggestions.some((suggestion) => isSameQuery(query, suggestion));
        const exact = already || candidate ? [] : await GoogleAutocomplete.fetchExact(query);
        evaluation.search.targetQuery.suggestedByGoogle = already || exact.some((suggestion) => isSameQuery(query, suggestion));
      }
      // Requête déduite sans lieu (la zone est ajoutée à la mesure) ; une requête saisie reste telle quelle
      if (evaluation.search.targetQuery.source !== 'MANUAL') {
        const places = [...(await this.placeNamesFor(page)), evaluation.search.local?.city ?? ''].filter(Boolean);
        const bare = stripPlaces(evaluation.search.targetQuery.query, places);
        if (bare) evaluation.search.targetQuery.query = bare;
      }
      evaluation.search.targetQuery.isBrand = !genericQueries || containsBrand(query, brands);
      // Pourquoi il y a, ou non, des suggestions : affiché tel quel dans l'onglet Contenu
      if (autocomplete) {
        evaluation.search.autocomplete = { ...evaluation.search.autocomplete, status: autocomplete.status, seed: autocomplete.seed };
      }
      if (candidates.length > 0) evaluation.search.candidates = candidates;
      if (problem) evaluation.search.problem = problem;
    }

    // Relevé de la requête retenue (une requête changée n'est pas jugée sur les résultats de l'ancienne)
    const storedSerp = this.parseJson<{ serpQueries?: SerpAnalysis[] }>(page.aiEvaluationRaw)?.serpQueries;
    const result = EditorialScoringEngine.calculate(
      raw,
      evaluation,
      serpForQuery(evaluation?.search?.targetQuery.query ?? page.targetQuery ?? undefined, stored?.serp, storedSerp),
      storedSerp ?? []
    );
    const search = result.evaluation?.search;
    const engine = evaluation ? 'LLM' : 'HEURISTIC';

    // Citabilité jugée par l'IA : remplace l'estimation par les sous-titres et recalcule le score GEO
    let storedGeo = stored?.geo as GeoEvaluation | undefined;

    // Schema.org incomplet dans le HTML initial : la page est rendue dans Chrome pour lire un JSON-LD injecté par
    // JavaScript (gestionnaire de balises, framework), sinon noté 0 à tort
    if (evaluation && storedGeo && storedGeo.schemaOrgLdJson.score < 25) {
      const rendered = await RenderedSchema.read(page.url);
      const types = Array.from(new Set([...(storedGeo.schemaOrgLdJson.schemaTypes ?? []), ...(rendered ?? [])]));
      const schema = GeoScoringEngine.scoreSchema(types.length > 0 || storedGeo.schemaOrgLdJson.hasValidSchema, types);
      if (rendered && schema.score > storedGeo.schemaOrgLdJson.score) {
        storedGeo = {
          ...storedGeo,
          schemaOrgLdJson: {
            ...storedGeo.schemaOrgLdJson,
            score: schema.score,
            hasValidSchema: true,
            schemaTypes: types,
            renderedWithJs: true,
            critique: `${schema.critique} Balisage lu après exécution du JavaScript de la page (absent du HTML initial). La validité n’est pas contrôlée ici.`
          }
        };
      }
    }
    // Entreprise locale sans aucune coordonnée sur le site : la cohérence NAP devient un vrai manque (0 pt)
    // au lieu d'être exclue du score
    const localWithoutNap = Boolean(evaluation?.search?.local.isLocalBusiness && storedGeo?.napConsistency.measured === false);
    const geo =
      evaluation?.citability && storedGeo
        ? GeoScoringEngine.calculate(raw, {
            ...storedGeo,
            role: evaluation.role,
            aiCitability: { ...evaluation.citability, source: 'AI' },
            ...(localWithoutNap
              ? {
                  napConsistency: {
                    ...storedGeo.napConsistency,
                    score: 0,
                    measured: true,
                    consistencyMeasured: false,
                    isConsistent: true,
                    reportMissing: true,
                    actionableAdvice:
                      'Établissement local sans adresse ni téléphone visibles sur le site : affichez vos coordonnées (pied de page, page contact) et déclarez-les en JSON-LD LocalBusiness.'
                  }
                }
              : {})
          })
        : undefined;

    await prisma.page.update({
      where: { id: page.id },
      data: {
        editorialScore: result.score,
        ...(geo ? { geoScore: geo.score } : {}),
        pageScore: GlobalScoringEngine.computePageScore(
          page.techScore ?? 0,
          result.score,
          geo?.score ?? page.geoScore ?? 0,
          true
        ),
        targetQuery: search?.targetQuery.query ?? page.targetQuery,
        targetQuerySource: search?.targetQuery.source ?? page.targetQuerySource ?? 'AUTO',
        // Requête déduite et candidates conservées pour les analyses suivantes (re-test, changement de prompt, audit suivant)
        ...(search?.targetQuery.source === 'AUTO' || candidates.length > 0
          ? {
              metricsRaw: JSON.stringify({
                ...this.parseJson<Record<string, unknown>>(page.metricsRaw),
                ...(search?.targetQuery.source === 'AUTO' ? { keptQuery: search.targetQuery.query } : {}),
                ...(candidates.length > 0
                  ? { keptCandidates: candidates, candidatesVersion: CANDIDATES_VERSION, ...(problem ? { keptProblem: problem } : {}) }
                  : {})
              })
            }
          : {}),
        // Empreinte calculée avec la requête retenue : l'analyse suivante, qui la reprend, n'est pas relancée
        analyzedHash: evaluation
          ? hashFor(search?.targetQuery.source === 'AUTO' ? search.targetQuery.query : undefined)
          : null,
        aiEvaluationRaw: JSON.stringify({
          ...stored,
          editorial: result.evaluation,
          ...(keywords ? { keywords } : {}),
          ...(geo?.evaluation ? { geo: geo.evaluation } : {}),
          editorialStatus: { engine, error }
        })
      }
    });

    if (geo) await this.replaceGeoIssues(page, geo.issues);

    await prisma.issue.deleteMany({
      // Les anomalies de cohérence du site (SITE_*) sont régénérées à part
      where: {
        auditId: page.auditId,
        pillar: 'EDITORIAL',
        affectedUrl: page.url,
        NOT: { code: { startsWith: 'SITE_' } }
      }
    });
    if (result.issues.length > 0) {
      await prisma.issue.createMany({
        data: result.issues.map((issue) => ({
          auditId: page.auditId,
          pillar: issue.pillar,
          severity: issue.severity,
          code: issue.code,
          title: issue.title,
          description: issue.description,
          recommendation: issue.recommendation,
          stepsToResolve: JSON.stringify(issue.stepsToResolve),
          affectedUrl: issue.affectedUrl,
          metadata: issue.metadata ? JSON.stringify(issue.metadata) : null
        }))
      });
    }
  }

  /**
   * Suggestions Google Autocomplete pour la requête de la page, sans la marque. Une graine n'est envoyée que si
   * elle compte au moins deux mots porteurs de sens et n'est pas un nom de rubrique (« à propos », « actualités ») ;
   * seules les suggestions qui reprennent ses mots sont gardées, et il en faut au moins 3. Aucune requête pour
   * les pages de marque, de contact et utilitaires, dont la recherche n'est pas thématique (sauf requête saisie).
   */
  private static async fetchSuggestionsFor(
    page: Page,
    domain: string,
    targetQuery: string | undefined,
    role: string
  ): Promise<{ suggestions: string[]; status: 'FOUND' | 'NONE' | 'UNAVAILABLE' | 'NOT_REQUESTED'; seed?: string }> {
    if (!targetQuery && (role === 'contact' || role === 'brand' || role === 'utility')) {
      return { suggestions: [], status: 'NOT_REQUESTED' };
    }

    const brands = brandVariants(domain);
    const clean = (value: string) =>
      stripBrand(value, brands)
        .replace(/(^| )(groupe|association)( |$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const segments = (value?: string | null) =>
      (value ?? '')
        .split(/\s*[|–—:]\s*|\s+-\s+/)
        .map(clean)
        .filter(Boolean);

    // Requête visée et ses variantes plus courtes (sans les lieux, puis 3 et 2 mots principaux), puis le Title et le H1
    const places = await this.zoneNamesFor(page);
    const seeds = Array.from(
      new Set(
        [
          ...(targetQuery ? suggestionSeeds(targetQuery.trim().toLowerCase(), places) : []),
          ...(targetQuery ? [] : [page.targetQuerySource === 'AUTO' && page.targetQuery ? clean(page.targetQuery) : '']),
          ...segments(page.title),
          ...segments(page.h1)
        ]
          .filter((seed) => Boolean(seed) && isUsableSeed(seed))
          .map((seed) => seed.split(' ').slice(0, 6).join(' '))
      )
    ).slice(0, 5);

    // La première graine qui donne au moins 3 suggestions (assez pour en tirer une intention) ; sinon la meilleure,
    // dès 1 suggestion. Rien de pertinent : Google a répondu sans suggestion (NONE) ou n'a pas répondu (UNAVAILABLE)
    let reachable = false;
    let best: { suggestions: string[]; seed: string } | undefined;
    for (const seed of seeds) {
      const result = await GoogleAutocomplete.fetchSuggestionsChecked(seed);
      reachable ||= result.reachable;
      const relevant = filterRelevantSuggestions(seed, result.suggestions);
      if (relevant.length >= 3) return { suggestions: relevant, status: 'FOUND', seed };
      if (relevant.length > (best?.suggestions.length ?? 0)) best = { suggestions: relevant, seed };
    }
    if (best) return { suggestions: best.suggestions, status: 'FOUND', seed: best.seed };
    return { suggestions: [], status: reachable || seeds.length === 0 ? 'NONE' : 'UNAVAILABLE', seed: seeds[0] };
  }

  /**
   * Mots-clés de départ d'une page et sa problématique : l'IA lit la page et choisit 8 à 12 mots-clés tels qu'on les
   * tape dans Google ; le code retire marque, lieux, rubriques, doublons et tout sujet absent de la page, puis vérifie
   * chacun dans Google Autocomplete. Ils partent ensuite dans Keyword Planner. Échec de l'IA : liste vide.
   */
  private static async proposeCandidates(
    page: Page,
    domain: string,
    role: PageRole,
    snapshot: ContentSnapshot,
    brands: string[],
    pillars: Page[]
  ): Promise<{ candidates: QueryCandidate[]; problem?: string }> {
    try {
      const { problem, queries: proposals } = await llmGateway.proposeQueries({
        url: page.url,
        domain,
        role,
        title: page.title ?? undefined,
        metaDescription: page.metaDescription ?? undefined,
        h1: page.h1 ?? undefined,
        headings: snapshot.headings,
        excerpt: snapshot.excerpt,
        siblingPages: pillars
          .filter((p) => p.id !== page.id)
          .map((p) => ({ url: p.url, title: p.title ?? undefined, h1: p.h1 ?? undefined })),
        zones: await this.zoneNamesFor(page)
      });
      // Mot-clé dont aucun mot porteur de sens ne figure dans la page : sujet inventé, écarté
      const pageText = [page.title, page.h1, ...snapshot.headings.map((h) => h.text), snapshot.excerpt].filter(Boolean).join(' ');
      const candidates = sanitizeCandidates(proposals, brands, undefined, await this.placeNamesFor(page)).filter((candidate) =>
        mentionedInPage(candidate.query, pageText)
      );
      for (const candidate of candidates) {
        const suggestions = await GoogleAutocomplete.fetchExact(candidate.query);
        candidate.suggestedByGoogle = suggestions.some((suggestion) => isSameQuery(candidate.query, suggestion));
      }
      return { candidates, ...(problem ? { problem } : {}) };
    } catch (err: any) {
      console.warn(`[AuditService] Mots-clés de départ indisponibles pour ${page.url} : ${err?.message ?? err}`);
      return { candidates: [] };
    }
  }

  /**
   * Zones ciblées du projet (3 au plus), validées par l'API Géo. Les recherches proposées par l'IA sont oubliées pour
   * les pages à requête déduite du dernier audit : la prochaine analyse IA en propose avec ces zones.
   */
  public static async setProjectZones(projectRef: string, refs: { kind: GeoZone['kind']; code: string }[]): Promise<GeoZone[]> {
    const project = await prisma.project.findFirst({ where: { OR: [{ id: projectRef }, { domain: projectRef }] } });
    if (!project) throw new Error('Projet introuvable');
    const zones: GeoZone[] = [];
    for (const ref of refs.slice(0, MAX_PROJECT_ZONES)) {
      const zone = await GeoApi.resolve(ref.kind, ref.code);
      if (!zone) throw new Error(`Zone introuvable : ${ref.kind} ${ref.code}`);
      if (!zones.some((existing) => existing.id === zone.id)) zones.push(zone);
    }
    await prisma.project.update({ where: { id: project.id }, data: { zonesRaw: JSON.stringify(zones) } });
    await this.forgetProposedQueries(project.id);
    return zones;
  }

  /** Zone propre à une page (null : retour aux zones du projet), gardée d'un audit à l'autre par la clé d'URL */
  public static async setPageZone(
    projectRef: string,
    url: string,
    ref: { kind: GeoZone['kind']; code: string } | null
  ): Promise<GeoZone | null> {
    const project = await prisma.project.findFirst({ where: { OR: [{ id: projectRef }, { domain: projectRef }] } });
    if (!project) throw new Error('Projet introuvable');
    const zone = ref ? await GeoApi.resolve(ref.kind, ref.code) : null;
    if (ref && !zone) throw new Error(`Zone introuvable : ${ref.kind} ${ref.code}`);
    const pageZones = this.parseJson<Record<string, GeoZone>>(project.pageZonesRaw) ?? {};
    const key = SiteCrawler.urlKey(url);
    if (zone) pageZones[key] = zone;
    else delete pageZones[key];
    await prisma.project.update({ where: { id: project.id }, data: { pageZonesRaw: JSON.stringify(pageZones) } });
    await this.forgetProposedQueries(project.id, key);
    return zone;
  }

  /** Recherches proposées et requête déduite oubliées (requêtes saisies gardées) : reproposées à la prochaine analyse */
  private static async forgetProposedQueries(projectId: string, onlyUrlKey?: string) {
    const audit = await prisma.audit.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!audit) return;
    const pages = await prisma.page.findMany({ where: { auditId: audit.id, isPillar: true } });
    for (const page of pages) {
      if (onlyUrlKey && SiteCrawler.urlKey(page.url) !== onlyUrlKey) continue;
      const metrics = this.parseJson<Record<string, unknown>>(page.metricsRaw) ?? {};
      if (!metrics.keptCandidates && !metrics.keptQuery) continue;
      delete metrics.keptCandidates;
      if (page.targetQuerySource !== 'MANUAL') delete metrics.keptQuery;
      await prisma.page.update({ where: { id: page.id }, data: { metricsRaw: JSON.stringify(metrics) } });
    }
  }

  /**
   * Lieux à retirer des recherches proposées : toutes les zones du projet et des pages (avec leur département et
   * leur région), puis la ville de la page repérée par l'IA. La zone est ajoutée au moment de la mesure.
   */
  private static async placeNamesFor(page: Page): Promise<string[]> {
    const audit = await prisma.audit.findUnique({
      where: { id: page.auditId },
      select: { project: { select: { zonesRaw: true, pageZonesRaw: true } } }
    });
    const zones = [
      ...(this.parseJson<GeoZone[]>(audit?.project.zonesRaw) ?? []),
      ...Object.values(this.parseJson<Record<string, GeoZone>>(audit?.project.pageZonesRaw) ?? {})
    ];
    const city = this.parseJson<{ editorial?: EditorialEvaluation }>(page.aiEvaluationRaw)?.editorial?.search?.local?.city;
    const names = zones.flatMap((zone) => [zone.name, zone.city.name, zone.departement?.name, zone.region?.name]);
    return Array.from(new Set([...names, city].filter((name): name is string => Boolean(name))));
  }

  /** Noms des zones de la page (sa zone propre, sinon celles du projet) */
  private static async zoneNamesFor(page: Page): Promise<string[]> {
    const audit = await prisma.audit.findUnique({
      where: { id: page.auditId },
      select: { project: { select: { zonesRaw: true, pageZonesRaw: true } } }
    });
    const zones = measurementZones(
      this.parseJson<GeoZone[]>(audit?.project.zonesRaw) ?? [],
      this.parseJson<Record<string, GeoZone>>(audit?.project.pageZonesRaw)?.[SiteCrawler.urlKey(page.url)]
    );
    return zones.filter((zone): zone is GeoZone => Boolean(zone)).map((zone) => zone.name);
  }

  /**
   * Incohérences entre les pages du site, enregistrées comme anomalies SITE_* :
   * contrôles sans IA sur toutes les pages explorées, puis (si demandé) une relecture IA des piliers.
   */
  private static async refreshSiteCoherence(auditId: string, withAi: boolean) {
    const audit = await prisma.audit.findUnique({ where: { id: auditId }, include: { project: true } });
    const pages = (await prisma.page.findMany({ where: { auditId } })).filter(
      (page) => page.httpStatus < 400 && page.isIndexable
    );
    if (!audit || pages.length === 0) return;

    const infos = pages.map((page) => {
      const metrics = this.parseJson<{ content?: ContentSnapshot; roleOverride?: PageRole }>(page.metricsRaw);
      const aiRole = this.parseJson<{ editorial?: EditorialEvaluation }>(page.aiEvaluationRaw)?.editorial?.role;
      return {
        page,
        metrics,
        role: resolvePageRole({
          manual: metrics?.roleOverride,
          ai: aiRole,
          detected: classifyPageRole({
            path: page.path,
            depth: page.depth,
            hasPublicationDate: metrics?.content?.hasPublicationDate,
            wordCount: page.wordCount,
            schemaTypes: metrics?.content?.schemaTypes,
            ...metrics?.content?.roleSignals
          })
        }).role
      };
    });

    await prisma.issue.deleteMany({
      where: {
        auditId,
        OR: [
          { code: { in: DETERMINISTIC_SITE_CODES } },
          ...(withAi ? [{ code: { startsWith: 'SITE_FINDING_' } }] : [])
        ]
      }
    });

    const toRecord = (issue: {
      pillar: string;
      severity: string;
      code: string;
      title: string;
      description: string;
      recommendation: string;
      stepsToResolve: string[];
      affectedUrl?: string;
    }) => ({
      auditId,
      pillar: issue.pillar,
      severity: issue.severity,
      code: issue.code,
      title: issue.title,
      description: issue.description,
      recommendation: issue.recommendation,
      stepsToResolve: JSON.stringify(issue.stepsToResolve),
      affectedUrl: issue.affectedUrl ?? null,
      metadata: null
    });

    const deterministic = buildSiteCoherenceIssues(
      infos.map(({ page, metrics, role }) => ({
        url: page.url,
        path: page.path,
        role,
        isPillar: page.isPillar,
        title: page.title ?? undefined,
        metaDescription: page.metaDescription ?? undefined,
        h1: page.h1 ?? undefined,
        counts: metrics?.content?.signals?.facts?.counts ?? []
      }))
    );
    if (deterministic.length > 0) {
      await prisma.issue.createMany({ data: deterministic.map(toRecord) });
    }

    const pillars = infos.filter(({ page }) => page.isPillar);
    if (!withAi || pillars.length < 2 || !llmGateway.isConfigured()) return;

    try {
      const findings = await llmGateway.evaluateSiteCoherence({
        domain: audit.project.domain,
        pages: pillars.map(({ page, metrics, role }) => {
          const evaluation = this.parseJson<{ editorial?: EditorialEvaluation }>(page.aiEvaluationRaw)?.editorial;
          return {
            url: page.url,
            role,
            title: page.title ?? undefined,
            h1: page.h1 ?? undefined,
            metaDescription: page.metaDescription ?? undefined,
            targetQuery: page.targetQuery ?? undefined,
            intent: evaluation?.search?.targetQuery.intent,
            excerpt: metrics?.content?.excerpt ?? ''
          };
        })
      });

      const records = findings.flatMap((finding, index) => {
        const code = `SITE_FINDING_${index + 1}`;
        const urls = finding.pages.length > 0 ? finding.pages : [pillars[0].page.url];
        return urls.map((url) =>
          toRecord({
            pillar: 'EDITORIAL',
            severity: 'INFO',
            code,
            title: finding.title,
            description: `${finding.explanation} (Estimation de l'IA, à vérifier.)`,
            recommendation: finding.recommendation,
            stepsToResolve: [finding.recommendation],
            affectedUrl: url
          })
        );
      });
      if (records.length > 0) await prisma.issue.createMany({ data: records });
    } catch (err: any) {
      console.error(`[AuditService] Relecture de cohérence impossible : ${err?.message ?? err}`);
    }
  }

  /**
   * Enregistre les relevés Google d'une page dans son JSON d'évaluation (sans toucher au reste) : `serp` est le relevé
   * de la requête cible (il sert au score), `queries` tous les relevés du lancement (requête cible et candidates).
   */
  private static async saveSerp(page: Page, serp: SerpAnalysis | null, queries?: SerpAnalysis[]) {
    jobRegistry.beatSerp();
    const current = await prisma.page.findUnique({ where: { id: page.id }, select: { aiEvaluationRaw: true } });
    const stored = this.parseJson<Record<string, unknown>>(current?.aiEvaluationRaw) ?? {};
    if (serp) stored.serp = serp;
    else delete stored.serp;
    if (queries) stored.serpQueries = queries;
    else if (!serp) delete stored.serpQueries;
    // Historique des relevés terminés (position par date et par requête), pour suivre les progrès d'un audit à l'autre
    const history = Array.isArray(stored.serpHistory) ? (stored.serpHistory as SerpHistoryEntry[]) : [];
    for (const done of queries ?? (serp ? [serp] : [])) {
      if (done.status !== 'DONE' || !done.fetchedAt) continue;
      if (
        history.some(
          (entry) => entry.date === done.fetchedAt && entry.query === done.query && entry.zone === done.zone?.id
        )
      )
        continue;
      history.push({
        ...(done.zone ? { zone: done.zone.id } : {}),
        date: done.fetchedAt,
        query: done.query,
        provider: done.provider ?? 'browser',
        pagePosition: done.pagePosition,
        sitelinkOf: done.pageSitelinkOf,
        ownPosition: done.ownPosition
      });
    }
    if (history.length > 0) stored.serpHistory = history.slice(-this.MAX_SERP_HISTORY);
    const updated = await prisma.page.update({ where: { id: page.id }, data: { aiEvaluationRaw: JSON.stringify(stored) } });
    // Une mesure Google remplace l'estimation de cannibalisation et confirme la requête cible
    if (serp?.status === 'DONE') await this.rescoreEditorial(updated);
  }

  /**
   * Lance en arrière-plan l'analyse SERP de pages : recherche Google de la requête cible et des requêtes candidates
   * (3 au plus par page), position du domaine, lecture des 3 premiers concurrents de la requête cible, écarts de
   * sections, intention des résultats. Les recherches suivent un budget (par lancement et par jour, tous projets) :
   * ce qui le dépasse, ou ce qu'un captcha interrompt, reste « en attente » et se reprend avec `resume`.
   * Retourne `started: false` si une analyse est déjà en cours.
   */
  public static async startSerpAnalysis(
    auditId: string,
    pageIds: string[],
    options: {
      queries?: Record<string, string>;
      /** Requêtes à mesurer choisies par page (nettoyées par `chosenSerpQueries`), à la place des requêtes proposées */
      queryLists?: Record<string, string[]>;
      provider?: SerpProviderPort;
      budget?: Partial<SerpBudget>;
      /** Reprendre seulement les recherches en attente de ces pages, sans refaire les autres */
      resume?: boolean;
    } = {}
  ): Promise<{ started: boolean; reason?: string; pages: number; queued: number; remainingToday: number }> {
    const provider = options.provider ?? createSerpProvider();
    const queries = options.queries ?? {};
    const budget = resolveSerpBudget(options.budget);
    const audit = await prisma.audit.findUnique({ where: { id: auditId }, include: { project: true } });
    if (!audit) throw new Error('Audit introuvable');
    if (!['AWAITING_AI_SELECTION', 'ANALYZING_AI', 'COMPLETED'].includes(audit.status)) {
      throw new Error('Le crawl n’est pas terminé');
    }
    if (jobRegistry.serpAlive()) {
      return { started: false, reason: 'Une analyse SERP est déjà en cours.', pages: 0, queued: 0, remainingToday: 0 };
    }
    // Mesure précédente interrompue (serveur arrêté, travail bloqué) : ses recherches « en cours » passent en attente
    await this.recoverInterrupted(auditId);
    const usedToday = await this.serpUsageToday();
    if (remainingSearches(budget, 0, usedToday) < 1) {
      return {
        started: false,
        reason: `Budget du jour atteint (${budget.perDay} recherches Google) : reprenez demain ou augmentez-le dans les Paramètres.`,
        pages: 0,
        queued: 0,
        remainingToday: 0
      };
    }

    // Toute page explorée, indexable et accessible peut être mesurée : piliers ou non
    let pages = await prisma.page.findMany({
      where: { auditId, id: { in: pageIds }, httpStatus: { lt: 400 }, isIndexable: true }
    });
    if (pages.length === 0) throw new Error('Aucune page analysable pour la SERP');

    // Requêtes saisies par l'utilisateur : manuelles, conservées pour la page (et ses analyses futures)
    if (!options.resume) {
      pages = await Promise.all(
        pages.map((page) =>
          queries[page.id]
            ? prisma.page.update({
                where: { id: page.id },
                data: { targetQuery: queries[page.id], targetQuerySource: 'MANUAL' }
              })
            : page
        )
      );
    }

    // Zones : celles de la page si elle en a une, sinon celles du projet ; aucune : mesure sans lieu simulé
    const projectZones = this.parseJson<GeoZone[]>(audit.project.zonesRaw) ?? [];
    const pageZones = this.parseJson<Record<string, GeoZone>>(audit.project.pageZonesRaw) ?? {};

    // Recherches à faire par page : toutes, ou en reprise celles restées en attente (les relevés faits sont gardés)
    const jobs: SerpJob[] = [];
    for (const page of pages) {
      const zones = measurementZones(projectZones, pageZones[SiteCrawler.urlKey(page.url)]);
      const stored = this.parseJson<{ serpQueries?: SerpAnalysis[] }>(page.aiEvaluationRaw)?.serpQueries ?? [];
      // Requêtes : en reprise celles du lancement interrompu ; sinon celles choisies par l'utilisateur (gardées telles
      // quelles), à défaut la requête cible et les candidates
      const resumed = options.resume ? Array.from(new Set(stored.map((serp) => serp.query).filter(Boolean))) : [];
      const chosen = chosenSerpQueries(options.queryLists?.[page.id]);
      const list = resumed.length
        ? resumed
        : chosen.length
          ? chosen
          : this.serpQueriesOf(page, await this.placeNamesFor(page));
      if (!options.resume) await this.markTargetSkipped(page, list);
      const analyses = list.flatMap((query) =>
        zones.map((zone) =>
          options.resume
            ? stored.find((serp) => serp.query === query && serp.zone?.id === zone?.id) ??
              this.emptySerp(query, 'PENDING', 'En attente', zone)
            : this.emptySerp(query, 'RUNNING', undefined, zone)
        )
      );
      const todo = analyses
        .map((_, index) => index)
        .filter((index) => !options.resume || analyses[index].status === 'PENDING');
      if (todo.length === 0) continue;
      for (const index of todo) analyses[index] = { ...analyses[index], status: 'RUNNING', message: undefined };
      await this.saveSerp(page, analyses[0], analyses);
      jobs.push({ page, isPillar: page.isPillar, queries: list, zones, zoneCount: zones.length, analyses, todo: new Set(todo) });
    }
    if (jobs.length === 0) {
      return { started: false, reason: 'Aucune recherche en attente pour ces pages.', pages: 0, queued: 0, remainingToday: 0 };
    }

    jobRegistry.startSerp();
    this.runSerpJob(jobs, audit.project.domain, provider, budget, usedToday)
      .catch((err) => console.error('[AuditService] Analyse SERP interrompue :', err))
      .finally(() => jobRegistry.endSerp());

    const queued = jobs.reduce((sum, job) => sum + job.todo.size, 0);
    return { started: true, pages: jobs.length, queued, remainingToday: remainingSearches(budget, 0, usedToday) };
  }

  /**
   * Remet en état les travaux interrompus (serveur arrêté ou redémarré, travail bloqué sans avancée) :
   * - exploration en cours : audit en échec, à relancer ;
   * - analyse IA en cours : retour au choix des pages, à relancer (les pages déjà analysées ne sont pas refaites) ;
   * - recherches Google « en cours » : « en attente », reprises par le bouton Reprendre.
   * Appelée à la lecture d'un audit et des projets, et avant une nouvelle mesure. Sans `auditId` : tous les audits.
   */
  public static async recoverInterrupted(auditId?: string) {
    const stuck = await prisma.audit.findMany({
      where: { ...(auditId ? { id: auditId } : {}), status: { in: ['QUEUED', 'CRAWLING_TECH', 'ANALYZING_AI'] } },
      select: { id: true, status: true }
    });
    for (const audit of stuck) {
      if (jobRegistry.auditAlive(audit.id)) continue;
      jobRegistry.endAudit(audit.id);
      await prisma.audit.update({
        where: { id: audit.id },
        data:
          audit.status === 'ANALYZING_AI'
            ? {
                status: 'AWAITING_AI_SELECTION',
                errorMessage: 'Analyse IA interrompue : relancez-la, les pages déjà analysées ne seront pas refaites.'
              }
            : { status: 'FAILED', errorMessage: 'Exploration interrompue (serveur arrêté ou bloqué) : relancez l’audit.' }
      });
    }

    if (jobRegistry.serpAlive()) return;
    jobRegistry.endSerp();
    const pages = await prisma.page.findMany({
      where: { ...(auditId ? { auditId } : {}), aiEvaluationRaw: { contains: '"RUNNING"' } },
      select: { id: true, aiEvaluationRaw: true }
    });
    const interrupted = (serp: SerpAnalysis): SerpAnalysis =>
      serp.status === 'RUNNING' ? { ...serp, status: 'PENDING', message: 'Interrompue : reprenez la mesure' } : serp;
    for (const page of pages) {
      const stored = this.parseJson<{ serp?: SerpAnalysis; serpQueries?: SerpAnalysis[] }>(page.aiEvaluationRaw);
      if (!stored) continue;
      const running = stored.serp?.status === 'RUNNING' || (stored.serpQueries ?? []).some((serp) => serp.status === 'RUNNING');
      if (!running) continue;
      await prisma.page.update({
        where: { id: page.id },
        data: {
          aiEvaluationRaw: JSON.stringify({
            ...stored,
            ...(stored.serp ? { serp: interrupted(stored.serp) } : {}),
            ...(stored.serpQueries ? { serpQueries: stored.serpQueries.map(interrupted) } : {})
          })
        }
      });
    }
  }

  /**
   * Avis de l'IA sur les résultats Google d'une page, rédigé à partir des seuls faits mesurés (construits ici, côté
   * serveur). Enregistré avec la liste des relevés sur lesquels il repose : une nouvelle mesure le rend périmé.
   */
  public static async serpOpinion(auditId: string, pageId: string): Promise<{ text: string; model: string; basedOn: string[] }> {
    const page = await prisma.page.findFirst({ where: { id: pageId, auditId }, include: { audit: { include: { project: true } } } });
    if (!page) throw new Error('Page introuvable');
    if (!llmGateway.isConfigured()) throw new Error('Aucun fournisseur IA configuré');
    const stored = this.parseJson<Record<string, unknown> & { serp?: SerpAnalysis; serpQueries?: SerpAnalysis[] }>(page.aiEvaluationRaw) ?? {};
    const measures = (stored.serpQueries?.length ? stored.serpQueries : stored.serp ? [stored.serp] : []).filter(
      (serp) => serp.status === 'DONE'
    );
    if (measures.length === 0) throw new Error('Aucune mesure Google terminée pour cette page');
    const facts = serpFacts({ measures, pageUrl: page.url, ownDomain: page.audit.project.domain, pageWords: page.wordCount });
    const opinion = await llmGateway.serpOpinion(facts);
    const result = { ...opinion, basedOn: measures.map((serp) => serp.fetchedAt ?? '').sort() };
    await prisma.page.update({
      where: { id: page.id },
      data: { aiEvaluationRaw: JSON.stringify({ ...stored, serpOpinion: { ...result, createdAt: new Date().toISOString() } }) }
    });
    return result;
  }

  /** Recherches Google envoyées aujourd'hui, tous projets confondus */
  public static async serpUsageToday(): Promise<number> {
    const usage = await prisma.serpUsage.findUnique({ where: { day: usageDay() } });
    return usage?.searches ?? 0;
  }

  private static async countSerpSearches(count: number) {
    if (count <= 0) return;
    const day = usageDay();
    await prisma.serpUsage.upsert({
      where: { day },
      create: { day, searches: count },
      update: { searches: { increment: count } }
    });
  }

  private static emptySerp(
    query: string,
    status: SerpAnalysis['status'],
    message?: string,
    zone?: GeoZone
  ): SerpAnalysis {
    return {
      status,
      ...(message ? { message } : {}),
      ...(zone ? { zone: zoneTag(zone), sentQuery: queryForZone(query, zone) } : {}),
      query,
      results: [],
      ownPosition: null,
      pagePosition: null,
      pageSitelinkOf: null,
      ownUrls: [],
      competitors: [],
      gaps: { missingSections: [], competitorAvgWords: null },
      intent: { dominant: null, counts: {} },
      snippetBenchmark: { avgTitleLength: null, avgSnippetLength: null }
    };
  }

  /**
   * Note la requête cible décochée par l'utilisateur pour ce lancement (`serpTargetSkipped`) : le relevé principal porte
   * alors sur une autre requête, sans être présenté comme une mesure périmée. Effacée si la cible est mesurée.
   */
  private static async markTargetSkipped(page: Page, list: string[]) {
    const stored = this.parseJson<Record<string, unknown> & { editorial?: EditorialEvaluation }>(page.aiEvaluationRaw) ?? {};
    const target = stored.editorial?.search?.targetQuery.query ?? page.targetQuery ?? undefined;
    const skipped = target && !list.some((query) => normalizeText(query) === normalizeText(target)) ? target : undefined;
    if ((stored.serpTargetSkipped ?? undefined) === skipped) return;
    if (skipped) stored.serpTargetSkipped = skipped;
    else delete stored.serpTargetSkipped;
    await prisma.page.update({ where: { id: page.id }, data: { aiEvaluationRaw: JSON.stringify(stored) } });
  }

  /**
   * Requêtes mesurées pour une page, sans lieu : la requête cible d'abord, puis les candidates (suggérées par Google
   * d'abord), 3 au plus. Les lieux sont retirés des requêtes proposées ou déduites (une requête saisie reste telle
   * quelle) ; la zone choisie est ajoutée à la fin au moment de la mesure (`queryForZone`), et sans zone rien n'est
   * ajouté.
   */
  private static serpQueriesOf(page: Page, places: string[]): string[] {
    const editorial = this.parseJson<{ editorial?: EditorialEvaluation }>(page.aiEvaluationRaw)?.editorial;
    const candidates = (
      editorial?.search?.candidates ??
      this.parseJson<{ keptCandidates?: QueryCandidate[] }>(page.metricsRaw)?.keptCandidates ??
      []
    ).map((candidate) => ({ ...candidate, query: stripPlaces(candidate.query, places) || candidate.query }));
    const target = (page.targetQuery || page.h1 || page.title || '').trim();
    const first = page.targetQuerySource === 'MANUAL' ? target : stripPlaces(target, places) || target;
    return serpQueriesFor(first, candidates);
  }

  /**
   * Exécute les recherches dans l'ordre de priorité (requête cible de chaque page d'abord, pages stratégiques en tête),
   * dans la limite du budget. Chaque page de résultats demandée à Google compte ; une réponse du cache ne compte pas.
   * Budget épuisé : la recherche reste en attente ; pas assez pour les pages 2 et 3 : seul le Top 10 est lu ; pas
   * assez pour un re-test : la première mesure est gardée. Captcha : tout ce qui reste passe en attente.
   */
  private static async runSerpJob(
    jobs: SerpJob[],
    domain: string,
    provider: SerpProviderPort,
    budget: SerpBudget,
    usedTodayAtStart: number
  ) {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 4000 + Math.random() * 4000));
    const rankOf = (serp: SerpAnalysis) => serp.pagePosition ?? serp.pageSitelinkOf ?? null;
    let usedInRun = 0;
    let usedToday = usedTodayAtStart;
    let requested = false;
    const remaining = () => remainingSearches(budget, usedInRun, usedToday);
    const count = async (requests: number) => {
      jobRegistry.beatSerp();
      usedInRun += requests;
      usedToday += requests;
      if (requests > 0) requested = true;
      await this.countSerpSearches(requests);
    };
    // Pause entre deux vraies recherches seulement (une réponse du cache n'en demande pas)
    const politePause = async () => {
      if (requested) await pause();
    };
    const budgetMessage = `En attente : budget de recherches atteint (${budget.perRun} par lancement, ${budget.perDay} par jour)`;

    const tasks = prioritizeSearches(jobs)
      .map((task) => ({ ...task, index: task.queryIndex * task.page.zoneCount + task.zoneIndex }))
      .filter(({ page: job, index }) => job.todo.has(index));
    for (let t = 0; t < tasks.length; t++) {
      const { page: job, queryIndex: q, zoneIndex: z, index: slot } = tasks[t];
      const { page, queries, analyses } = job;
      const query = queries[q];
      const zone = job.zones[z];
      // Texte envoyé à Google : la requête suivie du nom de la zone (« agence web oise ») ; sans zone, la requête seule
      const sent = queryForZone(query, zone);

      if (remaining() < 1) {
        analyses[slot] = this.emptySerp(query, 'PENDING', budgetMessage, zone);
        await this.saveSerp(page, analyses[0], analyses);
        continue;
      }

      const metrics = this.parseJson<{ content?: ContentSnapshot }>(page.metricsRaw);
      const ourText = `${(metrics?.content?.headings ?? []).map((h) => h.text).join(' ')} ${metrics?.content?.excerpt ?? ''}`;
      const history = this.parseJson<{ serpHistory?: SerpHistoryEntry[] }>(page.aiEvaluationRaw)?.serpHistory ?? [];
      try {
        if (!query) throw new Error('Aucune requête cible pour cette page');
        await politePause();
        const brandQuery = brandVariants(domain).some((brand) => normalizeText(sent).includes(brand));
        let topOnly = false;

        // Mesure : première page de Google ; si la page n'y est pas (hors requête de marque), pages 2 et 3, pour voir
        // les positions 11 à 30, celles où un effort éditorial rapporte le plus. Les concurrents ne sont lus que pour
        // la requête cible (écarts de sections du pilier éditorial).
        const measure = async (fresh: boolean) => {
          const first = await provider.search(sent, { domain, fresh });
          await count(first.requests);
          let results = first.results;
          const quick = buildSerpAnalysis({ query, fetchedAt: '', results, domain, pageUrl: page.url, competitors: [], ourText: '' });
          if (!brandQuery && rankOf(quick) === null) {
            if (remaining() >= 2) {
              await politePause();
              const deeper = await provider.search(sent, { domain, pages: 2, start: 1, fresh });
              await count(deeper.requests);
              results = [...results, ...deeper.results];
            } else {
              topOnly = true;
            }
          }
          // Concurrents lus pour la requête visée dans la zone principale seulement (écarts de sections)
          const competitors = q === 0 && z === 0 ? await this.readCompetitors(results, domain) : [];
          return buildSerpAnalysis({
            query,
            fetchedAt: new Date().toISOString(),
            results,
            domain,
            pageUrl: page.url,
            competitors,
            ourText,
            features: first.features
          });
        };

        let analysis: SerpAnalysis = { ...(await measure(false)), provider: provider.id };
        // Re-test automatique si la position s'écarte de plus de 3 rangs du relevé précédent (ou apparaît / disparaît) :
        // une mesure isolée peut fluctuer. La seconde mesure est retenue, la première est gardée pour mémoire.
        // Comparaison avec un relevé du même fournisseur seulement : Chrome local et API ne mesurent pas pareil
        const previous = history
          .filter(
            (entry) => entry.query === query && entry.zone === zone?.id && (entry.provider ?? 'browser') === provider.id
          )
          .at(-1);
        if (previous && remaining() >= 1) {
          const before = previous.pagePosition ?? previous.sitelinkOf ?? null;
          const now = rankOf(analysis);
          const moved = before === null || now === null ? before !== now : Math.abs(before - now) > 3;
          if (moved) {
            await politePause();
            const retest = await measure(true);
            analysis = { ...retest, provider: provider.id, retest: { firstRank: now, previousRank: before } };
          }
        }
        if (topOnly) {
          analysis = { ...analysis, message: 'Top 10 seulement : budget insuffisant pour lire les pages 2 et 3' };
        }
        analyses[slot] = { ...analysis, ...(zone ? { zone: zoneTag(zone), sentQuery: sent } : {}) };
        await this.saveSerp(page, analyses[0], analyses);
      } catch (err: any) {
        // Une recherche en échec a pu partir vers Google : elle compte
        await count(1);
        const blocked = err instanceof SerpBlockedError;
        console.error(`[AuditService] SERP en échec pour « ${sent} » : ${err?.message ?? err}`);
        if (blocked) {
          // Captcha : inutile d'insister ; cette recherche et toutes les suivantes restent en attente, à reprendre
          const waiting = 'En attente : captcha ou blocage, à reprendre plus tard';
          analyses[slot] = this.emptySerp(query, 'PENDING', waiting, zone);
          for (const rest of tasks.slice(t + 1)) {
            rest.page.analyses[rest.index] = this.emptySerp(
              rest.page.queries[rest.queryIndex],
              'PENDING',
              waiting,
              rest.page.zones[rest.zoneIndex]
            );
          }
          for (const other of jobs) await this.saveSerp(other.page, other.analyses[0], other.analyses);
          return;
        }
        analyses[slot] = this.emptySerp(query, 'ERROR', err?.message ?? 'Erreur inconnue', zone);
        await this.saveSerp(page, analyses[0], analyses);
      }
    }

    // Choix d'une meilleure requête cible d'après la zone principale (une mesure par requête)
    for (const job of jobs) {
      await this.switchToMeasuredQuery(
        job.page.id,
        domain,
        job.analyses.filter((_, index) => index % job.zoneCount === 0)
      );
    }
  }

  /**
   * Requête cible déduite mais ni suggérée par Google, ni retrouvée dans les résultats, alors que la page sort sur une
   * autre candidate : cette requête mesurée devient la cible et la page est ré-analysée par l'IA sur elle.
   */
  private static async switchToMeasuredQuery(pageId: string, domain: string, analyses: SerpAnalysis[]) {
    const page = await prisma.page.findUnique({ where: { id: pageId } });
    if (!page?.isPillar || page.targetQuerySource === 'MANUAL' || !page.targetQuery) return;
    const search = this.parseJson<{ editorial?: EditorialEvaluation }>(page.aiEvaluationRaw)?.editorial?.search;
    const candidates = search?.candidates ?? [];
    if (!search || candidates.length === 0) return;

    const target = { ...search.targetQuery, suggestedByGoogle: search.targetQuery.suggestedByGoogle === true };
    const better = betterMeasuredTarget(target, analyses, candidates);
    if (!better) return;

    const measured = analyses.find((serp) => serp.query === better);
    const stored = this.parseJson<Record<string, unknown>>(page.aiEvaluationRaw) ?? {};
    const updated = await prisma.page.update({
      where: { id: page.id },
      data: {
        targetQuery: better,
        targetQuerySource: 'AUTO',
        metricsRaw: JSON.stringify({ ...this.parseJson<Record<string, unknown>>(page.metricsRaw), keptQuery: better }),
        aiEvaluationRaw: JSON.stringify({ ...stored, ...(measured ? { serp: measured } : {}) })
      }
    });
    console.info(`[AuditService] ${page.url} : requête cible « ${page.targetQuery} » remplacée par « ${better} », mesurée dans Google`);

    const pillars = await prisma.page.findMany({ where: { auditId: page.auditId, isPillar: true } });
    await this.analyzeEditorial(updated, pillars, domain, { force: true });
    const audit = await prisma.audit.findUnique({ where: { id: page.auditId } });
    if (audit?.status === 'COMPLETED') {
      await this.refreshSiteCoherence(page.auditId, false);
      await this.finalizeAudit(page.auditId);
    }
  }

  /** Lit les premiers résultats d'autres domaines pour en tirer titres, structure et longueur */
  private static async readCompetitors(
    results: { position: number; url: string; domain: string }[],
    domain: string
  ): Promise<SerpCompetitorPage[]> {
    const own = domain.toLowerCase().replace(/^www\./, '');
    const targets = results
      .filter((result) => result.url && result.domain !== own && !result.domain.endsWith(`.${own}`))
      .slice(0, this.SERP_COMPETITORS_READ);

    const pages = await Promise.all(
      targets.map(async (target): Promise<SerpCompetitorPage | null> => {
        const raw = await SiteCrawler.fetchSinglePage(target.url);
        if (!raw) return null;
        return {
          position: target.position,
          url: target.url,
          domain: target.domain,
          title: raw.title,
          wordCount: raw.wordCount,
          headings: raw.headings.filter((h) => h.level === 2 || h.level === 3).map((h) => h.text)
        };
      })
    );
    return pages.filter((page): page is SerpCompetitorPage => page !== null);
  }

  /**
   * Corrige à la main le rôle d'une page (null : retour à la détection). Pour un pilier déjà analysé, le score
   * éditorial est recalculé à partir de l'évaluation enregistrée, sans nouvel appel à l'IA.
   */
  public static async setPageRole(auditId: string, pageId: string, role: PageRole | null) {
    const page = await prisma.page.findFirst({ where: { id: pageId, auditId } });
    if (!page) throw new Error('Page introuvable');

    const metrics = this.parseJson<Record<string, unknown>>(page.metricsRaw) ?? {};
    const previous = (metrics.roleOverride as PageRole | undefined) ?? this.parseJson<{ editorial?: EditorialEvaluation }>(page.aiEvaluationRaw)?.editorial?.role;
    if (role) metrics.roleOverride = role;
    else delete metrics.roleOverride;
    // Passage entre un rôle à recherches génériques et contact / utilitaire : la requête déduite et les candidates
    // ne valent plus, la prochaine analyse IA les repropose (une requête saisie est gardée)
    const brandOnly = (value?: PageRole | null) => value === 'contact' || value === 'utility';
    if (brandOnly(previous) !== brandOnly(role ?? undefined)) {
      delete metrics.keptCandidates;
      if (page.targetQuerySource !== 'MANUAL') delete metrics.keptQuery;
    }
    const updated = await prisma.page.update({ where: { id: pageId }, data: { metricsRaw: JSON.stringify(metrics) } });

    await this.rescoreEditorial(updated);

    const audit = await prisma.audit.findUnique({ where: { id: auditId } });
    if (audit?.status === 'COMPLETED') {
      await this.refreshSiteCoherence(auditId, false);
      await this.finalizeAudit(auditId);
    }
  }

  /**
   * Fixe l'objectif d'une page (null : retour à celui du rôle). « Aller droit au but » ne demande aucun nouvel avis de
   * l'IA : la couverture du sujet sort simplement du score. Passer à « couvrir le sujet » ou « présenter et
   * convaincre » alors que l'IA a jugé la page sous un autre objectif relance son analyse (une page, un appel), car
   * ce qu'elle propose n'est pas le même.
   */
  public static async setPageGoal(auditId: string, pageId: string, goal: PageGoal | null) {
    const page = await prisma.page.findFirst({ where: { id: pageId, auditId } });
    if (!page) throw new Error('Page introuvable');

    const metrics = this.parseJson<Record<string, unknown>>(page.metricsRaw) ?? {};
    if (goal) metrics.goalOverride = goal;
    else delete metrics.goalOverride;
    const updated = await prisma.page.update({ where: { id: pageId }, data: { metricsRaw: JSON.stringify(metrics) } });

    // Le cache de l'analyse tient compte de l'objectif : sans changement pour l'IA, seul le score est recalculé
    const stored = this.parseJson<{ editorial?: EditorialEvaluation }>(updated.aiEvaluationRaw)?.editorial;
    if (updated.isPillar && stored && goal !== 'direct') {
      await this.reanalyzePage(auditId, pageId);
      return;
    }

    await this.rescoreEditorial(updated);
    const audit = await prisma.audit.findUnique({ where: { id: auditId } });
    if (audit?.status === 'COMPLETED') {
      await this.refreshSiteCoherence(auditId, false);
      await this.finalizeAudit(auditId);
    }
  }

  /**
   * Mots-clés de la page et leur volume de recherche (Keyword Planner, ou source de démonstration) : graines tirées de
   * la requête visée, des recherches proposées, du Title, du H1 et des H2. Enregistré dans
   * l'analyse de la page (`keywords`), sans effet sur la note. Source absente ou en échec : liste sans volumes.
   */
  public static async researchKeywords(auditId: string, pageId: string): Promise<KeywordResearch> {
    const page = await prisma.page.findFirst({ where: { id: pageId, auditId }, include: { audit: { select: { project: { select: { domain: true } } } } } });
    if (!page) throw new Error('Page introuvable');

    const stored = this.parseJson<Record<string, unknown> & { editorial?: EditorialEvaluation }>(page.aiEvaluationRaw) ?? {};
    const search = stored.editorial?.search;
    const research = await this.buildKeywordResearch(
      page,
      page.audit.project.domain,
      search?.targetQuery.query ?? page.targetQuery ?? undefined,
      search?.candidates,
      {
        problem: search?.problem,
        role: this.parseJson<{ roleOverride?: PageRole }>(page.metricsRaw)?.roleOverride ?? stored.editorial?.role
      }
    );
    // Source en échec (coupure, quota) : les volumes déjà enregistrés sont gardés plutôt qu'effacés
    const kept = this.keepPreviousKeywords(stored.keywords as KeywordResearch | undefined, research);
    const updated = await prisma.page.update({
      where: { id: page.id },
      data: { aiEvaluationRaw: JSON.stringify({ ...stored, keywords: kept }) }
    });
    // Les volumes forment le groupe de requêtes notées : note recalculée sans appel à l'IA
    await this.rescoreEditorial(updated);
    return research;
  }

  /**
   * Nouvelle recherche en échec (coupure réseau, quota) alors qu'une recherche précédente avait des volumes : la
   * précédente est gardée, avec le message d'erreur, pour ne pas effacer les requêtes notées
   */
  private static keepPreviousKeywords(previous: KeywordResearch | undefined, fresh: KeywordResearch): KeywordResearch {
    const hadVolumes = previous && !previous.error && previous.rows.some((row) => (row.avgMonthlySearches ?? 0) > 0);
    // Tri de l'IA indisponible cette fois : les avis du tri précédent sont repris pour les mêmes mots-clés
    if (!fresh.error && previous && !fresh.rows.some((row) => row.relevance) && previous.rows.some((row) => row.relevance)) {
      const verdicts = new Map(previous.rows.filter((row) => row.relevance).map((row) => [row.keyword, row.relevance]));
      fresh = { ...fresh, rows: fresh.rows.map((row) => (verdicts.has(row.keyword) ? { ...row, relevance: verdicts.get(row.keyword) } : row)) };
    }
    return fresh.error && hadVolumes
      ? { ...previous, warning: `${fresh.error} : volumes du ${new Date(previous.fetchedAt).toLocaleDateString('fr-FR')} gardés` }
      : fresh;
  }

  /** Mots-clés de la page et leurs volumes (source configurée), sans rien enregistrer */
  private static async buildKeywordResearch(
    page: Page,
    domain: string,
    target: string | undefined,
    candidates: QueryCandidate[] | undefined,
    /** Problématique et rôle de la page : l'IA juge les mots-clés par rapport à eux */
    context: { problem?: string; role?: PageRole } = {}
  ): Promise<KeywordResearch> {
    const snapshot = this.parseJson<{ content?: ContentSnapshot }>(page.metricsRaw)?.content;
    const brands = brandVariants(domain);
    const seeds = keywordSeeds({
      target,
      candidates: candidates?.map((candidate) => candidate.query),
      title: page.title,
      h1: page.h1,
      headings: snapshot?.headings,
      brands,
      places: await this.placeNamesFor(page)
    });

    const provider = keywordVolumeProvider();
    let result: Awaited<ReturnType<NonNullable<typeof provider>['ideas']>> | null = null;
    let error: string | undefined;
    if (provider && seeds.length > 0) {
      try {
        result = await provider.ideas(seeds.map((seed) => seed.keyword), { url: page.url });
      } catch (err: any) {
        error = err?.message ?? 'Source des volumes indisponible';
      }
    }

    const rows = buildKeywordRows(
      seeds,
      result,
      { title: page.title, h1: page.h1, headings: snapshot?.headings ?? [], text: snapshot?.excerpt ?? '' },
      brands
    );
    // Avis de l'IA sur les recherches qui ont un volume réel : la page y répond-elle ? Seules celles-ci sont notées
    // d'office. Volumes simulés ou IA indisponible : pas d'avis, les règles de mots communs s'appliquent
    const toJudge = rows
      .filter((row) => (row.avgMonthlySearches ?? 0) >= MIN_SCORED_VOLUME)
      .slice(0, MAX_JUDGED_KEYWORDS);
    if (provider && provider.id !== 'mock' && !error && toJudge.length > 0 && llmGateway.isConfigured()) {
      try {
        const verdicts = await llmGateway.judgeKeywords({
          url: page.url,
          problem: context.problem,
          role: context.role,
          title: page.title ?? undefined,
          h1: page.h1 ?? undefined,
          headings: snapshot?.headings ?? [],
          excerpt: snapshot?.excerpt ?? '',
          keywords: toJudge.map((row) => row.keyword)
        });
        // Texte où chercher la preuve : Title, H1, sous-titres et début du contenu
        const pageText = [page.title, page.h1, ...(snapshot?.headings ?? []).map((h) => h.text), snapshot?.excerpt].filter(Boolean).join(' ');
        for (const row of toJudge) {
          // Recherche oubliée par le modèle : ni notée d'office, ni écartée (« plus large »). « Visée » sans phrase de
          // la page qui le prouve : « plus large »
          const verdict = verdicts.find((item) => item.keyword === row.keyword);
          row.relevance =
            verdict?.verdict === 'match' && !matchEvidenceVerified(row.keyword, verdict.evidence, pageText)
              ? 'broad'
              : verdict?.verdict ?? 'broad';
        }
      } catch (err: any) {
        console.warn(`[AuditService] Avis de l'IA sur les mots-clés indisponible pour ${page.url} : ${err?.message ?? err}`);
      }
    }
    return {
      provider: provider?.id ?? null,
      simulated: provider?.id === 'mock',
      fetchedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
      rows
    };
  }

  /**
   * Fixe les requêtes notées d'une page (null : retour au choix automatique, par les volumes). Note recalculée sans
   * l'IA ; l'intention d'une requête ajoutée sera jugée à la prochaine analyse de la page.
   */
  public static async setQuerySet(auditId: string, pageId: string, queries: string[] | null) {
    const page = await prisma.page.findFirst({ where: { id: pageId, auditId } });
    if (!page) throw new Error('Page introuvable');
    const metrics = this.parseJson<Record<string, unknown>>(page.metricsRaw) ?? {};
    if (queries && queries.length > 0) metrics.querySetOverride = queries;
    else delete metrics.querySetOverride;
    const updated = await prisma.page.update({ where: { id: pageId }, data: { metricsRaw: JSON.stringify(metrics) } });
    await this.rescoreEditorial(updated);
    const audit = await prisma.audit.findUnique({ where: { id: auditId } });
    if (audit?.status === 'COMPLETED') {
      await this.refreshSiteCoherence(auditId, false);
      await this.finalizeAudit(auditId);
    }
  }

  /**
   * Réécriture proposée des titres et sections d'une page par l'IA (un appel), selon son objectif, avec la requête
   * principale et les recherches secondaires de la couverture des recherches. Enregistrée dans l'analyse (`rewrite`),
   * sans effet sur la note ; la proposition existante est rendue telle quelle si rien n'a changé, sauf `force`.
   */
  public static async proposeRewrite(auditId: string, pageId: string, options: { force?: boolean } = {}): Promise<PageRewrite> {
    const page = await prisma.page.findFirst({ where: { id: pageId, auditId }, include: { audit: { select: { project: { select: { domain: true } } } } } });
    if (!page) throw new Error('Page introuvable');
    if (!llmGateway.isConfigured()) throw new Error('Aucun fournisseur IA configuré');

    const stored = this.parseJson<Record<string, unknown> & { editorial?: EditorialEvaluation; keywords?: KeywordResearch; rewrite?: PageRewrite }>(
      page.aiEvaluationRaw
    ) ?? {};
    const metrics = this.parseJson<{ content?: ContentSnapshot; roleOverride?: PageRole; goalOverride?: PageGoal }>(page.metricsRaw);
    const snapshot = metrics?.content;
    if (!snapshot) throw new Error('Contenu de la page non enregistré : relancez l’audit');

    const role = resolvePageRole({
      manual: metrics?.roleOverride,
      ai: stored.editorial?.role,
      detected: classifyPageRole({
        path: page.path,
        depth: page.depth,
        hasPublicationDate: snapshot.hasPublicationDate,
        wordCount: page.wordCount,
        schemaTypes: snapshot.schemaTypes,
        ...snapshot.roleSignals
      })
    }).role;
    const { goal } = resolveGoal({ manual: metrics?.goalOverride, role });
    // Requêtes notées, de la plus lourde à la plus légère : la première sert de requête principale
    const querySet = [...(stored.editorial?.querySet ?? [])].sort((a, b) => b.weight - a.weight);
    const principal = querySet[0]?.query ?? stored.editorial?.search?.targetQuery.query ?? page.targetQuery ?? page.h1 ?? page.title ?? '';
    const basedOn = { contentHash: page.contentHash ?? '', goal, principal };
    if (!options.force && stored.rewrite && JSON.stringify(stored.rewrite.basedOn) === JSON.stringify(basedOn)) return stored.rewrite;

    const secondaries = querySet.slice(1).map((entry) => ({ keyword: entry.query }));
    const proposal = await llmGateway.proposeRewrite({
      url: page.url,
      domain: page.audit.project.domain,
      role,
      goal,
      title: page.title ?? undefined,
      metaDescription: page.metaDescription ?? undefined,
      h1: page.h1 ?? undefined,
      headings: snapshot.headings,
      excerpt: snapshot.excerpt,
      principal,
      secondaries: secondaries.map((item) => item.keyword)
    });
    const rewrite: PageRewrite = { ...proposal, createdAt: new Date().toISOString(), basedOn };
    await prisma.page.update({ where: { id: page.id }, data: { aiEvaluationRaw: JSON.stringify({ ...stored, rewrite }) } });
    return rewrite;
  }

  /**
   * Recalcule, sans appel à l'IA, la note éditoriale de tous les piliers d'un audit à partir des analyses
   * enregistrées, puis le score du site : applique un nouveau barème aux audits existants.
   */
  public static async rescoreAudit(auditId: string) {
    const pillars = await prisma.page.findMany({ where: { auditId, isPillar: true } });
    for (const page of pillars) await this.rescoreEditorial(page);
    const audit = await prisma.audit.findUnique({ where: { id: auditId } });
    if (audit?.status === 'COMPLETED') {
      await this.refreshSiteCoherence(auditId, false);
      await this.finalizeAudit(auditId);
    }
    return pillars.length;
  }

  /**
   * Recalcule le score éditorial d'un pilier déjà analysé à partir de l'évaluation enregistrée, sans appel à l'IA :
   * après une correction du rôle, ou quand une mesure Google (SERP) remplace une estimation.
   */
  private static async rescoreEditorial(page: Page) {
    const stored = this.parseJson<{
      editorial?: EditorialEvaluation;
      serp?: SerpAnalysis;
      serpQueries?: SerpAnalysis[];
      geo?: GeoEvaluation;
    }>(page.aiEvaluationRaw);
    const metrics = this.parseJson<{ content?: ContentSnapshot; roleOverride?: PageRole; goalOverride?: PageGoal }>(page.metricsRaw);
    if (!page.isPillar || !stored?.editorial || !metrics?.content) return;

    const raw = this.toRawPage(page, metrics.content, metrics.roleOverride, metrics.goalOverride);
    const result = EditorialScoringEngine.calculate(
      raw,
      stored.editorial,
      serpForQuery(stored.editorial.search?.targetQuery.query, stored.serp, stored.serpQueries),
      stored.serpQueries ?? []
    );
    // GEO recalculé avec le même rôle : la citabilité est sans objet sur une page de contact ou utilitaire
    const geo = stored.geo ? GeoScoringEngine.calculate(raw, stored.geo) : undefined;
    const geoScore = geo?.score ?? page.geoScore ?? 0;
    await prisma.page.update({
      where: { id: page.id },
      data: {
        editorialScore: result.score,
        ...(geo ? { geoScore: geo.score } : {}),
        pageScore: GlobalScoringEngine.computePageScore(page.techScore ?? 0, result.score, geoScore, true),
        // Évaluation enregistrée avec les mesures appliquées (cannibalisation mesurée, confiance de la requête)
        aiEvaluationRaw: JSON.stringify({
          ...this.parseJson<Record<string, unknown>>(page.aiEvaluationRaw),
          editorial: result.evaluation,
          ...(geo?.evaluation ? { geo: geo.evaluation } : {})
        })
      }
    });
    if (geo) await this.replaceGeoIssues(page, geo.issues);
    await prisma.issue.deleteMany({
      where: { auditId: page.auditId, pillar: 'EDITORIAL', affectedUrl: page.url, NOT: { code: { startsWith: 'SITE_' } } }
    });
    if (result.issues.length > 0) {
      await prisma.issue.createMany({
        data: result.issues.map((issue) => ({
          auditId: page.auditId,
          pillar: issue.pillar,
          severity: issue.severity,
          code: issue.code,
          title: issue.title,
          description: issue.description,
          recommendation: issue.recommendation,
          stepsToResolve: JSON.stringify(issue.stepsToResolve),
          affectedUrl: issue.affectedUrl,
          metadata: issue.metadata ? JSON.stringify(issue.metadata) : null
        }))
      });
    }
  }

  /**
   * Remplace les anomalies GEO d'une page après recalcul. L'anomalie de pare-feu (AI_BOTS_POSSIBLY_FIREWALLED) vient du
   * test du domaine fait au crawl, absent ici : elle est conservée.
   */
  private static async replaceGeoIssues(page: Page, issues: Issue[]) {
    await prisma.issue.deleteMany({
      where: { auditId: page.auditId, pillar: 'GEO', affectedUrl: page.url, NOT: { code: 'AI_BOTS_POSSIBLY_FIREWALLED' } }
    });
    const fresh = issues.filter((issue) => issue.code !== 'AI_BOTS_POSSIBLY_FIREWALLED');
    if (fresh.length === 0) return;
    await prisma.issue.createMany({
      data: fresh.map((issue) => ({
        auditId: page.auditId,
        pillar: issue.pillar,
        severity: issue.severity,
        code: issue.code,
        title: issue.title,
        description: issue.description,
        recommendation: issue.recommendation,
        stepsToResolve: JSON.stringify(issue.stepsToResolve),
        affectedUrl: issue.affectedUrl,
        metadata: issue.metadata ? JSON.stringify(issue.metadata) : null
      }))
    });
  }

  /** Points réellement mesurés par pilier pour une page : poids de la page dans les moyennes du projet */
  private static measuredPoints(page: { metricsRaw: string | null; aiEvaluationRaw: string | null }) {
    const metrics = this.parseJson<{ techMeasuredPoints?: number }>(page.metricsRaw);
    const evaluation = this.parseJson<{ editorial?: EditorialEvaluation; geo?: GeoEvaluation }>(page.aiEvaluationRaw);
    return {
      techMeasured: metrics?.techMeasuredPoints,
      editorialMeasured: evaluation?.editorial?.coverage?.measured,
      geoMeasured: evaluation?.geo ? geoMeasuredPoints(evaluation.geo) : undefined
    };
  }

  private static parseJson<T>(raw?: string | null): T | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Reconstitue le RawPageData minimal requis par les moteurs de scoring à partir de la base */
  private static toRawPage(page: Page, snapshot: ContentSnapshot, roleOverride?: PageRole, goalOverride?: PageGoal): RawPageData {
    return {
      url: page.url,
      path: page.path,
      httpStatus: page.httpStatus,
      depth: page.depth,
      isPillar: page.isPillar,
      isIndexable: page.isIndexable,
      title: page.title ?? undefined,
      metaDescription: page.metaDescription ?? undefined,
      h1: page.h1 ?? undefined,
      h1Count: page.h1 ? 1 : 0,
      headings: snapshot.headings,
      headingHierarchyValid: true,
      headingHierarchyErrors: [],
      wordCount: page.wordCount,
      inlinksCount: page.inlinksCount,
      outlinksCount: page.outlinksCount,
      links: [],
      images: [],
      imagesTotal: 0,
      imagesWithAlt: 0,
      hasSsl: page.url.startsWith('https://'),
      redirectHops: 0,
      hasSchemaOrg: snapshot.schemaTypes.length > 0,
      schemaTypes: snapshot.schemaTypes,
      first100Words: snapshot.excerpt.split(' ').slice(0, 100).join(' '),
      hasAuthor: snapshot.hasAuthor,
      hasPublicationDate: snapshot.hasPublicationDate,
      externalAuthoritativeLinksCount: snapshot.externalAuthoritativeLinksCount,
      bodyText: snapshot.excerpt,
      editorialSignals: snapshot.signals,
      roleSignals: snapshot.roleSignals,
      roleOverride,
      goalOverride,
      keywordResearch: this.parseJson<{ keywords?: KeywordResearch }>(page.aiEvaluationRaw)?.keywords,
      querySetOverride: this.parseJson<{ querySetOverride?: string[] }>(page.metricsRaw)?.querySetOverride
    };
  }
}
