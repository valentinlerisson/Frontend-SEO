import { EditorialEvaluation, GeoEvaluation } from '@/core/domain/types';

export interface LlmGatewayPort {
  evaluateEditorial(content: string, url: string): Promise<EditorialEvaluation>;
  evaluateGeo(content: string, url: string, domainMeta?: unknown): Promise<GeoEvaluation>;
}

export class LlmGatewayAdapter implements LlmGatewayPort {
  async evaluateEditorial(content: string, url: string): Promise<EditorialEvaluation> {
    return {
      intentMatch: {
        detectedIntent: 'INFORMATIONAL',
        score: 18,
        critique: "L'intention de recherche principale est bien ciblée.",
        actionableAdvice: 'Renforcer les exemples pratiques.'
      },
      cannibalizationRisk: {
        score: 19,
        competingConcepts: [],
        critique: 'Aucun risque majeur de cannibalisation identifié.',
        actionableAdvice: 'Maintenir la différenciation sémantique.'
      },
      hotZonesOptimization: {
        score: 13,
        titleKeywordPresent: true,
        h1KeywordPresent: true,
        first100WordsKeywordPresent: true,
        actionableAdvice: 'Placer la variante exacte en début de balise title.'
      },
      primaryContentTldr: {
        score: 13,
        hasDirectAnswer: true,
        critique: 'Présence d’un résumé direct en introduction.',
        actionableAdvice: 'Ajouter des puces clés dès le premier paragraphe.'
      },
      semanticDepth: {
        score: 12,
        recognizedEntities: ['SEO', 'Audit', 'Googlebot'],
        missingKeyEntities: ['Core Web Vitals'],
        actionableAdvice: 'Enrichir le champ lexical avec les concepts de performance.'
      },
      eeatSignals: {
        score: 8,
        hasAuthor: true,
        hasPublicationDate: true,
        hasSources: true,
        actionableAdvice: 'Ajouter un lien vers la biographie complète de l’auteur.'
      },
      readability: {
        score: 4,
        critique: 'Texte fluide et bien aéré.',
        actionableAdvice: 'Raccourcir les phrases de plus de 25 mots.'
      },
      quickWins: [
        'Ajouter un chapô synthétique de 40 mots.',
        'Insérer 2 liens internes vers les pages sœurs.'
      ]
    };
  }

  async evaluateGeo(content: string, url: string, domainMeta?: unknown): Promise<GeoEvaluation> {
    return {
      aiBotsAccessibility: {
        score: 25,
        gptBotAllowed: true,
        claudeBotAllowed: true,
        perplexityBotAllowed: true,
        critique: 'Aucun blocage des robots IA détecté dans robots.txt.',
        actionableAdvice: 'Conserver les directives ouvertes pour GPTBot et ClaudeBot.'
      },
      llmsTxtStandard: {
        score: 20,
        exists: Boolean(domainMeta),
        isValidFormat: Boolean(domainMeta),
        critique: 'Fichier /llms.txt présent et structuré.',
        actionableAdvice: 'Mettre à jour régulièrement les résumés des pages piliers.'
      },
      aiCitability: {
        score: 16,
        extractableBlocksCount: 5,
        hasDirectDefinitions: true,
        critique: 'Les définitions et tableaux sont facilement extractibles par les LLM.',
        actionableAdvice: 'Formater les définitions clés sous forme Question / Réponse directe.'
      },
      authoritySources: {
        score: 8,
        externalAuthoritativeLinksCount: 3,
        critique: 'Références externes crédibles identifiées.',
        actionableAdvice: 'Citer des sources scientifiques ou institutionnelles.'
      },
      schemaOrgLdJson: {
        score: 9,
        hasValidSchema: true,
        schemaTypes: ['WebSite', 'Article'],
        critique: 'Balisage JSON-LD présent et sans erreur de syntaxe.',
        actionableAdvice: 'Ajouter les propriétés author.sameAs et publisher.logo.'
      },
      napConsistency: {
        score: 8,
        detectedName: 'Big Happy',
        detectedAddress: 'Bordeaux, France',
        detectedPhone: '+33 5 00 00 00 00',
        isConsistent: true,
        actionableAdvice: 'Aligner le formatage du numéro de téléphone avec la fiche Google Business.'
      },
      llmReadinessSummary: 'Le site présente une bonne préparation aux moteurs de réponses génératives (Perplexity, ChatGPT Search).',
      quickWins: [
        'Standardiser les blocs FAQ en schéma JSON-LD FAQPage.',
        'Vérifier la cohérence NAP sur l’ensemble des pages de contact.'
      ]
    };
  }
}

export const llmGateway = new LlmGatewayAdapter();
