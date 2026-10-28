import type { EditorialAccordion, InspectionData, InspectionItemData } from '@/lib/audit-data';
import type { EditorialEvaluation, EditorialSignals, PageRole, SearchIntent, SerpAnalysis } from '@/core/domain/types';
import { ROLE_LABEL } from '@/core/domain/scoring/page-role';
import { describePagePosition } from '@/lib/serp-labels';
import { detectSerpIntent } from '@/core/domain/scoring/serp-analysis';
import { filterRelevantSuggestions, normalizeText } from '@/core/domain/scoring/autocomplete-relevance';
import { detectIntentFromSuggestions } from '@/core/domain/scoring/intent-evidence';

/**
 * Suggestions Google qui reprennent les mots de la requête cible (3 au minimum) : filtre aussi les analyses
 * enregistrées avant ce tri, et recalcule l'intention qu'elles suggèrent.
 */
function relevantSearches(editorial: EditorialEvaluation) {
  const search = editorial.search;
  if (!search) return { suggestions: [] as string[], evidence: undefined };
  const kept = filterRelevantSuggestions(search.targetQuery.query, search.autocomplete.suggestions);
  if (kept.length < 3) return { suggestions: [] as string[], evidence: undefined };
  return { suggestions: kept, evidence: detectIntentFromSuggestions(kept) };
}
import {
  freshnessAccordion,
  inContentLinksAccordion,
  qualityAccordion,
  readabilityAccordion,
  unavailableAccordion,
} from './editorial-diagnostics';

type Editorial = InspectionData['editorial'];

export const INTENT_FR: Record<SearchIntent, string> = {
  INFORMATIONAL: 'informationnelle',
  COMMERCIAL: 'commerciale',
  TRANSACTIONAL: 'transactionnelle',
  NAVIGATIONAL: 'navigationnelle (recherche du site lui-même)',
};

/** Rôles dont la requête est une recherche de la marque : Google y montre normalement le site, pas une concurrence */
const BRAND_ROLES: PageRole[] = ['contact', 'brand', 'utility'];
/** Rôles sans sections attendues à comparer avec les concurrents */
const NO_GAP_ROLES: PageRole[] = ['contact', 'brand', 'utility'];

type Input = {
  editorial: EditorialEvaluation;
  role: PageRole;
  serp?: SerpAnalysis;
  signals?: EditorialSignals;
  page: { title?: string | null; metaDescription?: string | null; wordCount: number };
};

/** Points obtenus et constat en une phrase pour un critère noté */
function scored(
  title: string,
  earned: number,
  max: number,
  verdict: string,
  action: string | undefined,
  items: InspectionItemData[]
): EditorialAccordion {
  const value = Math.max(0, Math.min(max, Math.round(earned)));
  return {
    title,
    scoreText: `${value}/${max} pts`,
    aiReasoning: verdict,
    verdict,
    // Une action n'est proposée que s'il reste au moins un quart des points à gagner
    action: value < max * 0.75 && action ? action : undefined,
    points: { earned: value, max },
    group: 'scored',
    items,
  };
}

/** Critère noté mais exclu du score : la requête cible n'est pas confirmée dans Google */
function excluded(block: EditorialAccordion): EditorialAccordion {
  return {
    ...block,
    points: undefined,
    action: undefined,
    scoreText: 'Exclu du score',
    verdict: `${block.verdict ?? ''} Exclu du score : la requête a été déduite de la page sans être retrouvée dans Google, la juger serait biaisé. Saisissez la requête visée pour l’inclure.`.trim(),
  }
}

/** Diagnostic hors score : « RAS » ou nombre de points à revoir, même format partout */
function diagnostic(accordion: EditorialAccordion, title: string, action?: string): EditorialAccordion {
  const toFix = accordion.items.filter((item) => item.status === 'warning' || item.status === 'error').length;
  return {
    ...accordion,
    title,
    group: 'diagnostic',
    scoreText: accordion.scoreText === 'Non disponible' ? 'Non disponible' : toFix === 0 ? 'RAS' : `${toFix} à revoir`,
    verdict: accordion.aiReasoning,
    action: toFix > 0 ? action : undefined,
  };
}

function isBrandQuery(editorial: EditorialEvaluation, role: PageRole) {
  return (
    BRAND_ROLES.includes(role) ||
    editorial.intentMatch.detectedIntent === 'NAVIGATIONAL' ||
    editorial.search?.targetQuery.intent === 'NAVIGATIONAL'
  );
}

/** Intention de la page comparée à ce que montrent les recherches réelles (SERP, sinon Autocomplete) */
export function intentSummary(editorial: EditorialEvaluation, role: PageRole, serp?: SerpAnalysis): Editorial['intentSummary'] {
  const pageIntent = editorial.intentMatch.detectedIntent;
  if (isBrandQuery(editorial, role)) {
    return {
      page: pageIntent,
      verdict: 'Requête de marque : l’internaute cherche déjà votre site, la page doit surtout lui donner ce qu’il vient chercher.',
      status: 'info',
    };
  }
  // Recalculée depuis les résultats stockés : la règle de détection peut avoir évolué depuis la mesure
  const serpIntent = serp ? detectSerpIntent(serp.results).dominant : null;
  if (serpIntent) {
    const same = serpIntent === pageIntent;
    return {
      page: pageIntent,
      google: serpIntent,
      googleSource: 'serp',
      verdict: same
        ? `Les résultats Google confirment une intention ${INTENT_FR[pageIntent]}.`
        : `Google classe surtout des pages d’intention ${INTENT_FR[serpIntent]} : la page, d’intention ${INTENT_FR[pageIntent]}, risque de ne pas correspondre à ce qui est attendu.`,
      status: same ? 'valid' : 'warning',
    };
  }
  const { evidence } = relevantSearches(editorial);
  if (evidence?.dominant) {
    const same = evidence.dominant === pageIntent;
    return {
      page: pageIntent,
      google: evidence.dominant,
      googleSource: 'autocomplete',
      verdict: same
        ? `Les recherches suggérées par Google vont dans le même sens (intention ${INTENT_FR[pageIntent]}).`
        : `Les recherches suggérées par Google penchent vers une intention ${INTENT_FR[evidence.dominant]} : indice à confirmer avec l’onglet Positionnement.`,
      status: same ? 'valid' : 'info',
    };
  }
  return {
    page: pageIntent,
    verdict: 'Intention estimée par l’IA, sans vérification dans Google : lancez l’analyse dans l’onglet Positionnement pour la confirmer.',
    status: 'info',
  };
}

/** Position mesurée ; pour une requête de marque, une autre page du site en tête est normale */
export function positionSummary(editorial: EditorialEvaluation, role: PageRole, serp?: SerpAnalysis): Editorial['position'] {
  if (!serp) return undefined;
  const position = describePagePosition(serp);
  const brand = isBrandQuery(editorial, role);
  const measuredOn = serp.fetchedAt ? new Date(serp.fetchedAt).toLocaleDateString('fr-FR') : undefined;
  if (serp.pagePosition === null && serp.pageSitelinkOf === null && serp.ownPosition !== null && brand) {
    return {
      badge: position.badge,
      detail: `${position.detail} : normal pour une requête de marque, le site est bien trouvé`,
      status: 'info',
      measuredOn,
    };
  }
  return { badge: position.badge, detail: position.detail, status: position.rank === null ? 'warning' : 'valid', measuredOn };
}

/**
 * Blocs détaillés de l'onglet SEO éditorial, dans un ordre fixe (lib/issue-routing.ts y renvoie par indice) :
 * 0-5 critères notés, 6 ce que montre Google, 7-12 diagnostics hors score.
 */
export function buildEditorialSections({ editorial, role, serp, signals, page }: Input): EditorialAccordion[] {
  const search = editorial.search;
  const brand = isBrandQuery(editorial, role);
  const gapsApplicable = !NO_GAP_ROLES.includes(role);
  const query = search?.targetQuery.query;
  const isArticle = role === 'article';

  // 0. Intention
  const summary = intentSummary(editorial, role, serp);
  const intentItems: InspectionItemData[] = [
    {
      text: `Intention de la requête et de la page : ${INTENT_FR[editorial.intentMatch.detectedIntent]}`,
      status: 'info',
      source: 'ai',
    },
  ];
  if (summary?.google) {
    intentItems.push({
      text: summary.verdict,
      status: summary.status === 'warning' ? 'warning' : summary.status === 'valid' ? 'valid' : 'info',
      source: 'google',
    });
  }
  const { suggestions, evidence } = relevantSearches(editorial);
  if (!brand && evidence?.dominant && summary?.googleSource === 'serp') {
    intentItems.push({
      text: `Recherches suggérées : ${evidence.counts[evidence.dominant] ?? 0} sur ${evidence.total} d’intention ${INTENT_FR[evidence.dominant]} (ex. « ${evidence.examples.join(' », « ')} »)`,
      status: 'info',
      source: 'google',
    });
  }

  // 1. Cannibalisation
  const cannibal = editorial.cannibalizationRisk;
  const cannibalItems: InspectionItemData[] = [
    cannibal.source === 'SERP'
      ? {
          text: cannibal.competingUrl
            ? `Conflit mesuré avec ${cannibal.competingUrl} : les deux pages sortent sur « ${cannibal.sharedQuery} »`
            : 'Pas de cannibalisation mesurée : une seule page du site au plus sort sur la requête',
          status: !cannibal.competingUrl ? 'valid' : cannibal.score <= 5 ? 'error' : 'warning',
          source: 'google',
        }
      : cannibal.competingUrl
      ? {
          text: `${cannibal.score < 10 ? 'Conflit probable' : 'Recoupement partiel'} avec ${cannibal.competingUrl}${
            cannibal.sharedQuery ? ` (requête commune : « ${cannibal.sharedQuery} »)` : ''
          }`,
          status: cannibal.score < 10 ? 'warning' : 'info',
          source: 'ai',
        }
      : { text: 'Aucune autre page pilier ne vise la même requête', status: 'valid', source: 'ai' },
  ];
  if (serp && serp.ownUrls.length >= 2 && cannibal.source !== 'SERP') {
    cannibalItems.push({
      text: `${serp.ownUrls.length} pages du site sortent sur « ${serp.query} » : ${serp.ownUrls
        .map((own) => `n°${own.position} ${own.url}`)
        .join(' ; ')}${brand ? ' (fréquent pour une requête de marque)' : ''}`,
      status: brand ? 'info' : 'warning',
      source: 'google',
    });
  }

  // 2. Zones chaudes : Title 6 pts, début du contenu 5 pts, sous-titres 4 pts
  const hot = editorial.hotZonesOptimization;
  const zones = hot.zones
    ? [
        { label: 'le Title', points: hot.zones.title.points, max: 6, present: hot.zones.title.missing.length === 0, missing: hot.zones.title.missing },
        { label: 'les 100 premiers mots', points: hot.zones.first100Words.points, max: 5, present: hot.zones.first100Words.missing.length === 0, missing: hot.zones.first100Words.missing },
        { label: 'les sous-titres H2/H3', points: hot.zones.subheadings.points, max: 4, present: hot.zones.subheadings.missing.length === 0, missing: hot.zones.subheadings.missing },
      ]
    : [
        { label: 'le Title', points: undefined, max: 6, present: hot.titleKeywordPresent, missing: [] as string[] },
        { label: 'les 100 premiers mots', points: undefined, max: 5, present: hot.first100WordsKeywordPresent, missing: [] as string[] },
        ...(hot.subheadingsKeywordPresent !== undefined
          ? [{ label: 'un sous-titre H2 ou H3', points: undefined, max: 4, present: hot.subheadingsKeywordPresent, missing: [] as string[] }]
          : []),
      ];
  const missingZones = zones
    .filter((zone) => !zone.present)
    .map((zone) => (zone.missing.length > 0 ? `${zone.label} (manque : ${zone.missing.join(', ')})` : zone.label));
  const hotVerdict =
    missingZones.length === 0
      ? `La requête${query ? ` « ${query} »` : ''} est présente dans toutes les zones qui comptent.`
      : `Mots de la requête${query ? ` « ${query} »` : ''} absents de ${missingZones.join(', ')}.`;

  // 3. Réponse directe (article) ou proposition de valeur (autres pages)
  const tldr = editorial.primaryContentTldr;
  const tldrLabel = isArticle ? 'Réponse directe en introduction' : 'Proposition de valeur claire dès l’arrivée';

  // 4. Couverture du sujet
  const semantic = editorial.semanticDepth;
  const semanticItems: InspectionItemData[] = [];
  if (semantic.recognizedEntities.length > 0) {
    semanticItems.push({
      text: `${semantic.recognizedEntities.length} notion(s) du sujet bien traitée(s)`,
      status: 'valid',
      source: 'ai',
      details: semantic.recognizedEntities.map((entity) => ({ label: entity, status: 'valid' as const })),
    });
  }
  const missingNotions = Array.from(new Set([...semantic.missingKeyEntities, ...(search?.contentGaps.missingEntities ?? [])]));
  if (gapsApplicable) {
    for (const notion of missingNotions.slice(0, 5)) {
      semanticItems.push({ text: `Notion à envisager : ${notion}`, status: 'info', source: 'ai' });
    }
    // Sections estimées par l'IA, seulement quand la SERP n'a pas été lue (sinon : sections mesurées, bloc Google)
    if (!serp) {
      for (const section of search?.contentGaps.missingSections.slice(0, 4) ?? []) {
        semanticItems.push({ text: `Section à envisager : ${section}`, status: 'info', source: 'ai' });
      }
    }
  }
  if (semanticItems.length === 0) {
    semanticItems.push({ text: 'Aucun manque notable repéré', status: 'valid', source: 'ai' });
  }

  // 5. E-E-A-T (articles seulement)
  const eeat = editorial.eeatSignals;

  const queryInferred = search?.targetQuery.confidence === 'INFERRED';
  const maybeExcluded = (block: EditorialAccordion) => (queryInferred ? excluded(block) : block);
  const scoredBlocks: EditorialAccordion[] = [
    maybeExcluded(scored('Intention de recherche', editorial.intentMatch.score, 20, editorial.intentMatch.critique, editorial.intentMatch.actionableAdvice, intentItems)),
    scored('Cannibalisation', cannibal.score, 20, cannibal.critique, cannibal.actionableAdvice, cannibalItems),
    maybeExcluded(scored(
      'Requête dans les zones chaudes',
      hot.score,
      15,
      hotVerdict,
      hot.actionableAdvice,
      zones.map((zone) => ({
        text: `Requête dans ${zone.label} (${zone.points} pts)`,
        status: zone.present ? ('valid' as const) : ('error' as const),
        source: 'ai' as const,
      }))
    )),
    scored(isArticle ? 'Réponse directe' : 'Proposition de valeur', tldr.score, 15, tldr.critique, tldr.actionableAdvice, [
      { text: tldrLabel, status: tldr.hasDirectAnswer ? 'valid' : 'warning', source: 'ai' },
      {
        text: `${page.wordCount} mots sur la page (repère : Google n’impose pas de longueur minimale)`,
        status: 'info',
        source: 'measured',
      },
    ]),
    scored(
      'Couverture du sujet',
      semantic.score,
      20,
      semantic.score >= 15
        ? 'Le sujet est traité de façon complète pour une page de ce type.'
        : 'Le sujet est traité en partie : des notions attendues par l’internaute manquent.',
      semantic.actionableAdvice,
      semanticItems
    ),
    isArticle
      ? scored(
          'Auteur, date et sources (E-E-A-T)',
          eeat.score,
          10,
          eeat.score >= 8 ? 'L’article est signé, daté et sourcé.' : 'Il manque des éléments qui montrent qui écrit et sur quelles sources.',
          `${eeat.actionableAdvice} Le balisage Schema.org correspondant est proposé dans l’onglet GEO.`,
          [
            { text: 'Auteur identifié', status: eeat.hasAuthor ? 'valid' : 'error', source: 'measured' },
            { text: 'Date de publication ou de mise à jour visible', status: eeat.hasPublicationDate ? 'valid' : 'error', source: 'measured' },
            { text: 'Sources citées', status: eeat.hasSources ? 'valid' : 'warning', source: 'ai' },
          ]
        )
      : {
          title: 'Auteur, date et sources (E-E-A-T)',
          scoreText: 'Sans objet',
          aiReasoning: `Sans objet pour une page « ${ROLE_LABEL[role]} » : critère exclu du score.`,
          items: [],
          group: 'scored',
          hidden: true,
        },
  ];

  // 6. Ce que montre Google
  const googleItems: InspectionItemData[] = [];
  const position = positionSummary(editorial, role, serp);
  if (serp && position) {
    const otherQuery = query && normalizeText(query) !== normalizeText(serp.query);
    googleItems.push({
      text: `Position pour « ${serp.query} »${otherQuery ? ' (requête mesurée, ville ajoutée ou saisie différente de la requête cible)' : ''}${position.measuredOn ? ` (mesure du ${position.measuredOn}, ${serp.depth ?? serp.results.length} premiers résultats lus)` : ''} : ${position.detail}${
        serp.retest
          ? ` ; re-mesurée car elle s’écartait de plus de 3 rangs du relevé précédent (1re mesure : ${serp.retest.firstRank !== null ? `n°${serp.retest.firstRank}` : 'absente'}, avant : ${serp.retest.previousRank !== null ? `n°${serp.retest.previousRank}` : 'absente'})`
          : ''
      }`,
      status: position.status,
      source: 'google',
    });
    if (gapsApplicable && !brand) {
      for (const section of serp.gaps.missingSections.slice(0, 6)) {
        googleItems.push({ text: `Section traitée par les concurrents, absente ici : ${section}`, status: 'warning', source: 'google' });
      }
      if (serp.gaps.competitorAvgWords) {
        googleItems.push({
          text: `Les ${serp.competitors.length} premiers concurrents lus comptent en moyenne ${serp.gaps.competitorAvgWords} mots (cette page : ${page.wordCount}). Repère, pas un objectif.`,
          status: 'info',
          source: 'google',
        });
      }
    }
  }
  if (serp?.features) {
    if (serp.features.localPack) {
      googleItems.push({
        text: 'Google affiche un pack local (fiches d’établissements avec carte) sur cette requête : la fiche Google Business Profile compte autant que la page',
        status: 'info',
        source: 'google',
      });
    }
    if (serp.features.peopleAlsoAsk.length > 0) {
      googleItems.push({
        text: `${serp.features.peopleAlsoAsk.length} question(s) « Autres questions posées » : autant de sous-titres possibles`,
        status: 'info',
        source: 'google',
        details: serp.features.peopleAlsoAsk.map((question) => ({ label: question, status: 'valid' as const })),
      });
    }
  }
  if (!brand && suggestions.length >= 3) {
    googleItems.push({
      text: `${suggestions.length} recherches suggérées par Google autour de la requête`,
      status: 'info',
      source: 'google',
      details: suggestions.map((suggestion) => ({ label: suggestion, status: 'valid' as const })),
    });
  }
  if (googleItems.length === 0) {
    googleItems.push({
      text: brand
        ? 'Requête de marque : pas de comparaison avec des concurrents pour ce type de page'
        : 'Pas encore de mesure dans Google : lancez l’analyse de cette page dans l’onglet Positionnement',
      status: 'info',
    });
  }
  const googleBlock: EditorialAccordion = {
    title: 'Ce que montre Google',
    scoreText: position ? position.badge : suggestions.length >= 3 && !brand ? `${suggestions.length} recherches` : 'Non mesuré',
    aiReasoning: serp
      ? `Résultats Google réels lus pour la requête cible (${serp.depth ?? serp.results.length} premiers résultats organiques) : position, sections des pages concurrentes, pack local, questions, recherches suggérées.`
      : 'Recherches suggérées par Google Autocomplete. Les positions et sections concurrentes demandent l’analyse de l’onglet Positionnement.',
    verdict: serp
      ? 'Résultats Google réels lus pour la requête cible.'
      : 'Sans mesure de la SERP : seules les recherches suggérées sont disponibles.',
    action:
      serp && gapsApplicable && !brand && serp.gaps.missingSections.length > 0
        ? 'Ajouter les sections absentes qui servent l’internaute, sans copier les concurrents.'
        : undefined,
    group: 'google',
    items: googleItems,
  };

  // 7. Snippet (hors score)
  const titleLength = page.title?.length ?? 0;
  const metaLength = page.metaDescription?.length ?? 0;
  const snippetBlock: EditorialAccordion = search
    ? diagnostic(
        {
          title: '',
          scoreText: '',
          aiReasoning: `${search.snippet.titleCritique} ${search.snippet.metaCritique}`.trim(),
          items: [
            {
              text: `Title : ${titleLength} caractères (lisible en entier entre 45 et 60)`,
              status: !page.title ? 'error' : titleLength >= 45 && titleLength <= 60 ? 'valid' : 'warning',
              source: 'measured',
            },
            {
              text: `Méta description : ${metaLength} caractères (lisible en entier entre 130 et 155)`,
              status: !page.metaDescription ? 'error' : metaLength >= 130 && metaLength <= 155 ? 'valid' : 'warning',
              source: 'measured',
            },
            {
              text: `Attrait pour le clic : ${search.snippet.score}/100`,
              status: search.snippet.score >= 60 ? 'valid' : 'warning',
              source: 'ai',
            },
          ],
        },
        'Title et méta description (hors score)',
        'Reprendre le Title et la méta description suggérés en haut de l’onglet.'
      )
    : unavailableAccordion('Title et méta description (hors score)', 'Analyse IA indisponible pour cette page : relancez-la avec « Ré-analyser ».');

  // 8. Ancrage local (hors score)
  const localBlock: EditorialAccordion =
    search && search.local.isLocalBusiness
      ? diagnostic(
          {
            title: '',
            scoreText: '',
            aiReasoning: search.local.advice,
            items: [
              ...(search.local.city ? [{ text: `Ville repérée : ${search.local.city}`, status: 'valid' as const, source: 'ai' as const }] : []),
              {
                text: search.local.hasLocalSignals
                  ? 'Adresse, téléphone ou ville visible sur la page'
                  : 'Ni adresse, ni téléphone, ni ville visible sur la page',
                status: search.local.hasLocalSignals ? 'valid' : 'warning',
                source: 'ai',
              },
            ],
          },
          'Ancrage local (hors score)',
          search.local.advice
        )
      : { title: 'Ancrage local (hors score)', scoreText: 'Sans objet', aiReasoning: '', items: [], group: 'diagnostic', hidden: true };

  // 9-11. Diagnostics mesurés sur la page
  const staleReason = 'Donnée absente de cet audit : relancez l’audit pour la calculer.';
  const measured = signals
    ? [
        diagnostic(freshnessAccordion(signals), 'Fraîcheur (hors score)', 'Mettre à jour ou retirer les années révolues qui ne sont pas historiques.'),
        diagnostic(readabilityAccordion(signals, page.wordCount), 'Lisibilité (hors score)', 'Découper les paragraphes longs et ajouter des listes là où le contenu s’y prête.'),
        diagnostic(inContentLinksAccordion(signals, page.wordCount), 'Liens dans le contenu (hors score)', 'Remplacer les ancres vagues par des ancres qui décrivent la page de destination.'),
      ]
    : [
        diagnostic(unavailableAccordion('', staleReason), 'Fraîcheur (hors score)'),
        diagnostic(unavailableAccordion('', staleReason), 'Lisibilité (hors score)'),
        diagnostic(unavailableAccordion('', staleReason), 'Liens dans le contenu (hors score)'),
      ];
  for (const block of measured) {
    block.items = block.items.map((item) => ({ ...item, source: item.source ?? 'measured' }));
  }

  // 12. Expérience vécue et originalité (hors score)
  const qualityTitle = 'Expérience vécue et originalité (hors score)';
  const qualityBlock: EditorialAccordion =
    role === 'contact' || role === 'utility'
      ? { title: qualityTitle, scoreText: 'Sans objet', aiReasoning: '', items: [], group: 'diagnostic', hidden: true }
      : editorial.quality
        ? diagnostic(
            {
              ...qualityAccordion(editorial.quality, role),
              items: qualityAccordion(editorial.quality, role).items.map((item) => ({ ...item, source: 'ai' as const })),
            },
            qualityTitle,
            [editorial.quality.firstHandExperience.advice, editorial.quality.informationGain.advice].filter(Boolean).join(' ')
          )
        : diagnostic(
            unavailableAccordion('', 'Analyse IA indisponible pour cette page : relancez-la avec « Ré-analyser ».'),
            qualityTitle
          );

  return [...scoredBlocks, googleBlock, snippetBlock, localBlock, ...measured, qualityBlock];
}

/** Barres de score : uniquement les critères notés */
export function editorialCategories(editorial: EditorialEvaluation, role: PageRole) {
  const percent = (score: number, max: number) => Math.min(100, Math.max(0, Math.round((score / max) * 100)));
  const queryConfirmed = editorial.search?.targetQuery.confidence !== 'INFERRED';
  return [
    ...(queryConfirmed ? [{ name: 'Intention', score: percent(editorial.intentMatch.score, 20) }] : []),
    { name: 'Cannibalisation', score: percent(editorial.cannibalizationRisk.score, 20) },
    ...(queryConfirmed ? [{ name: 'Zones chaudes', score: percent(editorial.hotZonesOptimization.score, 15) }] : []),
    { name: role === 'article' ? 'Réponse directe' : 'Proposition de valeur', score: percent(editorial.primaryContentTldr.score, 15) },
    { name: 'Couverture du sujet', score: percent(editorial.semanticDepth.score, 20) },
    ...(role === 'article' ? [{ name: 'E-E-A-T', score: percent(editorial.eeatSignals.score, 10) }] : []),
  ];
}
