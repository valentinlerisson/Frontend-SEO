import { createHash } from 'crypto';
import type { Page } from '@prisma/client';
import { prisma } from '@/adapters/secondary/database/prisma';
import { GoogleAutocomplete } from '@/adapters/secondary/search-data/google-autocomplete';
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
import { createSerpProvider } from '@/adapters/secondary/serp/create-serp-provider';
import { SerpBlockedError, type SerpProviderPort } from '../ports/serp-provider';
import { buildSerpAnalysis } from '../domain/scoring/serp-analysis';
import { classifyPageRole, hubChildKind, resolvePageRole } from '../domain/scoring/page-role';
import {
  brandVariants,
  filterRelevantSuggestions,
  isSameQuery,
  isUsableSeed,
  normalizeText,
  stripBrand
} from '../domain/scoring/autocomplete-relevance';
import { buildSiteCoherenceIssues, DETERMINISTIC_SITE_CODES } from '../domain/scoring/site-coherence';
import {
  betterMeasuredTarget,
  chooseTargetQuery,
  containsBrand,
  sanitizeCandidates,
  serpQueriesFor
} from '../domain/scoring/query-candidates';
import {
  BacklinkReport,
  EditorialEvaluation,
  GeoEvaluation,
  Issue,
  EditorialSignals,
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

/** Requête cible d'une page lors de l'audit précédent, reprise au suivant */
type PreviousQuery = { query: string; manual: boolean; basisHash: string; candidates?: QueryCandidate[] };

export class AuditService {
  /** Pages explorées au plus (liens puis pages du sitemap non reliées) ; variable CRAWL_MAX_PAGES */
  private static readonly MAX_CRAWL_PAGES = Math.max(10, Number(process.env.CRAWL_MAX_PAGES) || 150);
  /** Profondeur suivie : au-delà de 3, la profondeur de clic est réellement mesurée (4 et 5 clics pénalisés) */
  private static readonly MAX_CRAWL_DEPTH = 6;
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
  private static serpJobRunning = false;
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
  public static async launchAudit(rawInput: string) {
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
          const previousMetrics = this.parseJson<{ content?: ContentSnapshot; keptCandidates?: QueryCandidate[] }>(
            previous.metricsRaw
          );
          previousQueries.set(key, {
            query: previous.targetQuery,
            manual: previous.targetQuerySource === 'MANUAL',
            basisHash: this.queryBasisHash(previous.title, previous.h1, previousMetrics?.content?.headings ?? []),
            candidates: previousMetrics?.keptCandidates
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

    // 2. Créer le nouvel audit unique
    const audit = await prisma.audit.create({
      data: {
        projectId: project.id,
        status: 'CRAWLING_TECH',
        progress: 10,
        crawlStartedAt: new Date()
      }
    });

    // 3. Exécuter le crawl et le calcul des scores (en arrière-plan asynchrone)
    this.runCrawlPipeline(audit.id, url, serpHistoryByUrl, previousQueries, previousBacklinks).catch((err) => {
      console.error('Erreur crawl pipeline:', err);
      prisma.audit.update({
        where: { id: audit.id },
        data: {
          status: 'FAILED',
          errorMessage: err?.message || 'Erreur inconnue lors du crawl'
        }
      }).catch(console.error);
    });

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
    previousBacklinks: BacklinkReport | null = null
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

    // Étape B : Crawl réel par suivi des liens internes depuis la racine
    const crawledPages: RawPageData[] = await SiteCrawler.crawlSite(originUrl, {
      maxPages: this.MAX_CRAWL_PAGES,
      maxDepth: this.MAX_CRAWL_DEPTH,
      robots: domainMeta.robots,
      sitemapUrls,
      onProgress: async (crawled, maxPages) => {
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
            ...(keptCandidates ? { keptCandidates } : {}),
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
        pillarPagesCount: pillarPageIds.length
      }
    });

    this.runEditorialAnalysis(auditId).catch((err) => {
      console.error('Erreur analyse éditoriale:', err);
      prisma.audit
        .update({
          where: { id: auditId },
          data: { status: 'FAILED', errorMessage: err?.message || 'Erreur inconnue lors de l’analyse IA' }
        })
        .catch(console.error);
    });

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
      keptQuery?: string;
      keptCandidates?: QueryCandidate[];
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
    const raw = this.toRawPage(page, snapshot, metrics?.roleOverride);
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

    // Requêtes génériques (sans la marque) pour toutes les pages, sauf contact et pages utilitaires : on y cherche
    // le site par son nom, l'IA déduit alors une requête de marque comme avant
    const brands = brandVariants(domain);
    const genericQueries = role !== 'contact' && role !== 'utility';
    let candidates: QueryCandidate[] = metrics?.keptCandidates ?? [];
    // Requête déduite conservée (analyse précédente sur le même contenu) : l'IA ne la redéduit pas. Une requête
    // déduite avant les candidates (souvent la marque) n'est pas reprise : elle est remplacée par une candidate
    const fixedQuery =
      manualQuery || !metrics?.keptQuery
        ? undefined
        : !genericQueries || (candidates.length > 0 && !containsBrand(metrics.keptQuery, brands))
          ? metrics.keptQuery
          : undefined;
    // Version du prompt et modèle dans la clé : un changement de barème ou de modèle relance l'analyse
    const hashFor = (kept: string | undefined) =>
      this.sha256(`${page.contentHash ?? ''}|${manualQuery ?? ''}|${kept ?? ''}|${llmGateway.cacheKey()}`);

    if (
      !options.force &&
      page.analyzedHash === hashFor(fixedQuery) &&
      stored?.editorial?.search?.analyzedBy.engine === 'LLM'
    ) {
      return;
    }

    let evaluation: EditorialEvaluation | undefined;
    let error: string | undefined;
    const blocked = page.httpStatus >= 400 || !page.isIndexable;

    if (!blocked) {
      if (!llmGateway.isConfigured()) {
        error = 'Aucun fournisseur IA configuré (LLM_BASE_URL + LLM_MODEL, ou GEMINI_API_KEY) : analyse heuristique locale utilisée.';
      } else {
        try {
          if (genericQueries && candidates.length === 0) {
            candidates = await this.proposeCandidates(page, domain, role, snapshot, brands, pillars);
          }
          // Requête cible : la première candidate que Google suggère, sinon la première proposée par l'IA
          const chosenQuery = manualQuery || fixedQuery ? undefined : chooseTargetQuery(candidates)?.query;
          const suggestions = await this.fetchSuggestionsFor(page, domain, manualQuery ?? fixedQuery ?? chosenQuery, role);
          evaluation = await llmGateway.evaluateEditorial({
            url: page.url,
            domain,
            role,
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
      evaluation.search.targetQuery.isBrand = !genericQueries || containsBrand(query, brands);
      if (candidates.length > 0) evaluation.search.candidates = candidates;
    }

    const result = EditorialScoringEngine.calculate(raw, evaluation, stored?.serp);
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
                ...(candidates.length > 0 ? { keptCandidates: candidates } : {})
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
  ): Promise<string[]> {
    if (!targetQuery && (role === 'contact' || role === 'brand' || role === 'utility')) return [];

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

    const candidates = Array.from(
      new Set(
        [
          targetQuery?.trim().toLowerCase(),
          page.targetQuerySource === 'AUTO' && page.targetQuery ? clean(page.targetQuery) : undefined,
          ...segments(page.title),
          ...segments(page.h1)
        ]
          .filter((seed): seed is string => Boolean(seed))
          // La requête cible (saisie, conservée ou choisie) est toujours tentée ; les autres doivent être exploitables
          .filter((seed, index) => (index === 0 && Boolean(targetQuery)) || isUsableSeed(seed))
          .map((seed) => seed.split(' ').slice(0, 6).join(' '))
      )
    ).slice(0, 3);

    for (const seed of candidates) {
      const relevant = filterRelevantSuggestions(seed, await GoogleAutocomplete.fetchSuggestions(seed));
      if (relevant.length >= 3) return relevant;
    }
    return [];
  }

  /**
   * Requêtes candidates d'une page : proposées par l'IA, nettoyées par le code (marque, doublons, rubriques), puis
   * vérifiées une à une dans Google Autocomplete. Échec de l'IA : liste vide, l'analyse déduit alors la requête.
   */
  private static async proposeCandidates(
    page: Page,
    domain: string,
    role: PageRole,
    snapshot: ContentSnapshot,
    brands: string[],
    pillars: Page[]
  ): Promise<QueryCandidate[]> {
    try {
      const proposals = await llmGateway.proposeQueries({
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
          .map((p) => ({ url: p.url, title: p.title ?? undefined, h1: p.h1 ?? undefined }))
      });
      const candidates = sanitizeCandidates(proposals, brands);
      for (const candidate of candidates) {
        const suggestions = await GoogleAutocomplete.fetchExact(candidate.query);
        candidate.suggestedByGoogle = suggestions.some((suggestion) => isSameQuery(candidate.query, suggestion));
      }
      return candidates;
    } catch (err: any) {
      console.warn(`[AuditService] Requêtes candidates indisponibles pour ${page.url} : ${err?.message ?? err}`);
      return [];
    }
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
      if (history.some((entry) => entry.date === done.fetchedAt && entry.query === done.query)) continue;
      history.push({
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
   * sections, intention des résultats. Retourne `started: false` si une analyse est déjà en cours.
   */
  public static async startSerpAnalysis(
    auditId: string,
    pageIds: string[],
    options: { queries?: Record<string, string>; provider?: SerpProviderPort } = {}
  ): Promise<{ started: boolean; reason?: string; pages: number }> {
    const provider = options.provider ?? createSerpProvider();
    const queries = options.queries ?? {};
    const audit = await prisma.audit.findUnique({ where: { id: auditId }, include: { project: true } });
    if (!audit) throw new Error('Audit introuvable');
    if (!['AWAITING_AI_SELECTION', 'ANALYZING_AI', 'COMPLETED'].includes(audit.status)) {
      throw new Error('Le crawl n’est pas terminé');
    }
    if (this.serpJobRunning) {
      return { started: false, reason: 'Une analyse SERP est déjà en cours.', pages: 0 };
    }

    // Toute page explorée, indexable et accessible peut être mesurée : piliers ou non
    let pages = await prisma.page.findMany({
      where: { auditId, id: { in: pageIds }, httpStatus: { lt: 400 }, isIndexable: true }
    });
    if (pages.length === 0) throw new Error('Aucune page analysable pour la SERP');

    // Requêtes saisies par l'utilisateur : manuelles, conservées pour la page (et ses analyses futures)
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

    this.serpJobRunning = true;
    for (const page of pages) {
      const list = this.serpQueriesOf(page);
      await this.saveSerp(
        page,
        this.emptySerp(list[0], 'RUNNING'),
        list.map((query) => this.emptySerp(query, 'RUNNING'))
      );
    }

    this.runSerpJob(pages, audit.project.domain, provider)
      .catch((err) => console.error('[AuditService] Analyse SERP interrompue :', err))
      .finally(() => {
        this.serpJobRunning = false;
      });

    return { started: true, pages: pages.length };
  }

  private static emptySerp(query: string, status: SerpAnalysis['status'], message?: string): SerpAnalysis {
    return {
      status,
      ...(message ? { message } : {}),
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
   * Requêtes mesurées pour une page : la requête cible d'abord, puis les candidates (suggérées par Google d'abord),
   * 3 au plus. Une requête déduite d'une page locale reçoit la ville, sinon la position dépend du lieu de la machine ;
   * une requête saisie par l'utilisateur est envoyée telle quelle.
   */
  private static serpQueriesOf(page: Page): string[] {
    const editorial = this.parseJson<{ editorial?: EditorialEvaluation }>(page.aiEvaluationRaw)?.editorial;
    const candidates =
      editorial?.search?.candidates ??
      this.parseJson<{ keptCandidates?: QueryCandidate[] }>(page.metricsRaw)?.keptCandidates ??
      [];
    const local = editorial?.search?.local;
    const withCity = (query: string) =>
      !local?.isLocalBusiness || !local.city || normalizeText(query).includes(normalizeText(local.city))
        ? query
        : `${query} ${local.city}`;
    const target = (page.targetQuery || page.h1 || page.title || '').trim();
    const first = page.targetQuerySource === 'MANUAL' ? target : withCity(target);
    return serpQueriesFor(first, candidates).map((query, index) => (index === 0 ? query : withCity(query)));
  }

  private static async runSerpJob(pages: Page[], domain: string, provider: SerpProviderPort) {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 4000 + Math.random() * 4000));
    const rankOf = (serp: SerpAnalysis) => serp.pagePosition ?? serp.pageSitelinkOf ?? null;
    let searches = 0;

    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const queries = this.serpQueriesOf(page);
      const metrics = this.parseJson<{ content?: ContentSnapshot }>(page.metricsRaw);
      const ourText = `${(metrics?.content?.headings ?? []).map((h) => h.text).join(' ')} ${metrics?.content?.excerpt ?? ''}`;
      const history = this.parseJson<{ serpHistory?: SerpHistoryEntry[] }>(page.aiEvaluationRaw)?.serpHistory ?? [];
      const analyses: SerpAnalysis[] = queries.map((query) => this.emptySerp(query, 'RUNNING'));

      for (let q = 0; q < queries.length; q++) {
        const query = queries[q];
        try {
          if (!query) throw new Error('Aucune requête cible pour cette page');
          if (searches++ > 0) await pause();
          const brandQuery = brandVariants(domain).some((brand) => normalizeText(query).includes(brand));

          // Mesure : première page de Google ; si la page n'y est pas (hors requête de marque), pages 2 et 3, pour voir
          // les positions 11 à 30, celles où un effort éditorial rapporte le plus. Les concurrents ne sont lus que pour
          // la requête cible (écarts de sections du pilier éditorial).
          const measure = async (fresh: boolean) => {
            const first = await provider.search(query, { domain, fresh });
            let results = first.results;
            const quick = buildSerpAnalysis({ query, fetchedAt: '', results, domain, pageUrl: page.url, competitors: [], ourText: '' });
            if (!brandQuery && rankOf(quick) === null) {
              await pause();
              const deeper = await provider.search(query, { domain, pages: 2, start: 1, fresh });
              results = [...results, ...deeper.results];
            }
            const competitors = q === 0 ? await this.readCompetitors(results, domain) : [];
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
            .filter((entry) => entry.query === query && (entry.provider ?? 'browser') === provider.id)
            .at(-1);
          if (previous) {
            const before = previous.pagePosition ?? previous.sitelinkOf ?? null;
            const now = rankOf(analysis);
            const moved = before === null || now === null ? before !== now : Math.abs(before - now) > 3;
            if (moved) {
              await pause();
              const retest = await measure(true);
              analysis = { ...retest, provider: provider.id, retest: { firstRank: now, previousRank: before } };
            }
          }
          analyses[q] = analysis;
          await this.saveSerp(page, analyses[0], analyses);
        } catch (err: any) {
          const blocked = err instanceof SerpBlockedError;
          analyses[q] = this.emptySerp(query, blocked ? 'BLOCKED' : 'ERROR', err?.message ?? 'Erreur inconnue');
          console.error(`[AuditService] SERP en échec pour « ${query} » : ${err?.message ?? err}`);
          if (blocked) {
            // Captcha : inutile d'insister sur les requêtes suivantes, de cette page comme des autres
            const cancelled = 'Annulée : captcha ou blocage sur une requête précédente';
            for (let rest = q + 1; rest < queries.length; rest++) analyses[rest] = this.emptySerp(queries[rest], 'ERROR', cancelled);
            await this.saveSerp(page, analyses[0], analyses);
            for (const other of pages.slice(index + 1)) {
              const list = this.serpQueriesOf(other);
              await this.saveSerp(
                other,
                this.emptySerp(list[0], 'ERROR', cancelled),
                list.map((query) => this.emptySerp(query, 'ERROR', cancelled))
              );
            }
            return;
          }
          await this.saveSerp(page, analyses[0], analyses);
        }
      }

      await this.switchToMeasuredQuery(page.id, domain, analyses);
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
    if (role) metrics.roleOverride = role;
    else delete metrics.roleOverride;
    const updated = await prisma.page.update({ where: { id: pageId }, data: { metricsRaw: JSON.stringify(metrics) } });

    await this.rescoreEditorial(updated);

    const audit = await prisma.audit.findUnique({ where: { id: auditId } });
    if (audit?.status === 'COMPLETED') {
      await this.refreshSiteCoherence(auditId, false);
      await this.finalizeAudit(auditId);
    }
  }

  /**
   * Recalcule le score éditorial d'un pilier déjà analysé à partir de l'évaluation enregistrée, sans appel à l'IA :
   * après une correction du rôle, ou quand une mesure Google (SERP) remplace une estimation.
   */
  private static async rescoreEditorial(page: Page) {
    const stored = this.parseJson<{ editorial?: EditorialEvaluation; serp?: SerpAnalysis; geo?: GeoEvaluation }>(page.aiEvaluationRaw);
    const metrics = this.parseJson<{ content?: ContentSnapshot; roleOverride?: PageRole }>(page.metricsRaw);
    if (!page.isPillar || !stored?.editorial || !metrics?.content) return;

    const raw = this.toRawPage(page, metrics.content, metrics.roleOverride);
    const result = EditorialScoringEngine.calculate(raw, stored.editorial, stored.serp);
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
  private static toRawPage(page: Page, snapshot: ContentSnapshot, roleOverride?: PageRole): RawPageData {
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
      roleOverride
    };
  }
}
