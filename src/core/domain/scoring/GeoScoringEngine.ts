import { GeoEvaluation, Issue, RawPageData } from '../types';
import { napMeasuredPoints, type NapPageResult } from './nap';
import { classifyPageRole, resolvePageRole } from './page-role';

/** Rôles pour lesquels la citabilité n'a pas de sens : rien à citer sur une page de contact ou de mentions légales */
const CITABILITY_EXEMPT_ROLES = ['contact', 'utility'];

/** Points GEO réellement mesurés : robots 15 + sources 5 + Schema.org 25, citabilité 40 si applicable, NAP 0 à 15 */
export function geoMeasuredPoints(geo: Pick<GeoEvaluation, 'aiCitability' | 'napConsistency'>): number {
  return 45 + (geo.aiCitability.applicable === false ? 0 : 40) + napMeasuredPoints(geo.napConsistency);
}

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
      /** Robots refusés par le serveur (pare-feu, CDN) malgré le robots.txt */
      firewallBlocked?: string[];
    },
    nap?: NapPageResult
  ): { score: number; issues: Issue[]; evaluation?: GeoEvaluation } {
    const issues: Issue[] = [];

    // Pénalité bloquante : 4xx/5xx ou noindex = score 0
    if (page.httpStatus >= 400 || !page.isIndexable) {
      // Erreur HTTP : l'anomalie technique HTTP_xxx suffit ; seule une page en noindex est signalée ici
      if (page.httpStatus < 400) issues.push({
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

    const baseEval: GeoEvaluation = aiEvaluation ?? this.generateHeuristicEvaluation(page, dMeta, nap);
    const role = resolvePageRole({
      manual: page.roleOverride,
      ai: baseEval.role,
      detected: classifyPageRole({
        path: page.path,
        depth: page.depth,
        hasPublicationDate: page.hasPublicationDate,
        wordCount: page.wordCount,
        schemaTypes: page.schemaTypes,
        ...page.roleSignals
      })
    }).role;
    const citabilityApplicable = !CITABILITY_EXEMPT_ROLES.includes(role);
    const evalData: GeoEvaluation = {
      ...baseEval,
      aiCitability: { ...baseEval.aiCitability, applicable: citabilityApplicable }
    };

    // Barème sur 100 : robots IA 15, citabilité 40, sources 5, Schema.org 25, NAP 15.
    // /llms.txt reste affiché mais hors score : aucun moteur n'a confirmé l'utiliser.
    let totalScore =
      evalData.aiBotsAccessibility.score +
      (citabilityApplicable ? evalData.aiCitability.score : 0) +
      evalData.authoritySources.score +
      evalData.schemaOrgLdJson.score +
      evalData.napConsistency.score;

    // Hors dénominateur : citabilité sans objet (contact, utilitaire : 40), points NAP non mesurables (15 ou 5)
    totalScore = (totalScore / geoMeasuredPoints(evalData)) * 100;

    totalScore = Math.min(100, Math.max(0, totalScore));

    // Détection des anomalies GEO
    if (evalData.aiBotsAccessibility.score < 15) {
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

    if (domainMeta?.firewallBlocked && domainMeta.firewallBlocked.length > 0 && page.depth === 0) {
      issues.push({
        id: `geo-firewall-${page.path}`,
        pillar: 'GEO',
        severity: 'INFO',
        code: 'AI_BOTS_POSSIBLY_FIREWALLED',
        title: `Robots IA peut-être bloqués par le serveur (${domainMeta.firewallBlocked.join(', ')})`,
        description:
          'La page d’accueil demandée avec le user-agent de ces robots est refusée. Le test vient d’une IP non officielle : un pare-feu peut refuser ce faux robot et laisser passer le vrai. Blocage probable, non avéré : aucun point retiré.',
        recommendation: 'Vérifier les règles du pare-feu ou du CDN pour les robots IA vérifiés.',
        stepsToResolve: [
          'Ouvrir les règles de sécurité du CDN (ex. Cloudflare > Sécurité > Robots).',
          'Autoriser les robots vérifiés GPTBot, ClaudeBot et PerplexityBot si vous voulez être cité par ces moteurs.'
        ],
        affectedUrl: page.url
      });
    }

    if (!evalData.llmsTxtStandard.exists) {
      issues.push({
        id: `geo-llmstxt-missing-${page.path}`,
        pillar: 'GEO',
        severity: 'INFO',
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

    // 28 pts : par exemple deux passages citables vérifiés, une définition et un fait chiffré
    if (citabilityApplicable && evalData.aiCitability.score < 28) {
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
          'Renseigner le schéma pertinent (Organization, Article, LocalBusiness ou FAQPage).',
          'Partir du balisage suggéré (tiroir d’inspection, onglet GEO, accordéon Schema.org & Cohérence NAP).'
        ],
        affectedUrl: page.url
      });
    }

    if (evalData.schemaOrgLdJson.hasValidSchema && evalData.schemaOrgLdJson.score < 25) {
      issues.push({
        id: `geo-schema-weak-${page.path}`,
        pillar: 'GEO',
        severity: 'WARNING',
        code: 'WEAK_SCHEMA_ORG',
        title: 'Données structurées sans entité décrite',
        description: evalData.schemaOrgLdJson.critique,
        recommendation: 'Décrire l’entité de la page en JSON-LD : Organization ou LocalBusiness, Article, Product ou Service.',
        stepsToResolve: [
          'Partir du balisage suggéré (tiroir d’inspection, onglet GEO, accordéon Schema.org & Cohérence NAP).',
          'Insérer le script JSON-LD dans le <head> de la page.'
        ],
        affectedUrl: page.url
      });
    }

    if (
      evalData.napConsistency.measured !== false &&
      // Contradiction sur la page, ou manque de coordonnées sur le site (signalé une seule fois, sur l'accueil)
      (!evalData.napConsistency.isConsistent || (evalData.napConsistency.score < 10 && evalData.napConsistency.reportMissing))
    ) {
      issues.push({
        id: `geo-nap-${page.path}`,
        pillar: 'GEO',
        // Contradiction avérée : avertissement ; simple absence de coordonnées sur la page : info
        severity: evalData.napConsistency.isConsistent ? 'INFO' : 'WARNING',
        // (manque de coordonnées sur le site : info ; contradiction sur la page : avertissement)
        code: 'NAP_INCONSISTENT',
        title: 'Coordonnées (nom, adresse, téléphone) incomplètes ou incohérentes',
        description: evalData.napConsistency.actionableAdvice,
        recommendation: 'Afficher les mêmes coordonnées partout et les déclarer en JSON-LD LocalBusiness ou Organization.',
        stepsToResolve: [
          'Afficher l’adresse et le téléphone dans le pied de page de toutes les pages.',
          'Reprendre exactement les mêmes valeurs dans le JSON-LD.'
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
      firewallBlocked?: string[];
    },
    nap?: NapPageResult
  ): GeoEvaluation {
    const gptPts = domainMeta.gptBotAllowed ? 6 : 0;
    const claudePts = domainMeta.claudeBotAllowed ? 6 : 0;
    const perplxPts = domainMeta.perplexityBotAllowed ? 3 : 0;
    const botScore = gptPts + claudePts + perplxPts;

    // Hors score : la présence de /llms.txt est seulement signalée
    const llmsScore = 0;
    const hasSchema = page.hasSchemaOrg;
    const schema = this.scoreSchema(page.hasSchemaOrg, page.schemaTypes);
    const citabilityPts = page.headings.length >= 3 ? 36 : 20;
    const authPts = page.externalAuthoritativeLinksCount >= 2 ? 5 : page.externalAuthoritativeLinksCount === 1 ? 3 : 1;

    return {
      aiBotsAccessibility: {
        score: botScore,
        gptBotAllowed: domainMeta.gptBotAllowed,
        claudeBotAllowed: domainMeta.claudeBotAllowed,
        perplexityBotAllowed: domainMeta.perplexityBotAllowed,
        critique:
          (botScore === 15
            ? 'Le robots.txt autorise les principaux crawleurs IA (GPTBot, ClaudeBot, PerplexityBot).'
            : 'Certains crawleurs IA majeurs sont interdits sur la page d’accueil par le robots.txt (groupe du robot ou groupe « * »).') +
          (domainMeta.firewallBlocked && domainMeta.firewallBlocked.length > 0
            ? ` Blocage probable par le serveur (pare-feu ou CDN) : ${domainMeta.firewallBlocked.join(', ')}, non vérifiable depuis une IP non officielle, sans perte de points.`
            : ''),
        actionableAdvice:
          domainMeta.firewallBlocked && domainMeta.firewallBlocked.length > 0
            ? 'Vérifier dans le pare-feu ou le CDN que les robots IA vérifiés sont autorisés (Cloudflare : réglage « Bloquer les robots IA »).'
            : 'Autoriser explicitement GPTBot, ClaudeBot et PerplexityBot dans robots.txt.'
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
        critique:
          'Estimation sans IA, d’après le nombre de sous-titres seulement : sélectionnez la page comme pilier pour une évaluation du contenu.',
        actionableAdvice: 'Ajouter des définitions courtes (40 mots) directement sous les titres H2.',
        source: 'HEURISTIC'
      },
      authoritySources: {
        score: authPts,
        externalAuthoritativeLinksCount: page.externalAuthoritativeLinksCount,
        critique: `${page.externalAuthoritativeLinksCount} source(s) externe(s) d’autorité identifiée(s).`,
        actionableAdvice: 'Citer au moins 2 sources factuelles externes (études officielles, livres blancs).'
      },
      schemaOrgLdJson: {
        score: schema.score,
        hasValidSchema: hasSchema,
        schemaTypes: page.schemaTypes,
        critique: hasSchema
          ? `${schema.critique} La validité du balisage n’est pas contrôlée ici.`
          : 'Aucune donnée structurée Schema.org détectée dans le HTML initial. Un balisage ajouté par JavaScript n’est pas visible de ce crawler : vérifiez-le avec le test des résultats enrichis de Google.',
        actionableAdvice: 'Intégrer le balisage JSON-LD Organization / FAQPage / Article.'
      },
      napConsistency: nap
        ? {
            score: nap.score,
            measured: nap.measured,
            consistencyMeasured: nap.consistencyMeasured,
            detectedName: nap.detectedName,
            detectedAddress: nap.detectedAddress,
            detectedPhone: nap.detectedPhone,
            isConsistent: nap.isConsistent,
            reportMissing: nap.reportMissing,
            actionableAdvice: nap.measured ? `${nap.critique} ${nap.advice}` : nap.advice
          }
        : {
            score: 0,
            measured: false,
            detectedName: null,
            detectedAddress: null,
            detectedPhone: null,
            isConsistent: false,
            actionableAdvice: 'Cohérence NAP non analysée.'
          },
      llmReadinessSummary:
        botScore === 15 && domainMeta.hasLlmsTxt
          ? 'Site prêt pour l’indexation générative (SearchGPT, Claude Search, Perplexity).'
          : 'Optimisations prioritaires requises sur le standard /llms.txt et l’autorisation des crawlers IA.',
      quickWins: [
        'Créer le fichier /llms.txt à la racine du domaine.',
        'Ajouter le balisage Schéma.org JSON-LD.',
        'Intégrer 2 liens vers des sources factuelles externes d’autorité.'
      ]
    };
  }

  /**
   * Schema.org noté selon ce qu'il décrit : une entité (organisation, établissement, article, produit, service,
   * personne…) vaut 25 pts ; des types génériques de structure (WebPage, WebSite, BreadcrumbList…) 10 pts ;
   * un balisage sans type (simple itemprop de thème) 5 pts.
   */
  public static scoreSchema(hasSchema: boolean, types: string[]): { score: number; critique: string } {
    if (!hasSchema) return { score: 0, critique: '' };
    const GENERIC = new Set([
      'webpage', 'website', 'breadcrumblist', 'listitem', 'itemlist', 'sitenavigationelement', 'wpheader', 'wpfooter',
      'wpsidebar', 'imageobject', 'searchaction', 'readaction', 'entrypoint', 'collectionpage', 'thing', 'creativework',
      'postaladdress', 'contactpoint', 'propertyvalue', 'aboutpage', 'contactpage'
    ]);
    const entities = types.filter((type) => !GENERIC.has(type.toLowerCase()));
    if (entities.length > 0) {
      return { score: 25, critique: `Entités décrites par des données structurées : ${entities.join(', ')}.` };
    }
    if (types.length > 0) {
      return {
        score: 10,
        critique: `Seulement des types génériques de structure (${types.join(', ')}) : aucune entité (organisation, établissement, article, produit) n’est décrite.`
      };
    }
    return {
      score: 5,
      critique: 'Balisage présent mais sans type Schema.org (propriétés isolées, souvent ajoutées par le thème) : il ne décrit aucune entité.'
    };
  }
}
