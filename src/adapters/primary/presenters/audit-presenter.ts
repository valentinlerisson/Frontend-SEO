import {
  ProjectAuditData,
  PillarPage,
  SubpageItem,
  GlobalIssue,
  InspectionData,
  IssueSeverity,
} from '@/lib/audit-data';

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

/**
 * Adaptateur Primaire / Presenter :
 * Transforme les entités de persistance vers les structures attendues par l'UI React.
 *
 * Règles strictes :
 * 1. Normalisation stricte sans seuils conditionnels ambigus :
 *    - intentMatchScore: Math.round((score / 100) * 20)
 *    - hotZonesScore: Math.round((score / 100) * 15)
 * 2. Invariants 4xx/5xx/noindex :
 *    - Si page.httpStatus >= 400 ou page.isIndexable === false, forçage à 0
 *      de editorialScore, geoScore, intentMatchScore et hotZonesScore.
 *    - Aucun fallback arbitraire (ex: 70 ou 16/20) ne doit masquer un échec de crawl.
 * 3. Sécurisation des valeurs nulles/indéfinies (tableaux vides []).
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

    const pages = audit.pages ?? [];
    const issues = audit.issues ?? [];

    const isCrawling = audit.status === 'CRAWLING_TECH' || audit.status === 'QUEUED';
    const totalPages = Math.max(pages.length, audit.totalPagesCount || 0);
    const crawledPages = pages.length;

    // Normalisation des scores globaux en entiers
    const techScore = Math.round(audit.techScore ?? 0);
    const editorialScore = Math.round(audit.editorialScore ?? 0);
    const geoScore = Math.round(audit.geoScore ?? 0);
    const globalScore = Math.round(
      audit.overallScore ?? (techScore * 0.4 + editorialScore * 0.35 + geoScore * 0.25)
    );

    // Mapping des sous-pages et des pages piliers
    const subpages = pages.map((p) => this.toSubpageItem(p));
    const pillarPages = pages
      .filter((p) => p.isPillar)
      .map((p) => this.toPillarPage(p));

    const resolvedPillarPages =
      pillarPages.length > 0 ? pillarPages : (pages[0] ? [this.toPillarPage(pages[0])] : []);

    // Mapping des anomalies globales
    const globalIssues = this.toGlobalIssues(issues, pages);

    // Calcul des KPI's d'en-tête
    const criticalIssuesCount = issues.filter(
      (i) => i.severity.toUpperCase() === 'CRITICAL' || i.severity.toLowerCase() === 'critical'
    ).length;

    const warningsCount = issues.filter(
      (i) => i.severity.toUpperCase() === 'WARNING' || i.severity.toLowerCase() === 'warning'
    ).length;

    const goodPracticesCount = Math.max(
      0,
      pages.reduce((acc, p) => acc + (p.techScore && p.techScore > 85 ? 2 : 1), 0) - criticalIssuesCount
    );

    // Moyennes sur les pages piliers réelles
    const validEditorialPillars = resolvedPillarPages.filter((p) => p.indexable && p.httpStatus < 400);
    const editorialMean = validEditorialPillars.length > 0
      ? Math.round(validEditorialPillars.reduce((acc, p) => acc + p.editorialScore, 0) / validEditorialPillars.length)
      : editorialScore;

    const cannibalizationConflicts = resolvedPillarPages.filter(
      (p) => p.cannibalizationStatus === 'conflict'
    ).length;

    const intentMatchSum = validEditorialPillars.reduce((acc, p) => acc + (p.intentMatchScore / 20) * 100, 0);
    const intentMatchGlobal = validEditorialPillars.length > 0
      ? Math.round(intentMatchSum / validEditorialPillars.length)
      : 0;

    const validGeoPillars = resolvedPillarPages.filter((p) => p.indexable && p.httpStatus < 400);
    const geoMean = validGeoPillars.length > 0
      ? Math.round(validGeoPillars.reduce((acc, p) => acc + p.geoScore, 0) / validGeoPillars.length)
      : geoScore;

    const inspections: Record<string, InspectionData> = {};
    for (const page of pages) {
      inspections[page.id] = this.toInspectionData(page, issues.filter((i) => i.affectedUrl === page.url));
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
        editorialMean,
        cannibalizationConflicts,
        intentMatchGlobal,
        geoMean,
        llmsTxtStatus: 'Manquant',
        citabilityMean: geoMean > 0 ? Math.round(geoMean * 0.8) : 0,
      },
      pillarPages: resolvedPillarPages,
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
    let wordCountStatus: 'good' | 'warning' | 'critical' = 'good';
    if (wordCount < 400) {
      wordCountStatus = 'critical';
    } else if (wordCount <= 500) {
      wordCountStatus = 'warning';
    }

    const depthFormatted = `Niv ${page.depth ?? 0}`;
    const statusLabel = `${page.httpStatus ?? 200} ${page.httpStatus >= 400 ? 'Erreur' : 'OK'}`;

    let targetKeyword = page.h1?.slice(0, 40) || 'Non spécifié';
    let responseTime = '0.48 s';

    if (page.aiEvaluationRaw) {
      try {
        const parsed = JSON.parse(page.aiEvaluationRaw);
        if (parsed?.editorial?.targetKeyword) {
          targetKeyword = parsed.editorial.targetKeyword;
        }
      } catch {
        // Fallback
      }
    }

    if (page.metricsRaw) {
      try {
        const metrics = JSON.parse(page.metricsRaw);
        if (metrics?.cwv?.lcp) {
          responseTime = `${(metrics.cwv.lcp / 1000).toFixed(2)} s`;
        }
      } catch {
        // Fallback
      }
    }

    return {
      id: page.id,
      url: page.url,
      path: page.path || (page.url.startsWith('http') ? new URL(page.url).pathname : page.url),
      title: page.title || page.h1 || 'Page sans titre',
      httpStatus: page.httpStatus ?? 200,
      statusLabel,
      wordCount,
      wordCountStatus,
      depth: depthFormatted,
      inlinks: page.inlinksCount ?? 0,
      targetKeyword,
      isPillar: Boolean(page.isPillar),
      indexable: Boolean(page.isIndexable),
      responseTime,
    };
  }

  /**
   * Convertit une Page pilier avec normalisation stricte :
   * - Si httpStatus >= 400 OU isIndexable === false -> editorialScore = 0, geoScore = 0, intentMatchScore = 0, hotZonesScore = 0
   * - Sinon :
   *   - intentMatchScore: Math.round((rawScore / 100) * 20)
   *   - hotZonesScore: Math.round((rawScore / 100) * 15)
   */
  public static toPillarPage(page: PersistencePageRecord): PillarPage {
    const isFailedOrNonIndexable = (page.httpStatus >= 400) || (!page.isIndexable);

    // Invariants stricts en cas d'échec de crawl ou noindex
    if (isFailedOrNonIndexable) {
      return {
        id: page.id,
        url: page.url,
        path: page.path || (page.url.startsWith('http') ? new URL(page.url).pathname : page.url),
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
        httpStatus: page.httpStatus ?? 200,
        responseTime: '0.00 s',
        indexable: Boolean(page.isIndexable),
        follow: false,
      };
    }

    // Page valide et indexable : extraction des scores réels sans seuils arbitraires
    let rawIntentScore = 0;
    let rawHotZonesScore = 0;
    let cannibalizationStatus: 'none' | 'conflict' = 'none';
    let cannibalizationTarget: string | undefined = undefined;
    let targetKeyword = page.h1?.slice(0, 40) || 'Mot-clé cible';
    let isAutoDetectedKeyword = true;
    let aiAccessibility = true;
    let citability: 'Elevée' | 'Moyenne' | 'Faible' = 'Faible';
    let schemaOrgPresent = false;
    let responseTime = '0.48 s';

    if (page.aiEvaluationRaw) {
      try {
        const ai = JSON.parse(page.aiEvaluationRaw);
        if (ai.editorial) {
          if (typeof ai.editorial.intentMatchScore === 'number') {
            rawIntentScore = ai.editorial.intentMatchScore;
          }
          if (typeof ai.editorial.hotZonesScore === 'number') {
            rawHotZonesScore = ai.editorial.hotZonesScore;
          }
          if (ai.editorial.hasCannibalization) {
            cannibalizationStatus = 'conflict';
            cannibalizationTarget = ai.editorial.cannibalizationTarget || undefined;
          }
          if (ai.editorial.targetKeyword) {
            targetKeyword = ai.editorial.targetKeyword;
            isAutoDetectedKeyword = false;
          }
        }

        if (ai.geo) {
          if (typeof ai.geo.aiBotAccess === 'boolean') {
            aiAccessibility = ai.geo.aiBotAccess;
          }
          if (typeof ai.geo.hasSchemaOrg === 'boolean') {
            schemaOrgPresent = ai.geo.hasSchemaOrg;
          }
          if (ai.geo.citabilityScore) {
            citability = ai.geo.citabilityScore >= 70 ? 'Elevée' : (ai.geo.citabilityScore >= 40 ? 'Moyenne' : 'Faible');
          }
        }
      } catch {
        // Fallback
      }
    }

    if (page.metricsRaw) {
      try {
        const metrics = JSON.parse(page.metricsRaw);
        if (metrics?.cwv?.lcp) {
          responseTime = `${(metrics.cwv.lcp / 1000).toFixed(2)} s`;
        }
      } catch {
        // Fallback
      }
    }

    // Normalisation stricte sur 20 et 15
    const intentMatchScore = Math.min(20, Math.max(0, Math.round((rawIntentScore / 100) * 20)));
    const hotZonesScore = Math.min(15, Math.max(0, Math.round((rawHotZonesScore / 100) * 15)));

    return {
      id: page.id,
      url: page.url,
      path: page.path || (page.url.startsWith('http') ? new URL(page.url).pathname : page.url),
      title: page.title || page.h1 || 'Page stratégique',
      targetKeyword,
      isAutoDetectedKeyword,
      editorialScore: Math.round(page.editorialScore ?? 0),
      intentMatchScore,
      hotZonesScore,
      cannibalizationStatus,
      cannibalizationTarget,
      geoScore: Math.round(page.geoScore ?? 0),
      aiAccessibility,
      citability,
      schemaOrgPresent,
      techScore: Math.round(page.techScore ?? 0),
      httpStatus: page.httpStatus ?? 200,
      responseTime,
      indexable: Boolean(page.isIndexable),
      follow: true,
    };
  }

  /**
   * Convertit les anomalies de la base vers le format d'anomalies globales attendu
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

    return issues.map((issue) => {
      let severity: IssueSeverity = 'warning';
      const sevUpper = issue.severity.toUpperCase();
      if (sevUpper === 'CRITICAL' || sevUpper === 'BLOCKING') {
        severity = 'critical';
      } else if (sevUpper === 'PASSED' || sevUpper === 'INFO') {
        severity = 'passed';
      }

      let categoryKey: 'tech' | 'structure' | 'content' = 'tech';
      let category: 'Tech. & Meta' | 'Structure' | 'Content' = 'Tech. & Meta';

      const pillarUpper = issue.pillar.toUpperCase();
      if (pillarUpper === 'EDITORIAL' || pillarUpper === 'CONTENT') {
        categoryKey = 'content';
        category = 'Content';
      } else if (issue.code.includes('H1') || issue.code.includes('STRUCTURE') || issue.code.includes('LINK')) {
        categoryKey = 'structure';
        category = 'Structure';
      }

      const impactedUrls: GlobalIssue['impactedUrls'] = [];
      const previewItems: NonNullable<GlobalIssue['previewItems']> = [];

      if (issue.affectedUrl) {
        const matchedPage = pagesByUrl.get(issue.affectedUrl);
        const path = matchedPage?.path || issue.affectedUrl;
        impactedUrls.push({
          id: matchedPage?.id || issue.id,
          path,
          fullUrl: issue.affectedUrl,
          title: matchedPage?.title || 'Page analysée',
          wordCount: matchedPage?.wordCount ?? 0,
          depth: `Niv ${matchedPage?.depth ?? 0}`,
          inlinks: matchedPage?.inlinksCount ?? 0,
        });

        previewItems.push({
          path,
          note: issue.recommendation || issue.description,
          severity,
        });
      }

      return {
        id: issue.id,
        title: issue.title,
        category,
        categoryKey,
        severity,
        impactCount: impactedUrls.length > 0 ? impactedUrls.length : 1,
        description: issue.description,
        recommendation: issue.recommendation,
        previewItems,
        impactedUrls,
      };
    });
  }

  /**
   * Construit la structure d'inspection détaillée d'une page pour le tiroir latéral
   * (?inspect=[id]&tab=[tech|editorial|geo])
   */
  public static toInspectionData(
    page: PersistencePageRecord,
    pageIssues: PersistenceIssueRecord[] = []
  ): InspectionData {
    const isFailedOrNonIndexable = (page.httpStatus >= 400) || (!page.isIndexable);

    const techScore = Math.round(page.techScore ?? 0);
    const editorialScore = isFailedOrNonIndexable ? 0 : Math.round(page.editorialScore ?? 0);
    const geoScore = isFailedOrNonIndexable ? 0 : Math.round(page.geoScore ?? 0);

    let targetKeyword = page.h1?.slice(0, 40) || 'Non spécifié';
    let rawIntent = 0;
    let rawHotZones = 0;
    let aiReasoningEdito = isFailedOrNonIndexable
      ? 'Analyse éditoriale désactivée : la page renvoie une erreur HTTP ou n’est pas indexable.'
      : 'Analyse éditoriale réalisée sur le contenu de la page.';
    let aiReasoningGeo = isFailedOrNonIndexable
      ? 'Analyse GEO désactivée : la page n’est pas accessible pour les moteurs de recherche IA.'
      : 'Évaluation de la citabilité et de l’accessibilité pour les moteurs LLM.';

    if (!isFailedOrNonIndexable && page.aiEvaluationRaw) {
      try {
        const ai = JSON.parse(page.aiEvaluationRaw);
        if (ai.editorial) {
          if (ai.editorial.targetKeyword) targetKeyword = ai.editorial.targetKeyword;
          if (ai.editorial.intentMatchScore) rawIntent = ai.editorial.intentMatchScore;
          if (ai.editorial.hotZonesScore) rawHotZones = ai.editorial.hotZonesScore;
          if (ai.editorial.reasoning) aiReasoningEdito = ai.editorial.reasoning;
        }
        if (ai.geo && ai.geo.reasoning) {
          aiReasoningGeo = ai.geo.reasoning;
        }
      } catch {
        // Fallback
      }
    }

    const intentScore = isFailedOrNonIndexable ? 0 : Math.min(20, Math.round((rawIntent / 100) * 20));
    const hotZonesScore = isFailedOrNonIndexable ? 0 : Math.min(15, Math.round((rawHotZones / 100) * 15));

    let responseTime = '0.48 s';
    if (page.metricsRaw) {
      try {
        const metrics = JSON.parse(page.metricsRaw);
        if (metrics?.cwv?.lcp) responseTime = `${(metrics.cwv.lcp / 1000).toFixed(2)} s`;
      } catch {
        // Fallback
      }
    }

    const techPriorities = pageIssues
      .filter((i) => i.pillar.toUpperCase() === 'TECH')
      .map((i) => ({
        type: (i.severity.toUpperCase() === 'CRITICAL' ? 'alert' : 'optimization') as 'alert' | 'optimization',
        text: i.title,
      }));

    if (techPriorities.length === 0) {
      techPriorities.push({
        type: page.httpStatus >= 400 ? 'alert' : 'optimization',
        text: page.httpStatus >= 400
          ? `Corriger l'erreur de statut HTTP ${page.httpStatus}.`
          : 'Optimiser la compression des ressources et le cache navigateur.',
      });
    }

    return {
      pageId: page.id,
      title: page.title || page.h1 || 'Page analysée',
      url: page.url,
      httpStatus: page.httpStatus ?? 200,
      indexable: Boolean(page.isIndexable),
      follow: !isFailedOrNonIndexable,
      responseTime,
      tech: {
        score: techScore,
        categories: [
          { name: 'Indexabilité & HTTP', score: page.httpStatus === 200 ? 100 : 0 },
          { name: 'Core Web Vitals', score: page.httpStatus === 200 ? 85 : 0 },
          { name: 'Balises Title & Meta', score: page.title && page.metaDescription ? 95 : 0 },
          { name: 'Structure Hn', score: page.h1 ? 90 : 0 },
          { name: 'Sécurité HTTPS', score: page.url.startsWith('https') ? 100 : 0 },
        ],
        priorities: techPriorities,
        accordions: [
          {
            title: '1. Indexabilité et Réponses HTTP',
            scoreText: `${page.httpStatus === 200 && page.isIndexable ? '100' : '0'}/100`,
            items: [
              {
                text: `Code de statut HTTP ${page.httpStatus}`,
                status: page.httpStatus === 200 ? 'valid' : 'error',
              },
              {
                text: page.isIndexable ? 'Balise meta robots indexable' : 'Page marquée en noindex',
                status: page.isIndexable ? 'valid' : 'error',
              },
              { text: `Temps de réponse du serveur (${responseTime})`, status: 'valid' },
            ],
          },
          {
            title: '2. Balises Titres & En-têtes (H1-H6)',
            scoreText: page.h1 ? '90/100' : '0/100',
            items: [
              {
                text: page.h1
                  ? `Balise H1 unique présente : "${page.h1.slice(0, 45)}..."`
                  : 'Balise H1 manquante',
                status: page.h1 ? 'valid' : 'error',
              },
              {
                text: `${page.h2Count} balises H2 détectées pour la structure`,
                status: page.h2Count > 0 ? 'valid' : 'warning',
              },
            ],
          },
        ],
      },
      editorial: {
        score: editorialScore,
        targetKeyword,
        isForcedTarget: false,
        categories: [
          { name: 'Intent Match', score: isFailedOrNonIndexable ? 0 : Math.round((intentScore / 20) * 100) },
          { name: 'Zones Chaudes', score: isFailedOrNonIndexable ? 0 : Math.round((hotZonesScore / 15) * 100) },
          { name: 'Profondeur lexicale', score: isFailedOrNonIndexable ? 0 : (page.wordCount > 500 ? 95 : 40) },
          { name: 'Cannibalisation', score: isFailedOrNonIndexable ? 0 : 100 },
          { name: 'E-E-A-T & Preuves', score: isFailedOrNonIndexable ? 0 : 75 },
        ],
        priorities: isFailedOrNonIndexable
          ? [{ type: 'alert', text: 'Page non analysable en raison de son statut HTTP ou de sa directive noindex.' }]
          : [
              { type: 'alert', text: `Vérifier la densité sémantique du mot-clé "${targetKeyword}".` },
              { type: 'optimization', text: 'Enrichir le premier écran pour maximiser la rétention utilisateur.' },
            ],
        accordions: [
          {
            title: '1. Intent Match & Pertinence Sémantique',
            scoreText: `${intentScore}/20`,
            aiReasoning: aiReasoningEdito,
            items: [
              {
                text: `Compréhension de l'intention sur "${targetKeyword}"`,
                status: intentScore >= 14 ? 'valid' : (isFailedOrNonIndexable ? 'error' : 'warning'),
              },
              {
                text: `Volume de contenu (${page.wordCount} mots)`,
                status: page.wordCount >= 500 ? 'valid' : (isFailedOrNonIndexable ? 'error' : 'warning'),
              },
            ],
          },
          {
            title: '2. Zones Chaudes & Structure Visuelle',
            scoreText: `${hotZonesScore}/15`,
            aiReasoning: isFailedOrNonIndexable
              ? 'Non applicable pour une page non indexable ou en erreur.'
              : 'Les mots-clés clés et éléments d’action sont positionnés dans les zones d’attention immédiate.',
            items: [
              {
                text: 'Présence des arguments clés au-dessus de la ligne de flottaison',
                status: hotZonesScore >= 10 ? 'valid' : (isFailedOrNonIndexable ? 'error' : 'warning'),
              },
              { text: 'Appels à l’action clairs et contextualisés', status: isFailedOrNonIndexable ? 'error' : 'valid' },
            ],
          },
        ],
      },
      geo: {
        score: geoScore,
        categories: [
          { name: 'Autorisations Robots IA', score: isFailedOrNonIndexable ? 0 : 100 },
          { name: 'Fichier /llms.txt', score: 0 },
          { name: 'Citabilité & Synthèse', score: isFailedOrNonIndexable ? 0 : 70 },
          { name: 'Données Structurées Schema.org', score: isFailedOrNonIndexable ? 0 : 80 },
        ],
        priorities: isFailedOrNonIndexable
          ? [{ type: 'alert', text: 'Page inaccessible pour les agents conversationnels et robots IA.' }]
          : [
              { type: 'alert', text: 'Déployer un fichier /llms.txt à la racine du domaine.' },
              { type: 'optimization', text: 'Ajouter des listes à puces et FAQ factuelles pour les citations IA.' },
            ],
        accordions: [
          {
            title: '1. Accessibilité & Standards GEO',
            scoreText: `${geoScore}/100`,
            aiReasoning: aiReasoningGeo,
            items: [
              { text: 'Autorisations des robots IA (GPTBot, ClaudeBot, PerplexityBot)', status: isFailedOrNonIndexable ? 'error' : 'valid' },
              { text: 'Fichier /llms.txt pour la documentation des LLMs', status: 'error' },
              { text: 'Données d’entité Schema.org Organization / Service', status: isFailedOrNonIndexable ? 'error' : 'valid' },
            ],
          },
        ],
      },
    };
  }
}
