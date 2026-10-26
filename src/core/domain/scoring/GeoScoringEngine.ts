import { GeoEvaluation, Issue, RawPageData } from '../types';

export class GeoScoringEngine {
  public static calculate(
    page: RawPageData,
    aiEvaluation?: GeoEvaluation,
    domainMeta?: {
      gptBotAllowed: boolean;
      claudeBotAllowed: boolean;
      perplexityBotAllowed: boolean;
      hasLlmsTxt: boolean;
      llmsTxtValid: boolean;
    }
  ): { score: number; issues: Issue[]; evaluation?: GeoEvaluation } {
    const issues: Issue[] = [];

    // Pénalité bloquante : 4xx/5xx ou noindex = score 0
    if (page.httpStatus >= 400 || !page.isIndexable) {
      issues.push({
        id: `geo-blocked-${page.path}`,
        pillar: 'GEO',
        severity: 'CRITICAL',
        code: 'GEO_BLOCKED_STATUS',
        title: 'Évaluation GEO impossible (Page non indexable ou en erreur)',
        description: `La page est non indexable ou renvoie un code HTTP ${page.httpStatus}. Les moteurs génératifs ignorent ce contenu.`,
        recommendation: 'Assurez-vous que l’URL est saine et accessible sans directive noindex.',
        stepsToResolve: [
          'Corriger le code HTTP pour servir la page en 200 OK.',
          'Retirer les directives de blocage pour les moteurs IA.'
        ],
        affectedUrl: page.url
      });

      return { score: 0, issues };
    }

    const dMeta = domainMeta ?? {
      gptBotAllowed: true,
      claudeBotAllowed: true,
      perplexityBotAllowed: true,
      hasLlmsTxt: false,
      llmsTxtValid: false
    };

    const evalData: GeoEvaluation = aiEvaluation ?? this.generateHeuristicEvaluation(page, dMeta);

    let totalScore =
      evalData.aiBotsAccessibility.score +
      evalData.llmsTxtStandard.score +
      evalData.aiCitability.score +
      evalData.authoritySources.score +
      evalData.schemaOrgLdJson.score +
      evalData.napConsistency.score;

    totalScore = Math.min(100, Math.max(0, totalScore));

    // Détection des anomalies GEO
    if (evalData.aiBotsAccessibility.score < 25) {
      const blocked: string[] = [];
      if (!evalData.aiBotsAccessibility.gptBotAllowed) blocked.push('GPTBot (SearchGPT)');
      if (!evalData.aiBotsAccessibility.claudeBotAllowed) blocked.push('ClaudeBot');
      if (!evalData.aiBotsAccessibility.perplexityBotAllowed) blocked.push('PerplexityBot');

      issues.push({
        id: `geo-robots-bots-${page.path}`,
        pillar: 'GEO',
        severity: 'CRITICAL',
        code: 'ROBOTS_TXT_BLOCKED_AI_BOTS',
        title: `Robots d’exploration IA bloqués (${blocked.join(', ')})`,
        description: evalData.aiBotsAccessibility.critique,
        recommendation: evalData.aiBotsAccessibility.actionableAdvice,
        stepsToResolve: [
          'Ouvrir robots.txt à la racine du domaine.',
          'Ajouter une directive Allow explicite pour GPTBot, ClaudeBot et PerplexityBot.'
        ],
        affectedUrl: page.url
      });
    }

    if (!evalData.llmsTxtStandard.exists) {
      issues.push({
        id: `geo-llmstxt-missing-${page.path}`,
        pillar: 'GEO',
        severity: 'WARNING',
        code: 'MISSING_LLMS_TXT',
        title: 'Fichier standard /llms.txt absent',
        description: evalData.llmsTxtStandard.critique,
        recommendation: evalData.llmsTxtStandard.actionableAdvice,
        stepsToResolve: [
          'Créer un fichier texte llms.txt à la racine du site (https://domaine.com/llms.txt).',
          'Rédiger une synthèse de votre proposition de valeur et lister les URLs de vos pages piliers.'
        ],
        affectedUrl: page.url
      });
    }

    if (evalData.aiCitability.score < 15) {
      issues.push({
        id: `geo-citability-${page.path}`,
        pillar: 'GEO',
        severity: 'WARNING',
        code: 'LOW_AI_CITABILITY',
        title: 'Citabilité et aptitude au Passage Ranking faibles',
        description: evalData.aiCitability.critique,
        recommendation: evalData.aiCitability.actionableAdvice,
        stepsToResolve: [
          'Structurer le contenu avec des sous-titres sous forme de questions directes.',
          'Rédiger des paragraphes de définition autonomes de 40 à 60 mots faciles à citer.',
          'Ajouter un tableau comparatif ou une liste ordonnée résumant les critères clés.'
        ],
        affectedUrl: page.url
      });
    }

    if (!evalData.schemaOrgLdJson.hasValidSchema) {
      issues.push({
        id: `geo-schema-${page.path}`,
        pillar: 'GEO',
        severity: 'WARNING',
        code: 'MISSING_SCHEMA_ORG_JSONLD',
        title: 'Balisage structuré Schéma.org JSON-LD absent',
        description: evalData.schemaOrgLdJson.critique,
        recommendation: evalData.schemaOrgLdJson.actionableAdvice,
        stepsToResolve: [
          'Insérer un script <script type="application/ld+json"> dans le <head>.',
          'Renseigner le schéma pertinent (Organization, Article, LocalBusiness ou FAQPage).'
        ],
        affectedUrl: page.url
      });
    }

    return {
      score: Math.round(totalScore),
      issues,
      evaluation: evalData
    };
  }

  private static generateHeuristicEvaluation(
    page: RawPageData,
    domainMeta: {
      gptBotAllowed: boolean;
      claudeBotAllowed: boolean;
      perplexityBotAllowed: boolean;
      hasLlmsTxt: boolean;
      llmsTxtValid: boolean;
    }
  ): GeoEvaluation {
    const gptPts = domainMeta.gptBotAllowed ? 10 : 0;
    const claudePts = domainMeta.claudeBotAllowed ? 10 : 0;
    const perplxPts = domainMeta.perplexityBotAllowed ? 5 : 0;
    const botScore = gptPts + claudePts + perplxPts;

    const llmsScore = domainMeta.hasLlmsTxt ? (domainMeta.llmsTxtValid ? 25 : 15) : 0;
    const hasSchema = page.hasSchemaOrg;
    const citabilityPts = page.headings.length >= 3 ? 18 : 10;
    const authPts = page.externalAuthoritativeLinksCount >= 2 ? 10 : page.externalAuthoritativeLinksCount === 1 ? 5 : 2;

    return {
      aiBotsAccessibility: {
        score: botScore,
        gptBotAllowed: domainMeta.gptBotAllowed,
        claudeBotAllowed: domainMeta.claudeBotAllowed,
        perplexityBotAllowed: domainMeta.perplexityBotAllowed,
        critique:
          botScore === 25
            ? 'Tous les principaux crawleurs IA (GPTBot, ClaudeBot, PerplexityBot) sont autorisés.'
            : 'Certains crawleurs IA majeurs sont bloqués dans robots.txt.',
        actionableAdvice: 'Autoriser explicitement GPTBot et ClaudeBot dans robots.txt.'
      },
      llmsTxtStandard: {
        score: llmsScore,
        exists: domainMeta.hasLlmsTxt,
        isValidFormat: domainMeta.llmsTxtValid,
        critique: domainMeta.hasLlmsTxt
          ? 'Fichier /llms.txt présent et accessible à la racine.'
          : 'Aucun fichier /llms.txt détecté. Les LLM doivent parser l’intégralité du DOM.',
        actionableAdvice: 'Déployer un fichier /llms.txt structuré en Markdown à la racine.'
      },
      aiCitability: {
        score: citabilityPts,
        extractableBlocksCount: Math.max(1, page.headings.length),
        hasDirectDefinitions: page.headings.length >= 2,
        critique: 'Le découpage du texte offre des prises d’extraction exploitables pour les réponses IA.',
        actionableAdvice: 'Ajouter des définitions courtes (40 mots) directement sous les titres H2.'
      },
      authoritySources: {
        score: authPts,
        externalAuthoritativeLinksCount: page.externalAuthoritativeLinksCount,
        critique: `${page.externalAuthoritativeLinksCount} source(s) externe(s) d’autorité identifiée(s).`,
        actionableAdvice: 'Citer au moins 2 sources factuelles externes (études officielles, livres blancs).'
      },
      schemaOrgLdJson: {
        score: hasSchema ? 10 : 0,
        hasValidSchema: hasSchema,
        schemaTypes: page.schemaTypes,
        critique: hasSchema
          ? `Microdonnées JSON-LD valides détectées (${page.schemaTypes.join(', ')}).`
          : 'Aucune donnée structurée JSON-LD Schéma.org détectée dans le document.',
        actionableAdvice: 'Intégrer le balisage JSON-LD Organization / FAQPage / Article.'
      },
      napConsistency: {
        score: 10,
        detectedName: 'Big Happy',
        detectedAddress: 'France',
        detectedPhone: null,
        isConsistent: true,
        actionableAdvice: 'Garantir la cohérence stricte des coordonnées dans le footer et les microdonnées.'
      },
      llmReadinessSummary:
        botScore === 25 && domainMeta.hasLlmsTxt
          ? 'Site prêt pour l’indexation générative (SearchGPT, Claude Search, Perplexity).'
          : 'Optimisations prioritaires requises sur le standard /llms.txt et l’autorisation des crawlers IA.',
      quickWins: [
        'Créer le fichier /llms.txt à la racine du domaine.',
        'Ajouter le balisage Schéma.org JSON-LD.',
        'Intégrer 2 liens vers des sources factuelles externes d’autorité.'
      ]
    };
  }
}
