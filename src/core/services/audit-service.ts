import { prisma } from '@/adapters/secondary/database/prisma';
import { SiteCrawler } from '@/adapters/secondary/crawler/site-crawler';
import { TechScoringEngine } from '../domain/scoring/TechScoringEngine';
import { EditorialScoringEngine } from '../domain/scoring/EditorialScoringEngine';
import { GeoScoringEngine } from '../domain/scoring/GeoScoringEngine';
import { GlobalScoringEngine } from '../domain/scoring/GlobalScoringEngine';
import { RawPageData } from '../domain/types';

export class AuditService {
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
    this.runCrawlPipeline(audit.id, url).catch((err) => {
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

  /**
   * Pipeline de crawl Phase 1 (Technique)
   */
  private static async runCrawlPipeline(auditId: string, originUrl: string) {
    // Étape A : Métadonnées du domaine (robots.txt, llms.txt)
    const domainMeta = await SiteCrawler.analyzeDomainMetadata(originUrl);

    await prisma.audit.update({
      where: { id: auditId },
      data: { progress: 30 }
    });

    // Étape B : URLs types à explorer
    const targetUrls = [
      originUrl,
      `${originUrl}/a-propos`,
      `${originUrl}/services`,
      `${originUrl}/contact`,
      `${originUrl}/blog`
    ];

    const crawledPages: RawPageData[] = [];

    for (let i = 0; i < targetUrls.length; i++) {
      const pageUrl = targetUrls[i];
      const pageData = await SiteCrawler.crawlPage(pageUrl, i === 0 ? 0 : 1, i === 0 ? 10 : 3);
      crawledPages.push(pageData);

      await prisma.audit.update({
        where: { id: auditId },
        data: { progress: 30 + Math.round(((i + 1) / targetUrls.length) * 40) }
      });
    }

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
      const geoRes = GeoScoringEngine.calculate(page, undefined, domainMeta);

      const pageScore = GlobalScoringEngine.computePageScore(
        techRes.score,
        editoRes.score,
        geoRes.score,
        isHomepage // Par défaut, la page d'accueil est pilier initial
      );

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
          metricsRaw: JSON.stringify({
            cwv: page.coreWebVitals,
            imagesTotal: page.imagesTotal,
            imagesWithAlt: page.imagesWithAlt,
            hasSsl: page.hasSsl
          }),
          aiEvaluationRaw: JSON.stringify({
            editorial: editoRes.evaluation,
            geo: geoRes.evaluation
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
        isPillar: p.isPillar
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
        overallScore: globalScores.overallScore
      }
    });
  }

  /**
   * Phase 2 : Validation des 10 à 20 pages piliers et analyse IA
   */
  public static async selectPillarsAndAnalyze(auditId: string, pillarPageIds: string[]) {
    // 1. Mettre à jour isPillar
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

    // 2. Passer au statut ANALYZING_AI
    await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'ANALYZING_AI',
        pillarPagesCount: pillarPageIds.length
      }
    });

    // 3. Finaliser en COMPLETED
    const pages = await prisma.page.findMany({ where: { auditId } });
    const globalScores = GlobalScoringEngine.computeProjectScore(
      pages.map((p) => ({
        techScore: p.techScore ?? 0,
        editorialScore: p.editorialScore ?? undefined,
        geoScore: p.geoScore ?? undefined,
        isPillar: p.isPillar
      }))
    );

    const completedAudit = await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        overallScore: globalScores.overallScore,
        techScore: globalScores.techAvg,
        editorialScore: globalScores.editorialAvg,
        geoScore: globalScores.geoAvg
      }
    });

    return completedAudit;
  }
}
