import { EditorialEvaluation, Issue, PageRole, RawPageData, SerpAnalysis } from '../types';
import { isSameQuery, normalizeText } from './autocomplete-relevance';
import { classifyPageRole, resolvePageRole } from './page-role';
import { measureHotZones } from './hot-zones';

export class EditorialScoringEngine {
  public static calculate(
    page: RawPageData,
    aiEvaluation?: EditorialEvaluation,
    /** Résultats Google mesurés pour la requête cible (onglet Positionnement) */
    serp?: SerpAnalysis
  ): { score: number; issues: Issue[]; evaluation?: EditorialEvaluation } {
    const issues: Issue[] = [];

    // Pénalité bloquante : 4xx/5xx ou noindex = score 0 immédiat
    if (page.httpStatus >= 400 || !page.isIndexable) {
      // Erreur HTTP : l'anomalie technique HTTP_xxx suffit ; seule une page en noindex est signalée ici
      if (page.httpStatus < 400) issues.push({
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
    const baseEval: EditorialEvaluation = aiEvaluation ?? this.generateHeuristicEvaluation(page);

    // Auteur, date et sources ne se demandent qu'à un article : pour les autres pages, le critère est
    // sans objet et sort du dénominateur (le score reste ramené sur 100)
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
    const eeatApplicable = role === 'article';
    const evalData = this.withMeasurements(baseEval, role, page, serp);

    // Requête déduite de la page sans confirmation dans Google : l'intention et les zones chaudes seraient jugées
    // par rapport à une requête taillée pour la page. Ces 35 points sortent du dénominateur.
    const queryConfirmed = evalData.search?.targetQuery.confidence !== 'INFERRED';
    let totalScore =
      (queryConfirmed ? evalData.intentMatch.score + evalData.hotZonesOptimization.score : 0) +
      evalData.cannibalizationRisk.score +
      evalData.primaryContentTldr.score +
      evalData.semanticDepth.score +
      (eeatApplicable ? evalData.eeatSignals.score : 0);
    // La lisibilité (evalData.readability) reste un diagnostic : elle n'entre pas dans le score
    const available = (eeatApplicable ? 100 : 90) - (queryConfirmed ? 0 : 35);
    totalScore = (totalScore / available) * 100;
    // Points réellement mesurés sur 100 : affichés, et poids de la page dans la moyenne du projet
    evalData.coverage = { measured: available, total: 100 };

    totalScore = Math.min(100, Math.max(0, totalScore));

    // Génération des anomalies éditoriales si critères dégradés
    if (queryConfirmed && evalData.intentMatch.score < 15) {
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

    // Une cannibalisation n'est signalée que si la page concurrente est identifiée : sinon rien d'actionnable
    const cannibal = evalData.cannibalizationRisk;
    if (cannibal.score < 15 && cannibal.competingUrl) {
      issues.push({
        id: `edito-cannibal-${page.path}`,
        pillar: 'EDITORIAL',
        severity: cannibal.score < 10 || cannibal.otherPageRanks ? 'WARNING' : 'INFO',
        code: 'CANNIBALIZATION_RISK',
        title: cannibal.otherPageRanks
          ? 'Google classe une autre page du site sur cette requête'
          : cannibal.score < 10
            ? 'Risque de cannibalisation sémantique'
            : 'Recoupement thématique partiel',
        description: `${cannibal.critique} Page concernée : ${cannibal.competingUrl}${cannibal.sharedQuery ? ` (requête commune : « ${cannibal.sharedQuery} »)` : ''}.${cannibal.source === 'SERP' ? ' Mesuré dans les résultats Google.' : " Estimation de l'IA, sans lecture de la SERP."}`,
        recommendation: evalData.cannibalizationRisk.actionableAdvice,
        stepsToResolve: [
          'Différencier l’angle d’attaque de cette page vis-à-vis des pages concurrentes du site.',
          'Faire pointer un lien canonique ou contextuel vers la page maîtresse.'
        ],
        affectedUrl: page.url
      });
    }

    if (queryConfirmed && evalData.hotZonesOptimization.score < 10) {
      issues.push({
        id: `edito-hotzones-${page.path}`,
        pillar: 'EDITORIAL',
        severity: 'WARNING',
        code: 'HOT_ZONES_UNOPTIMIZED',
        title: 'Sous-optimisation des zones chaudes',
        description: evalData.hotZonesOptimization.zones
          ? `Mots de la requête « ${evalData.search?.targetQuery.query ?? ''} » absents : ${[
              ['Title', evalData.hotZonesOptimization.zones.title.missing],
              ['100 premiers mots', evalData.hotZonesOptimization.zones.first100Words.missing],
              ['sous-titres H2/H3', evalData.hotZonesOptimization.zones.subheadings.missing]
            ]
              .filter(([, missing]) => (missing as string[]).length > 0)
              .map(([zone, missing]) => `${zone} (${(missing as string[]).join(', ')})`)
              .join(' ; ')}.`
          : 'Le mot-clé principal est absent de plusieurs zones clés (Title, début du contenu ou sous-titres).',
        recommendation: evalData.hotZonesOptimization.actionableAdvice,
        stepsToResolve: [
          'Placer la thématique principale au début du Title.',
          'Insérer le sujet phare dès le premier paragraphe et dans un sous-titre.'
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
        title: role === 'article' ? 'Absence de réponse directe d’entrée (TL;DR)' : 'Proposition de valeur peu claire en début de page',
        description: evalData.primaryContentTldr.critique,
        recommendation: evalData.primaryContentTldr.actionableAdvice,
        stepsToResolve:
          role === 'article'
            ? [
                'Ajouter un bloc de résumé exécutif "Ce qu’il faut retenir" sous le titre H1.',
                'Fournir une réponse synthétique de 2 à 3 phrases aux questions de l’internaute.'
              ]
            : [
                'Poser en tête de page ce que propose l’organisation, pour qui, et ce qui la distingue.',
                'Rendre l’action attendue (contact, devis, choix d’un établissement) visible dès l’arrivée.'
              ],
        affectedUrl: page.url
      });
    }

    if (evalData.semanticDepth.score < 12) {
      const missing = evalData.semanticDepth.missingKeyEntities;
      issues.push({
        id: `edito-semantic-${page.path}`,
        pillar: 'EDITORIAL',
        severity: 'WARNING',
        code: 'SEMANTIC_GAPS',
        title: 'Couverture du sujet incomplète',
        description: `Le contenu traite le sujet de façon partielle${missing.length > 0 ? ` : notions attendues absentes (${missing.join(', ')})` : ''}. Estimation de l'IA.`,
        recommendation: evalData.semanticDepth.actionableAdvice,
        stepsToResolve: [
          'Lister les questions que se pose l’internaute sur ce sujet et vérifier que la page y répond.',
          ...missing.slice(0, 3).map((entity) => `Traiter la notion : ${entity}`)
        ],
        affectedUrl: page.url
      });
    }

    if (eeatApplicable && evalData.eeatSignals.score < 6) {
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
          'Afficher la date de publication et la date de dernière mise à jour.',
          'Intégrer le balisage Schema.org suggéré (tiroir d’inspection, onglet GEO, accordéon Schema.org & Cohérence NAP).'
        ],
        affectedUrl: page.url
      });
    }

    // Module éditorial V1 : uniquement si l'analyse a produit des données de recherche
    const search = evalData.search;
    if (search) {
      if (search.snippet.score < 60) {
        issues.push({
          id: `edito-snippet-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'WARNING',
          code: 'WEAK_SNIPPET',
          title: 'Snippet SERP peu attractif (Title / méta description)',
          description: `${search.snippet.titleCritique} ${search.snippet.metaCritique}`.trim(),
          recommendation: 'Réécrire le Title et la méta description pour gagner en taux de clic.',
          stepsToResolve: [
            `Title suggéré : ${search.snippet.suggestedTitle}`,
            `Méta description suggérée : ${search.snippet.suggestedMeta}`
          ],
          affectedUrl: page.url
        });
      }

      if (search.local.isLocalBusiness && !search.local.hasLocalSignals) {
        issues.push({
          id: `edito-local-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'WARNING',
          code: 'MISSING_LOCAL_SIGNALS',
          title: 'Ancrage local absent',
          description: 'La page présente un établissement ou un service local mais aucune ville, adresse ou téléphone n’est visible.',
          recommendation: search.local.advice,
          stepsToResolve: [
            'Mentionner la ville et la zone d’intervention dans le Title, le H1 et l’introduction.',
            'Afficher l’adresse et le téléphone, et les déclarer en JSON-LD LocalBusiness.'
          ],
          affectedUrl: page.url
        });
      }

      // Une page de contact, de marque ou légale n'a pas à couvrir les sections des pages concurrentes
      const gapsApplicable = role !== 'contact' && role !== 'brand' && role !== 'utility';
      if (gapsApplicable && search.contentGaps.missingSections.length >= 3) {
        issues.push({
          id: `edito-gaps-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'CONTENT_GAPS',
          title: 'Sections attendues absentes (estimation IA)',
          description: `Sections probablement couvertes par les pages concurrentes : ${search.contentGaps.missingSections.join(', ')}.`,
          recommendation: 'Ajouter les sections manquantes pour rendre le sujet plus complet.',
          stepsToResolve: search.contentGaps.missingSections.map((section) => `Ajouter une section : ${section}`),
          affectedUrl: page.url
        });
      }
    }

    // Diagnostics éditoriaux (hors barème du score) : heuristiques objectives puis analyse LLM
    issues.push(...this.diagnosticIssues(page, evalData, role));

    return {
      score: Math.round(totalScore),
      issues,
      evaluation: evalData
    };
  }

  /**
   * Mesures qui priment sur le jugement de l'IA :
   * - cannibalisation : si les résultats Google de la requête cible ont été lus (hors requête de marque),
   *   deux pages du site = 10 pts, trois ou plus = 5 pts, une autre page classée à la place de celle-ci = 10 pts,
   *   seule cette page = 20 pts ; aucune page du site dans les résultats = non mesurable (estimation de l'IA conservée) ;
   * - confiance dans la requête cible : saisie, confirmée par Google (suggestions qui la reprennent, ou SERP
   *   mesurée sur cette requête) ou seulement déduite de la page.
   */
  private static withMeasurements(
    evaluation: EditorialEvaluation,
    role: PageRole,
    page: RawPageData,
    serp?: SerpAnalysis
  ): EditorialEvaluation {
    const pageUrl = page.url;
    const search = evaluation.search;
    // Relevé fait sur la requête cible (éventuellement complétée de la ville)
    const measuredSerp =
      serp && serp.status === 'DONE' && search && isSameQuery(search.targetQuery.query, serp.query) ? serp : undefined;

    let cannibalizationRisk = evaluation.cannibalizationRisk;
    // Requête de marque : repérée par le code à l'analyse (marque dans la requête, page de contact ou utilitaire) ;
    // analyses antérieures sans ce repère : règle par le rôle et l'intention
    const brandQuery =
      search?.targetQuery.isBrand ??
      (role === 'contact' || role === 'brand' || role === 'utility' || search?.targetQuery.intent === 'NAVIGATIONAL');
    if (measuredSerp && !brandQuery) {
      // Pages du site présentes dans les résultats, autres que celle-ci
      const key = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
      const others = measuredSerp.ownUrls.filter((own) => key(own.url) !== key(pageUrl));
      if (measuredSerp.ownUrls.length >= 2) {
        const competing = others[0] ?? measuredSerp.ownUrls[0];
        cannibalizationRisk = {
          ...cannibalizationRisk,
          // Deux pages peuvent coexister avec des intentions différentes : conflit partiel ; trois ou plus : dispersion
          score: measuredSerp.ownUrls.length >= 3 ? 5 : 10,
          source: 'SERP',
          competingUrl: competing?.url,
          sharedQuery: measuredSerp.query,
          critique: `${measuredSerp.ownUrls.length} pages du site sortent sur « ${measuredSerp.query} » : Google hésite entre elles.`,
          actionableAdvice:
            'Choisir la page qui doit se classer sur cette requête, et recentrer les autres sur une requête voisine avec un lien vers la page choisie.'
        };
      } else if (others.length === 1) {
        // La page auditée est absente, mais une autre page du site sort : Google la juge plus pertinente sur cette requête
        cannibalizationRisk = {
          ...cannibalizationRisk,
          score: 10,
          source: 'SERP',
          otherPageRanks: true,
          competingUrl: others[0].url,
          sharedQuery: measuredSerp.query,
          critique: `Sur « ${measuredSerp.query} », Google classe une autre page du site (position ${others[0].position}) et pas celle-ci.`,
          actionableAdvice:
            'Décider quelle page doit se classer : soit recentrer cette page sur une requête voisine, soit renforcer cette page et faire pointer l’autre vers elle avec une ancre explicite.'
        };
      } else if (measuredSerp.ownUrls.length === 1) {
        cannibalizationRisk = {
          ...cannibalizationRisk,
          score: 20,
          source: 'SERP',
          otherPageRanks: false,
          competingUrl: undefined,
          sharedQuery: undefined,
          critique: `Seule cette page du site sort sur « ${measuredSerp.query} » : pas de cannibalisation mesurée.`,
          actionableAdvice: ''
        };
      } else {
        // Aucune page du site dans les résultats lus : l'absence de conflit ne prouve rien, l'estimation de l'IA reste
        cannibalizationRisk = {
          ...cannibalizationRisk,
          critique: `${cannibalizationRisk.critique} Aucune page du site dans les ${measuredSerp.depth ?? measuredSerp.results.length} premiers résultats Google de « ${measuredSerp.query} » : cannibalisation non mesurable, estimation de l'IA conservée.`
        };
      }
    }

    if (!search) return { ...evaluation, cannibalizationRisk };
    // Confirmation indépendante de la page : la requête elle-même (ou quasi identique) est une suggestion Google,
    // ou la page sort réellement dans les résultats mesurés. Une recherche simplement lancée ne confirme rien.
    // Une page trouvée sur « requête + ville » ne confirme pas la requête sans ville : mesure exacte exigée
    const exactSerp =
      measuredSerp && normalizeText(measuredSerp.query) === normalizeText(search.targetQuery.query) ? measuredSerp : undefined;
    const pageFound = Boolean(exactSerp && (exactSerp.pagePosition !== null || exactSerp.pageSitelinkOf !== null));
    const suggested =
      search.targetQuery.suggestedByGoogle === true ||
      search.autocomplete.suggestions.some((suggestion) => isSameQuery(search.targetQuery.query, suggestion));
    const confidence: 'MANUAL' | 'CONFIRMED' | 'INFERRED' =
      search.targetQuery.source === 'MANUAL' ? 'MANUAL' : pageFound || suggested ? 'CONFIRMED' : 'INFERRED';

    // Zones chaudes mesurées par le code sur la requête cible : Title, 100 premiers mots, sous-titres H2/H3.
    // Le jugement de l'IA ne sert plus qu'au conseil (il variait jusqu'à 9 pts sur 15 d'une analyse à l'autre).
    const hot = measureHotZones(search.targetQuery.query, page);
    const hotZonesOptimization: EditorialEvaluation['hotZonesOptimization'] = {
      ...evaluation.hotZonesOptimization,
      score: hot.score,
      source: 'MEASURED',
      titleKeywordPresent: hot.title.missing.length === 0 && Boolean(page.title),
      first100WordsKeywordPresent: hot.first100Words.missing.length === 0,
      subheadingsKeywordPresent: hot.subheadings.missing.length === 0,
      zones: { title: hot.title, first100Words: hot.first100Words, subheadings: hot.subheadings }
    };
    return {
      ...evaluation,
      cannibalizationRisk,
      hotZonesOptimization,
      search: { ...search, targetQuery: { ...search.targetQuery, confidence } }
    };
  }

  /**
   * Anomalies de diagnostic éditorial, sans effet sur le score sur 100.
   * Heuristiques (page.editorialSignals) : fraîcheur, lisibilité mesurée, maillage dans le contenu.
   * Analyse LLM (evaluation.quality) : expérience vécue, gain d'information, réassurance.
   */
  private static diagnosticIssues(page: RawPageData, evaluation: EditorialEvaluation, role: PageRole): Issue[] {
    const issues: Issue[] = [];
    const signals = page.editorialSignals;

    if (signals) {
      const { freshness, readability, inContentLinks } = signals;

      if (signals.consentGated) {
        issues.push({
          id: `edito-consent-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'CONSENT_GATED_CONTENT',
          title: 'Contenu masqué tant que les cookies tiers ne sont pas acceptés',
          description:
            'Une partie du contenu (module, carte ou liste) n’est accessible qu’après acceptation de cookies de services externes. Ce contenu risque de ne pas être vu par les robots.',
          recommendation: 'Rendre ce contenu accessible sans consentement, ou fournir une alternative en texte.',
          stepsToResolve: [
            'Afficher la liste des éléments (par exemple les établissements) en HTML, sans dépendre d’un module tiers.',
            'Réserver le consentement aux seuls services qui en ont besoin (cartes, vidéos).'
          ],
          affectedUrl: page.url
        });
      }

      if (freshness.outdatedMentions.length > 0) {
        const years = Array.from(new Set(freshness.outdatedMentions.map((m) => m.year))).sort();
        const updateStatus = freshness.lastUpdated
          ? `Dernière mise à jour déclarée : ${freshness.lastUpdated.slice(0, 10)}.`
          : 'Aucune date de mise à jour déclarée sur la page.';
        issues.push({
          id: `edito-outdated-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'OUTDATED_YEAR_MENTIONS',
          title: `Années passées mentionnées (${years.join(', ')})`,
          description: `${freshness.outdatedMentions
            .slice(0, 3)
            .map((m) => `« …${m.excerpt}… »`)
            .join(' ')} ${updateStatus} Vérifiez que ces mentions sont toujours justes.`,
          recommendation: 'Mettre à jour les chiffres, projets ou dates devenus anciens, ou les contextualiser clairement.',
          stepsToResolve: [
            'Relire chaque extrait : une date historique légitime peut rester.',
            'Actualiser les statistiques et références de plus de deux ans.',
            'Afficher une mention « Mis à jour le … » après révision.'
          ],
          affectedUrl: page.url
        });
      }

      if (freshness.lastUpdated) {
        const ageYears = (Date.now() - new Date(freshness.lastUpdated).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears >= 2) {
          issues.push({
            id: `edito-stale-${page.path}`,
            pillar: 'EDITORIAL',
            severity: 'INFO',
            code: 'STALE_UPDATE_DATE',
            title: 'Date de mise à jour ancienne',
            description: `La dernière mise à jour déclarée date du ${freshness.lastUpdated.slice(0, 10)}, soit plus de deux ans.`,
            recommendation: 'Réviser le contenu puis mettre à jour la date de modification.',
            stepsToResolve: ['Relire et actualiser le contenu.', 'Mettre à jour la date de dernière modification (dateModified).'],
            affectedUrl: page.url
          });
        }
      }

      if (
        readability.paragraphCount >= 3 &&
        (readability.avgParagraphWords > 80 || readability.longParagraphs / readability.paragraphCount > 0.4)
      ) {
        issues.push({
          id: `edito-dense-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'DENSE_PARAGRAPHS',
          title: 'Paragraphes trop denses',
          description: `Longueur moyenne de ${readability.avgParagraphWords} mots par paragraphe, dont ${readability.longParagraphs} de plus de 100 mots sur ${readability.paragraphCount}.`,
          recommendation: 'Découper les blocs de texte en paragraphes de 3 à 4 lignes.',
          stepsToResolve: [
            'Scinder les paragraphes de plus de 100 mots.',
            'Mettre en gras les termes essentiels pour la lecture en diagonale.'
          ],
          affectedUrl: page.url
        });
      }

      if (readability.sentenceCount >= 10 && readability.longSentenceRatio > 0.35) {
        issues.push({
          id: `edito-sentences-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'LONG_SENTENCES',
          title: 'Phrases souvent trop longues',
          description: `${Math.round(readability.longSentenceRatio * 100)} % des phrases dépassent 25 mots.`,
          recommendation: 'Raccourcir les phrases pour faciliter la lecture sur mobile.',
          stepsToResolve: ['Couper les phrases de plus de 25 mots en deux.'],
          affectedUrl: page.url
        });
      }

      if (page.wordCount >= 600 && readability.listCount + readability.tableCount === 0) {
        issues.push({
          id: `edito-nolists-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'NO_LISTS_OR_TABLES',
          title: 'Aucune liste ni tableau dans un contenu long',
          description: `La page compte ${page.wordCount} mots sans liste à puces ni tableau.`,
          recommendation: 'Structurer les énumérations et comparaisons en listes ou en tableaux.',
          stepsToResolve: ['Transformer les énumérations en listes à puces.', 'Présenter les comparaisons sous forme de tableau.'],
          affectedUrl: page.url
        });
      }

      if (inContentLinks.genericAnchors > 0) {
        issues.push({
          id: `edito-anchors-${page.path}`,
          pillar: 'EDITORIAL',
          severity: inContentLinks.genericAnchors >= 3 ? 'WARNING' : 'INFO',
          code: 'GENERIC_ANCHORS',
          title: `${inContentLinks.genericAnchors} lien(s) du contenu avec une ancre générique`,
          description: `Sur ${inContentLinks.total} lien(s) présents dans le contenu principal, ${inContentLinks.genericAnchors} ont une ancre vide ou générique (« en savoir plus », « cliquez ici »…).`,
          recommendation: 'Remplacer ces ancres par un texte décrivant la page de destination.',
          stepsToResolve: [
            'Réécrire chaque ancre générique avec le sujet de la page ciblée.',
            'Éviter les liens dont le texte est vide ou limité à une image sans alt.'
          ],
          affectedUrl: page.url
        });
      }

      if (page.wordCount >= 500 && inContentLinks.internal === 0) {
        issues.push({
          id: `edito-nolinks-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'NO_CONTEXTUAL_LINKS',
          title: 'Aucun lien interne dans le contenu',
          description: 'Le contenu principal ne renvoie vers aucune autre page du site (hors menu et pied de page).',
          recommendation: 'Ajouter des liens contextuels vers les pages ou articles du même thème.',
          stepsToResolve: ['Ajouter 2 à 3 liens internes dans le corps du texte, avec des ancres descriptives.'],
          affectedUrl: page.url
        });
      }
    }

    const quality = evaluation.quality;
    if (quality) {
      if (!quality.firstHandExperience.detected && (role === 'article' || role === 'offer' || role === 'case')) {
        issues.push({
          id: `edito-experience-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'NO_FIRST_HAND_EXPERIENCE',
          title: 'Peu de preuves d’expérience vécue',
          description: 'Le texte reste surtout théorique : peu de retours de terrain, d’exemples vécus ou de formulations à la première personne.',
          recommendation: quality.firstHandExperience.advice,
          stepsToResolve: ['Ajouter un cas client ou un retour de terrain concret.', 'Raconter une situation réellement rencontrée, avec ses enseignements.'],
          affectedUrl: page.url
        });
      }

      if (quality.informationGain.level === 'LOW' && role !== 'contact' && role !== 'utility') {
        const fluff = quality.informationGain.genericFluff
          .slice(0, 2)
          .map((f) => `« ${f} »`)
          .join(', ');
        issues.push({
          id: `edito-infogain-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'GENERIC_CONTENT',
          title: 'Contenu peu original (indice IA)',
          description: `Peu d’éléments distinctifs détectés (données propres, cas concrets, avis tranchés).${fluff ? ` Passages génériques : ${fluff}.` : ''}`,
          recommendation: quality.informationGain.advice,
          stepsToResolve: ['Ajouter des chiffres ou une méthode propres à votre activité.', 'Remplacer les formules génériques par des faits précis.'],
          affectedUrl: page.url
        });
      }
    }

    return issues;
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
        score:
          (hasTitle ? 6 : 0) +
          (page.first100Words.length > 50 ? 5 : 0) +
          (page.headings.some((heading) => heading.level === 2) ? 4 : 0),
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
        score: page.wordCount > 600 ? 19 : 12,
        recognizedEntities: [],
        missingKeyEntities: [],
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
