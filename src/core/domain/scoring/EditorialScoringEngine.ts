import { EditorialEvaluation, Issue, RawPageData } from '../types';

export class EditorialScoringEngine {
  public static calculate(
    page: RawPageData,
    aiEvaluation?: EditorialEvaluation
  ): { score: number; issues: Issue[]; evaluation?: EditorialEvaluation } {
    const issues: Issue[] = [];

    // Pénalité bloquante : 4xx/5xx ou noindex = score 0 immédiat
    if (page.httpStatus >= 400 || !page.isIndexable) {
      issues.push({
        id: `edito-blocked-${page.path}`,
        pillar: 'EDITORIAL',
        severity: 'CRITICAL',
        code: 'EDITORIAL_BLOCKED_STATUS',
        title: 'Évaluation éditoriale annulée (Page non indexable ou en erreur HTTP)',
        description: `La page renvoie le code HTTP ${page.httpStatus} ou comporte une directive noindex. L'évaluation sémantique est bloquée.`,
        recommendation: 'Rendez la page accessible en HTTP 200 et indexable pour permettre l’analyse sémantique.',
        stepsToResolve: [
          'Corriger le code de statut HTTP pour obtenir un code 200 OK.',
          'Retirer la balise <meta name="robots" content="noindex"> si la page doit être référencée.'
        ],
        affectedUrl: page.url
      });

      return { score: 0, issues };
    }

    // Si pas encore d'évaluation IA (ex: avant phase 2), calcul d'une pré-évaluation heuristique basée sur le DOM
    const evalData: EditorialEvaluation = aiEvaluation ?? this.generateHeuristicEvaluation(page);

    let totalScore =
      evalData.intentMatch.score +
      evalData.cannibalizationRisk.score +
      evalData.hotZonesOptimization.score +
      evalData.primaryContentTldr.score +
      evalData.semanticDepth.score +
      evalData.eeatSignals.score +
      evalData.readability.score;

    totalScore = Math.min(100, Math.max(0, totalScore));

    // Génération des anomalies éditoriales si critères dégradés
    if (evalData.intentMatch.score < 15) {
      issues.push({
        id: `edito-intent-${page.path}`,
        pillar: 'EDITORIAL',
        severity: 'WARNING',
        code: 'INTENT_MISMATCH',
        title: 'Intention de recherche imparfaitement ciblée',
        description: evalData.intentMatch.critique,
        recommendation: evalData.intentMatch.actionableAdvice,
        stepsToResolve: [
          `Adapter le contenu à l'intention dominante détectée (${evalData.intentMatch.detectedIntent}).`,
          'Supprimer les développements hors sujet et apporter la réponse dès le premier tiers.'
        ],
        affectedUrl: page.url
      });
    }

    if (evalData.cannibalizationRisk.score < 15) {
      issues.push({
        id: `edito-cannibal-${page.path}`,
        pillar: 'EDITORIAL',
        severity: 'WARNING',
        code: 'CANNIBALIZATION_RISK',
        title: 'Risque de cannibalisation sémantique',
        description: evalData.cannibalizationRisk.critique,
        recommendation: evalData.cannibalizationRisk.actionableAdvice,
        stepsToResolve: [
          'Différencier l’angle d’attaque de cette page vis-à-vis des pages concurrentes du site.',
          'Faire pointer un lien canonique ou contextuel vers la page maîtresse.'
        ],
        affectedUrl: page.url
      });
    }

    if (evalData.hotZonesOptimization.score < 10) {
      issues.push({
        id: `edito-hotzones-${page.path}`,
        pillar: 'EDITORIAL',
        severity: 'WARNING',
        code: 'HOT_ZONES_UNOPTIMIZED',
        title: 'Sous-optimisation des zones chaudes',
        description: 'Le mot-clé principal est absent de plusieurs zones clés (Title, H1, slug ou 100 premiers mots).',
        recommendation: evalData.hotZonesOptimization.actionableAdvice,
        stepsToResolve: [
          'Placer la thématique principale au début du Title et du H1.',
          'Insérer le sujet phare dès le premier paragraphe.'
        ],
        affectedUrl: page.url
      });
    }

    if (evalData.primaryContentTldr.score < 10) {
      issues.push({
        id: `edito-tldr-${page.path}`,
        pillar: 'EDITORIAL',
        severity: 'WARNING',
        code: 'MISSING_TLDR_SUMMARY',
        title: 'Absence de réponse directe d’entrée (TL;DR)',
        description: evalData.primaryContentTldr.critique,
        recommendation: evalData.primaryContentTldr.actionableAdvice,
        stepsToResolve: [
          'Ajouter un bloc de résumé exécutif "Ce qu’il faut retenir" sous le titre H1.',
          'Fournir une réponse synthétique de 2 à 3 phrases aux questions de l’internaute.'
        ],
        affectedUrl: page.url
      });
    }

    if (evalData.eeatSignals.score < 6) {
      issues.push({
        id: `edito-eeat-${page.path}`,
        pillar: 'EDITORIAL',
        severity: 'INFO',
        code: 'LOW_EEAT_SIGNALS',
        title: 'Signaux d’autorité et d’expertise faibles (E-E-A-T)',
        description: 'La page manque d’éléments de réassurance (auteur identifié, date de révision, sources).',
        recommendation: evalData.eeatSignals.actionableAdvice,
        stepsToResolve: [
          'Insérer une bio d’auteur avec photo, fonction et lien vers profil vérifié.',
          'Afficher la date de publication et la date de dernière mise à jour.'
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

  private static generateHeuristicEvaluation(page: RawPageData): EditorialEvaluation {
    const hasWordCount = page.wordCount >= 300;
    const hasTitle = (page.title?.length ?? 0) > 10;
    const hasH1 = (page.h1?.length ?? 0) > 5;

    return {
      intentMatch: {
        detectedIntent: 'INFORMATIONAL',
        score: hasWordCount ? 16 : 8,
        critique: hasWordCount
          ? 'Le contenu apporte un volume textuel adéquat pour satisfaire une recherche d’information.'
          : 'Le contenu est trop succinct pour répondre en profondeur aux attentes de l’internaute.',
        actionableAdvice: 'Enrichir le traitement du sujet avec des exemples concrets et des cas d’usage.'
      },
      cannibalizationRisk: {
        score: 18,
        competingConcepts: [],
        critique: 'Aucun conflit sémantique direct majeur détecté avec d’autres sections.',
        actionableAdvice: 'Maintenir une ligne éditoriale claire et distincte pour cette typologie de page.'
      },
      hotZonesOptimization: {
        score: (hasTitle ? 5 : 0) + (hasH1 ? 5 : 0) + (page.first100Words.length > 50 ? 4 : 0),
        titleKeywordPresent: hasTitle,
        h1KeywordPresent: hasH1,
        first100WordsKeywordPresent: page.first100Words.length > 50,
        actionableAdvice: 'Insérer la requête exacte dans les 100 premiers mots pour capter l’attention immédiate.'
      },
      primaryContentTldr: {
        score: page.headings.length >= 2 ? 12 : 6,
        hasDirectAnswer: page.headings.length >= 2,
        critique: 'La structure textuelle permet de dégager rapidement les points cardinaux.',
        actionableAdvice: 'Ajouter un encart de synthèse visuel dès le haut de la page.'
      },
      semanticDepth: {
        score: page.wordCount > 600 ? 14 : 9,
        recognizedEntities: ['SEO', 'Optimisation', 'Web'],
        missingKeyEntities: ['Citations', 'Knowledge Graph'],
        actionableAdvice: 'Développer le champ lexical avec des notions techniques précises.'
      },
      eeatSignals: {
        score: (page.hasAuthor ? 5 : 0) + (page.hasPublicationDate ? 3 : 0) + 1,
        hasAuthor: page.hasAuthor,
        hasPublicationDate: page.hasPublicationDate,
        hasSources: false,
        actionableAdvice: 'Ajouter une signature d’auteur et la mention de date de mise à jour.'
      },
      readability: {
        score: 4,
        critique: 'Paragraphes aérés et lecture mobile fluide.',
        actionableAdvice: 'Multiplier les puces d’énumération pour faciliter la lecture rapide.'
      },
      quickWins: [
        'Ajouter une signature d’expert avec photo et profil.',
        'Ajouter un résumé exécutif en tête d’article.',
        'Ajuster la présence du mot-clé dans les 100 premiers mots.'
      ]
    };
  }
}
