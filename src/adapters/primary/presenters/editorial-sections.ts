import { peopleAlsoAsk } from '@/lib/serp-labels';
import type { EditorialAccordion, InspectionData, InspectionItemData, QueryMatrixData } from '@/lib/audit-data';
import type { CriterionPoints, EditorialCriterion, EditorialEvaluation, EditorialSignals, PageFamily, PageRole, SearchIntent, SerpAnalysis } from '@/core/domain/types';
import { ROLE_LABEL } from '@/core/domain/scoring/page-role';
import { PRESENT_CRITERIA, presentCriterion, SUBJECT_GRID_LABEL, subjectCriterionTitle, subjectGridOf } from '@/core/domain/scoring/page-family';
import { INTENT_CHECKS, queryJudged } from '@/core/domain/scoring/editorial-checks';
import type { QuerySetMeasure } from '@/core/domain/scoring/query-set';
import { TECH_THRESHOLDS } from '@/core/domain/scoring/thresholds';
import { describePagePosition } from '@/lib/serp-labels';
import { detectSerpIntent } from '@/core/domain/scoring/serp-analysis';
import { filterRelevantSuggestions, isSameQuery, normalizeText } from '@/core/domain/scoring/autocomplete-relevance';
import { detectIntentFromSuggestions } from '@/core/domain/scoring/intent-evidence';

/**
 * Suggestions Google qui reprennent les mots de la requête cible (3 au minimum) : filtre aussi les analyses
 * enregistrées avant ce tri, et recalcule l'intention qu'elles suggèrent.
 */
function relevantSearches(editorial: EditorialEvaluation) {
  const search = editorial.search;
  if (!search) return { suggestions: [] as string[], evidence: undefined };
  // Filtrées sur la graine qui les a données (la requête, ou une variante plus courte) ; une intention n'est tirée
  // qu'à partir de 3 suggestions
  const seed = search.autocomplete.seed ?? search.targetQuery.query;
  const kept = filterRelevantSuggestions(seed, search.autocomplete.suggestions);
  // Intention tirée seulement d'une graine proche de la requête (un mot d'écart au plus) : une variante trop courte
  // fait remonter des recherches voisines (« accompagnement des familles en soins palliatifs »)
  const close = isSameQuery(seed, search.targetQuery.query) || isSameQuery(search.targetQuery.query, seed);
  return { suggestions: kept, evidence: kept.length >= 3 && close ? detectIntentFromSuggestions(kept) : undefined };
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
  /** Famille de la page : décide ce que juge le critère « sujet » et si la page est notée */
  family: PageFamily;
  /** L'analyse de l'IA a été faite sous une autre famille : sa grille et ses pistes ne correspondent plus */
  familyStale?: boolean;
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

/**
 * Points d'un critère : ceux calculés par le moteur ; pour une analyse enregistrée avant le barème actuel, l'ancienne
 * note convertie (même règle que le moteur).
 */
function pointsOf(
  editorial: EditorialEvaluation,
  key: EditorialCriterion,
  legacyScore: number,
  legacyMax: number,
  max: number
): CriterionPoints {
  return (
    editorial.points?.[key] ?? {
      earned: Math.round((Math.max(0, Math.min(legacyMax, legacyScore)) * max) / legacyMax),
      max,
      basis: 'legacy',
    }
  )
}

/** Cases de la grille : cochées en vert, non cochées en bleu (jugement de l'IA, pas une erreur mesurée) */
function checkItems(points: CriterionPoints): InspectionItemData[] {
  if (points.basis !== 'checklist') return []
  return [
    ...(points.passed ?? []).map((label) => ({ text: label, status: 'valid' as const, source: 'ai' as const })),
    ...(points.failed ?? []).map((label) => ({ text: `${label} : non`, status: 'info' as const, source: 'ai' as const })),
  ]
}

/** Critère noté mais exclu du score : la requête cible n'est pas confirmée dans Google */
function excluded(block: EditorialAccordion): EditorialAccordion {
  return {
    ...block,
    points: undefined,
    action: undefined,
    scoreText: 'Exclu du score',
    // Affiché avec les indications hors note
    group: 'diagnostic',
    verdict: `${block.verdict ?? ''} Exclu du score : la requête a été déduite de la page sans être retrouvée dans Google, la juger serait biaisé. Saisissez la requête visée pour l’inclure.`.trim(),
  }
}

/** Critère jugé mais hors note : constats gardés, ni points ni action */
function outOfScore(block: EditorialAccordion, reason: string): EditorialAccordion {
  return {
    ...block,
    points: undefined,
    action: undefined,
    scoreText: 'Hors note',
    // Affiché avec les indications hors note, en texte
    group: 'diagnostic',
    verdict: `${block.verdict ?? ''} ${reason}`.trim(),
  };
}

/** En-têtes courts des cases de la grille d'intention (libellé complet en légende) */
const INTENT_SHORT: Record<string, string> = { need: 'Besoin', format: 'Format', focus: 'Sujet', audience: 'Public' };

/** Zones chaudes d'une requête : colonnes du tableau et lieu cité dans l'action */
const ZONE_COLUMNS = [
  { key: 'title', label: 'Title', full: 'Title (titre affiché dans Google)', place: 'le Title', max: 6 },
  { key: 'first100Words', label: 'Début', full: '100 premiers mots du contenu', place: 'les 100 premiers mots', max: 5 },
  { key: 'subheadings', label: 'Sous-titres', full: 'Sous-titres H2 et H3', place: 'un sous-titre H2 ou H3', max: 4 },
] as const;

/** Grille d'intention par requête notée ; absente si une analyse jugée n'a pas enregistré ses cases */
function intentMatrix(querySet: QuerySetMeasure[], result: CriterionPoints): QueryMatrixData | undefined {
  if (querySet.length === 0 || querySet.some((entry) => entry.intent !== null && !entry.intentPassed && !entry.intentFailed)) return undefined;
  return {
    source: 'ai',
    columns: INTENT_CHECKS.map((check) => ({ label: INTENT_SHORT[check.id] ?? check.label, full: check.label, max: check.points })),
    rows: querySet.map((entry) => ({
      query: entry.query,
      weight: entry.weight,
      volume: entry.volume,
      total: entry.intent,
      max: 15,
      cells: INTENT_CHECKS.map((check) => ({
        earned:
          entry.intent === null
            ? null
            : entry.intentPassed?.includes(check.label)
              ? check.points
              : entry.intentFailed?.includes(check.label)
                ? 0
                : null,
        max: check.points,
      })),
    })),
    result: { earned: result.earned, max: result.max },
  };
}

/** Mots absents d'une zone, écrits comme dans la requête (« société », pas la forme comparée « societe ») */
function queryWords(query: string, tokens: string[]): string[] {
  const words = query.split(/\s+/);
  return tokens.map((token) => words.find((word) => normalizeText(word) === token) ?? token);
}

/** Zones mesurées par requête notée ; absente pour une analyse enregistrée avant le détail par zone */
function coverageMatrix(querySet: QuerySetMeasure[], result: CriterionPoints): QueryMatrixData | undefined {
  if (querySet.length === 0 || querySet.some((entry) => !entry.coverage.zones)) return undefined;
  return {
    source: 'measured',
    columns: ZONE_COLUMNS.map((zone) => ({ label: zone.label, full: zone.full, max: zone.max })),
    rows: querySet.map((entry) => ({
      query: entry.query,
      weight: entry.weight,
      volume: entry.volume,
      total: entry.coverage.score,
      max: 15,
      cells: ZONE_COLUMNS.map((zone) => {
        const measure = entry.coverage.zones![zone.key];
        return { earned: measure.points, max: measure.max, missing: queryWords(entry.query, measure.missing) };
      }),
    })),
    result: { earned: result.earned, max: result.max },
  };
}

/**
 * Action tirée des mesures, pas de l'IA : les deux requêtes qui rapportent le plus (poids × points manquants), et
 * les zones où les placer. Rien à proposer sous un point à gagner.
 */
function coverageAction(querySet: QuerySetMeasure[]): string | undefined {
  const gains = querySet
    .filter((entry) => entry.coverage.zones)
    .map((entry) => ({
      entry,
      gain: entry.weight * (15 - entry.coverage.score),
      places: ZONE_COLUMNS.filter((zone) => entry.coverage.zones![zone.key].missing.length > 0).map((zone) => zone.place),
    }))
    .filter((item) => item.places.length > 0 && item.gain >= 0.5)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 2);
  const total = Math.floor(gains.reduce((sum, item) => sum + item.gain, 0));
  if (gains.length === 0 || total < 1) return undefined;
  const list = (places: string[]) => (places.length > 1 ? `${places.slice(0, -1).join(', ')} et ${places[places.length - 1]}` : places[0]);
  const steps = gains.map((item) => `« ${item.entry.query} » dans ${list(item.places)}`);
  return `Placer ${steps.join(', puis ')} : jusqu’à ${total} pt${total > 1 ? 's' : ''} de plus sur ce critère.`;
}

/**
 * Diagnostic hors score, même format partout : « RAS », nombre de points mesurés à revoir, ou pistes de l'IA (estimations
 * en bleu, jamais comptées comme un problème)
 */
function diagnostic(accordion: EditorialAccordion, title: string, action?: string): EditorialAccordion {
  const toFix = accordion.items.filter((item) => item.status === 'warning' || item.status === 'error').length;
  const hints = accordion.items.filter((item) => item.status === 'info' && item.source === 'ai').length;
  return {
    ...accordion,
    title,
    group: 'diagnostic',
    scoreText: accordion.scoreText === 'Non disponible' ? 'Non disponible' : toFix > 0 ? `${toFix} à revoir` : hints > 0 ? 'Pistes de l’IA' : 'RAS',
    verdict: accordion.aiReasoning,
    action: toFix > 0 || hints > 0 ? action : undefined,
  };
}

function isBrandQuery(editorial: EditorialEvaluation, role: PageRole) {
  // Repère posé à l'analyse (marque dans la requête, page de contact ou utilitaire) ; sinon règle par le rôle
  const flagged = editorial.search?.targetQuery.isBrand;
  if (flagged !== undefined) return flagged;
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
  return { badge: position.badge, detail: position.detail, status: position.rank === null ? 'info' : 'valid', measuredOn };
}

/**
 * Blocs détaillés de l'onglet SEO éditorial, dans un ordre fixe (lib/issue-routing.ts y renvoie par indice) :
 * 0-5 critères notés, 6 ce que montre Google, 7-12 diagnostics hors score.
 */
export function buildEditorialSections({ editorial, role, family, familyStale, serp, signals, page }: Input): EditorialAccordion[] {
  const search = editorial.search;
  const brand = isBrandQuery(editorial, role);
  // Sections attendues (estimées par l'IA) : seulement pour une page qui informe
  const gapsApplicable = family === 'inform';
  // Sections lues chez les concurrents (mesurées) : sauf page de marque, contact ou utilitaire
  const competitorGapsApplicable = !NO_GAP_ROLES.includes(role) && family !== 'unscored';
  const query = search?.targetQuery.query;
  const isArticle = role === 'article';
  // Contenu qui répond à une question : article ou contenu informatif (guide, FAQ)
  const answersQuestion = isArticle || role === 'informational';

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
          // Estimation de l'IA : information, jamais une alerte
          status: 'info',
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
  const tldrLabel = answersQuestion ? 'Réponse directe en introduction' : 'Ce qui est proposé et pour qui, dès l’arrivée';

  // 4. Couverture du sujet
  const semantic = editorial.semanticDepth;
  const semanticItems: InspectionItemData[] = [];
  // Page qui présente : les 20 pts jugent la crédibilité (page institutionnelle) ou le savoir-faire, pas la couverture
  // d'un sujet
  const criterion = presentCriterion(role);
  if (semantic.recognizedEntities.length > 0) {
    semanticItems.push({
      text: criterion
        ? `${semantic.recognizedEntities.length} ${criterion.presentLabel}`
        : `${semantic.recognizedEntities.length} notion(s) du sujet bien traitée(s)`,
      status: 'valid',
      source: 'ai',
      details: semantic.recognizedEntities.map((entity) => ({ label: entity, status: 'valid' as const })),
    });
  }
  const missingNotions = Array.from(new Set([...semantic.missingKeyEntities, ...(gapsApplicable ? search?.contentGaps.missingEntities ?? [] : [])]));
  // Page qui présente : des pistes pour convaincre ; page qui couvre son sujet : notions et sections à envisager
  if (criterion && !familyStale) {
    for (const idea of missingNotions.slice(0, 4)) {
      semanticItems.push({ text: `${criterion.ideaLabel} : ${idea}`, status: 'info', source: 'ai' });
    }
  }
  if (familyStale) {
    semanticItems.push({
      text: `L’IA a jugé cette page avant la grille « ${SUBJECT_GRID_LABEL[subjectGridOf(role) ?? 'inform']} » : note provisoire (ancien palier converti), relancez l’analyse de la page pour obtenir la grille et des pistes adaptées.`,
      status: 'info',
    });
  } else if (gapsApplicable) {
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
    semanticItems.push({
      text: criterion ? criterion.nothing : 'Aucun manque notable repéré',
      status: 'valid',
      source: 'ai',
    });
  }

  // 5. E-E-A-T (articles seulement)
  const eeat = editorial.eeatSignals;

  // Requêtes notées : exclues seulement si aucune n'est une vraie recherche (volume, suggestion Google, saisie)
  const querySet = editorial.querySet ?? [];
  const queryInferred = querySet.length > 0 ? false : !queryJudged(search);
  const maybeExcluded = (block: EditorialAccordion) => (queryInferred ? excluded(block) : block);
  // Barème : intention 15, cannibalisation 10 (mesurée seulement), zones chaudes 15, début de page 10, sujet 20,
  // E-E-A-T 10
  const intentPoints = pointsOf(editorial, 'intent', editorial.intentMatch.score, 20, 15);
  const cannibalPoints = pointsOf(editorial, 'cannibal', cannibal.score, 20, 10);
  const openingPoints = pointsOf(editorial, 'opening', tldr.score, 15, 10);
  const goalPoints = pointsOf(editorial, 'goal', semantic.score, 20, 20);
  const eeatPoints = pointsOf(editorial, 'eeat', eeat.score, 10, 10);
  const coveragePoints = pointsOf(editorial, 'hotZones', hot.score, 15, 15);
  // Une ligne par requête notée : son poids, puis la mesure ; sans groupe (analyse antérieure), zones de la requête cible
  const share = (entry: (typeof querySet)[number]) =>
    `${Math.round(entry.weight * 100)} %${entry.volume !== undefined ? `, ${entry.volume.toLocaleString('fr-FR')}/mois` : ''}`
  const zoneItems: InspectionItemData[] =
    querySet.length > 0
      ? querySet.map((entry) => ({
          text: `« ${entry.query} » (${share(entry)}) : ${entry.coverage.score}/15${
            entry.coverage.missing.length > 0 ? `, manque dans : ${entry.coverage.missing.join(', ')}` : ', présente partout'
          }`,
          status: entry.coverage.score >= 12 ? ('valid' as const) : ('warning' as const),
          source: 'measured' as const,
        }))
      : zones.map((zone) => ({
          text: `Requête dans ${zone.label} (${zone.points} pts)`,
          status: zone.present ? ('valid' as const) : ('error' as const),
          source: 'measured' as const,
        }))
  const intentQueryItems: InspectionItemData[] =
    querySet.length > 1 || (querySet.length === 1 && intentPoints.basis !== 'checklist')
      ? querySet.map((entry) => ({
          text:
            entry.intent === null
              ? `« ${entry.query} » (${share(entry)}) : intention pas encore jugée, ré-analysez la page`
              : `« ${entry.query} » (${share(entry)}) : ${entry.intent}/15${
                  entry.intentFailed?.length ? `, non : ${entry.intentFailed.join(', ').toLowerCase()}` : ''
                }`,
          status: entry.intent === null ? ('info' as const) : entry.intent >= 12 ? ('valid' as const) : ('info' as const),
          source: 'ai' as const,
        }))
      : []
  const intentQueries = intentQueryItems.length > 0 ? intentMatrix(querySet, intentPoints) : undefined;
  const coverageQueries = coverageMatrix(querySet, coveragePoints);
  const cannibalQueryItems: InspectionItemData[] = querySet
    .filter((entry) => entry.cannibal !== null)
    .map((entry) => ({
      text: `« ${entry.query} » (${share(entry)}) : ${
        entry.cannibal === 20 ? 'seule cette page du site sort' : entry.cannibal === 5 ? 'trois pages du site ou plus sortent' : 'une autre page du site sort aussi ou à sa place'
      } (mesure Google)`,
      status: entry.cannibal === 20 ? ('valid' as const) : ('warning' as const),
      source: 'google' as const,
    }))
  const coverageVerdict =
    querySet.length > 1
      ? `Note moyenne des ${querySet.length} requêtes notées, pondérée par leur volume : chacune est cherchée dans le Title (6 pts), le début du texte (5 pts) et les sous-titres (4 pts).`
      : hotVerdict
  const goalGood = goalPoints.earned >= goalPoints.max * 0.75;
  // Cannibalisation notée seulement si elle est mesurée dans Google ; l'estimation de l'IA reste un constat
  const cannibalScored = Boolean(editorial.points?.cannibal);
  const cannibalBlock = scored('Concurrence entre vos pages', cannibalPoints.earned, cannibalPoints.max, cannibal.critique, cannibal.actionableAdvice, [...cannibalQueryItems, ...cannibalItems]);
  // Critère « sujet » (20 pts) : couverture du sujet ou présentation et preuves ; sans objet pour une page non notée.
  // Hors note quand l'analyse a été faite sous l'ancien objectif « aller droit au but » (couverture mise à 0 sans
  // jugement), en attendant la prochaine analyse
  const subjectUnjudged = family !== 'unscored' && Boolean(editorial.points) && !editorial.points?.goal;
  const subjectCandidate: EditorialAccordion =
    family === 'unscored'
      ? {
          // Page de contact, légale ou utilitaire : ni sujet à couvrir ni offre à présenter
          title: 'Couverture du sujet',
          scoreText: 'Sans objet',
          aiReasoning: 'Page de contact, légale ou utilitaire : le sujet n’a pas à être couvert en détail.',
          verdict: 'Page non notée : aucune notion ni section à ajouter.',
          group: 'scored',
          items: [{ text: 'Page sans enjeu éditorial : aucune notion ni section à ajouter', status: 'info' }],
        }
      : scored(
          subjectCriterionTitle(role),
          goalPoints.earned,
          goalPoints.max,
          criterion
            ? goalGood
              ? criterion.good
              : criterion.weak
            : goalGood
              ? 'Le sujet est traité de façon complète pour une page de ce type.'
              : 'Le sujet est traité en partie : des notions attendues par l’internaute manquent.',
          familyStale ? undefined : semantic.actionableAdvice,
          [...checkItems(goalPoints), ...semanticItems]
        );
  const subjectBlock = subjectUnjudged
    ? outOfScore(subjectCandidate, 'Analyse faite avant ce critère (ancien objectif « aller droit au but ») : relancez l’analyse de la page pour le noter.')
    : subjectCandidate;
  const scoredBlocks: EditorialAccordion[] = [
    maybeExcluded({
      ...scored(querySet.length > 1 ? 'Réponse aux recherches notées' : 'Réponse à la recherche visée', intentPoints.earned, intentPoints.max, editorial.intentMatch.critique, editorial.intentMatch.actionableAdvice, [
        ...checkItems(intentPoints),
        // Tableau par requête quand les cases sont connues ; sinon une ligne de texte par requête
        ...(intentQueries ? [] : intentQueryItems),
        ...intentItems,
      ]),
      queries: intentQueries,
    }),
    cannibalScored
      ? cannibalBlock
      : outOfScore(
          cannibalBlock,
          'Estimation de l’IA, hors note : la concurrence entre vos pages n’est notée que si elle est mesurée dans Google (onglet Positionnement).'
        ),
    maybeExcluded({
      ...scored(
        'Couverture des recherches',
        coveragePoints.earned,
        coveragePoints.max,
        coverageVerdict,
        // Action tirée des zones mesurées : l'avis de l'IA peut viser une requête qui n'est pas notée
        coverageQueries ? coverageAction(querySet) : hot.actionableAdvice,
        coverageQueries ? [] : zoneItems
      ),
      queries: coverageQueries,
    }),
    scored(answersQuestion ? 'Réponse directe' : 'Proposition claire', openingPoints.earned, openingPoints.max, tldr.critique, tldr.actionableAdvice, [
      ...(openingPoints.basis === 'checklist'
        ? checkItems(openingPoints)
        : [{ text: tldrLabel, status: tldr.hasDirectAnswer ? ('valid' as const) : ('warning' as const), source: 'ai' as const }]),
      {
        text: `${page.wordCount} mots sur la page (repère : Google n’impose pas de longueur minimale)`,
        status: 'info',
        source: 'measured',
      },
    ]),
    subjectBlock,
    isArticle
      ? scored(
          'Auteur, date et sources',
          eeatPoints.earned,
          eeatPoints.max,
          eeatPoints.earned >= 8 ? 'L’article est signé, daté et sourcé.' : 'Il manque des éléments qui montrent qui écrit et sur quelles sources.',
          `${eeat.actionableAdvice} Le balisage Schema.org correspondant est proposé dans l’onglet GEO.`,
          [
            { text: 'Auteur identifié', status: eeat.hasAuthor ? 'valid' : 'error', source: 'measured' },
            { text: 'Date de publication ou de mise à jour visible', status: eeat.hasPublicationDate ? 'valid' : 'error', source: 'measured' },
            { text: 'Sources citées', status: eeat.hasSources ? 'valid' : 'warning', source: 'ai' },
          ]
        )
      : role === 'informational'
        ? {
            // Contenu informatif : auteur et date ne sont pas exigés ; conseil hors score
            title: 'Auteur, date et sources (hors score)',
            scoreText: 'Hors score',
            aiReasoning:
              'Un guide ou une FAQ n’a pas à être signé ni daté pour être utile. Une date de mise à jour rassure toutefois si le contenu évolue (réglementation, tarifs), et citer des sources fiables renforce la confiance.',
            verdict:
              'Sans effet sur la note : une date de mise à jour et des sources sont un plus si le sujet évolue.',
            items: [
              { text: 'Auteur identifié', status: eeat.hasAuthor ? 'valid' : 'info', source: 'measured' },
              { text: 'Date de publication ou de mise à jour visible', status: eeat.hasPublicationDate ? 'valid' : 'info', source: 'measured' },
              { text: 'Sources citées', status: eeat.hasSources ? 'valid' : 'info', source: 'ai' },
            ],
            group: 'diagnostic',
          }
        : {
            title: 'Auteur, date et sources',
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
    if (competitorGapsApplicable && !brand) {
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
    const questions = peopleAlsoAsk(serp);
    if (questions.length > 0) {
      googleItems.push({
        text: `${questions.length} question(s) « Autres questions posées » : autant de sous-titres possibles`,
        status: 'info',
        source: 'google',
        details: questions.map((question) => ({ label: question, status: 'valid' as const })),
      });
    }
  }
  if (!brand && suggestions.length === 0 && search) {
    const status = search.autocomplete.status;
    googleItems.push({
      text:
        status === 'NONE'
          ? `Google ne suggère aucune recherche qui reprenne « ${search.targetQuery.query} », ni ses variantes plus courtes : la recherche est sans doute peu tapée telle quelle.`
          : status === 'UNAVAILABLE'
            ? 'Le service de suggestions de Google n’a pas répondu pendant l’analyse : relancez l’analyse plus tard pour les obtenir.'
            : status === 'NOT_REQUESTED'
              ? 'Suggestions non demandées pour ce type de page (marque, contact ou utilitaire).'
              : 'Suggestions Google non relevées pour cette analyse : relancez l’analyse pour les obtenir.',
      status: 'info',
      source: 'google',
    });
  }
  if (!brand && suggestions.length > 0) {
    const seed = search?.autocomplete.seed
    const shorter = seed && search && normalizeText(seed) !== normalizeText(search.targetQuery.query)
    googleItems.push({
      text: `${suggestions.length} recherche(s) suggérée(s) par Google${shorter ? ` à partir de « ${seed} » (variante plus courte de la requête)` : ' autour de la requête'}`,
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
    scoreText: position ? position.badge : suggestions.length > 0 && !brand ? `${suggestions.length} recherche(s)` : 'Non mesuré',
    aiReasoning: serp
      ? `Résultats Google réels lus pour la requête cible (${serp.depth ?? serp.results.length} premiers résultats organiques) : position, sections des pages concurrentes, pack local, questions, recherches suggérées.`
      : 'Recherches suggérées par Google Autocomplete. Les positions et sections concurrentes demandent l’analyse de l’onglet Positionnement.',
    verdict: serp
      ? 'Résultats Google réels lus pour la requête cible.'
      : 'Sans mesure de la SERP : seules les recherches suggérées sont disponibles.',
    action:
      serp && competitorGapsApplicable && !brand && serp.gaps.missingSections.length > 0
        ? 'Ajouter les sections absentes qui servent l’internaute, sans copier les concurrents.'
        : undefined,
    group: 'google',
    items: googleItems,
  };

  // 7. Snippet (hors score)
  const titleLength = page.title?.trim().length ?? 0;
  const metaLength = page.metaDescription?.trim().length ?? 0;
  // Mêmes repères que la note technique : un Title de 44 caractères s'affiche en entier, rien à revoir
  const { title: titleRange, metaDescription: metaRange } = TECH_THRESHOLDS;
  const snippetBlock: EditorialAccordion = search
    ? diagnostic(
        {
          title: '',
          scoreText: '',
          aiReasoning: `${search.snippet.titleCritique} ${search.snippet.metaCritique}`.trim(),
          items: [
            {
              text: `Title : ${titleLength} caractères (repère : ${titleRange.min} à ${titleRange.max})`,
              status: !page.title ? 'error' : titleLength >= titleRange.min && titleLength <= titleRange.max ? 'valid' : 'warning',
              source: 'measured',
            },
            {
              text: `Méta description : ${metaLength} caractères (repère : ${metaRange.min} à ${metaRange.max})`,
              status: !page.metaDescription ? 'error' : metaLength >= metaRange.min && metaLength <= metaRange.max ? 'valid' : 'warning',
              source: 'measured',
            },
            {
              text: `Attrait pour le clic : ${search.snippet.score}/100`,
              // Estimation de l'IA : information, jamais une alerte
              status: search.snippet.score >= 60 ? 'valid' : 'info',
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
                status: search.local.hasLocalSignals ? 'valid' : 'info',
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
  // Lisibilité mesurée : critère noté (5 pts au plus) dès que la mesure est fiable
  const read = editorial.readabilityPoints;
  if (signals && read && read.max > 0) {
    const block = measured[1];
    measured[1] = {
      ...block,
      title: 'Lisibilité',
      group: 'scored',
      scoreText: `${read.score}/${read.max} pts`,
      points: { earned: read.score, max: read.max },
      verdict:
        read.score >= read.max
          ? 'Paragraphes et phrases courts : la page se lit facilement.'
          : 'Des paragraphes ou des phrases longs ralentissent la lecture.',
      action: read.score < read.max ? 'Découper les paragraphes longs et ajouter des listes là où le contenu s’y prête.' : undefined,
    };
  }

  // 12. Qualité du contenu : notée sur les extraits vérifiés (15 pts) ; sinon diagnostic d'une analyse antérieure
  const qualityTitle = 'Expérience vécue et originalité (hors score)';
  const measuredQuality = editorial.contentQuality;
  const quote = (value?: string) => (value ? [{ label: `« ${value} »`, tag: 'Extrait vérifié', status: 'valid' as const }] : undefined);
  const qualityBlock: EditorialAccordion =
    family === 'unscored'
      ? { title: qualityTitle, scoreText: 'Sans objet', aiReasoning: '', items: [], group: 'diagnostic', hidden: true }
      : measuredQuality && editorial.quality
        ? scored(
            'Qualité du contenu',
            measuredQuality.score,
            measuredQuality.max,
            measuredQuality.score >= 11
              ? 'Le contenu s’appuie sur du vécu, des données ou des cas propres au site.'
              : 'Le contenu pourrait s’appuyer davantage sur du vécu, des données ou des cas propres au site.',
            [editorial.quality.firstHandExperience.advice, editorial.quality.informationGain.advice].filter(Boolean).join(' '),
            [
              {
                text:
                  measuredQuality.checks.experience.length > 0
                    ? `Expérience vécue : ${measuredQuality.checks.experience.length} extrait(s) retrouvé(s) dans la page (${measuredQuality.checks.experience.length >= 2 ? 5 : 3}/5 pts)`
                    : 'Expérience vécue : aucun extrait retrouvé dans la page (0/5 pt)',
                status: measuredQuality.checks.experience.length > 0 ? 'valid' : 'info',
                source: 'ai',
                details: measuredQuality.checks.experience.map((value) => ({ label: `« ${value} »`, tag: 'Extrait vérifié', status: 'valid' as const })),
              },
              {
                text: measuredQuality.checks.originalData ? 'Donnée ou méthode propre au site (4/4 pts)' : 'Aucune donnée ni méthode propre repérée (0/4 pt)',
                status: measuredQuality.checks.originalData ? 'valid' : 'info',
                source: 'ai',
                details: quote(measuredQuality.checks.originalData),
              },
              {
                text: measuredQuality.checks.concreteCase ? 'Cas concret décrit (4/4 pts)' : 'Aucun cas concret repéré (0/4 pt)',
                status: measuredQuality.checks.concreteCase ? 'valid' : 'info',
                source: 'ai',
                details: quote(measuredQuality.checks.concreteCase),
              },
              {
                text: measuredQuality.checks.limits ? 'Limite ou contrainte reconnue (2/2 pts)' : 'Aucune limite ni contrainte évoquée (0/2 pt)',
                status: measuredQuality.checks.limits ? 'valid' : 'info',
                source: 'ai',
                details: quote(measuredQuality.checks.limits),
              },
              ...(editorial.quality.informationGain.genericFluff.length > 0
                ? [
                    {
                      text: `${editorial.quality.informationGain.genericFluff.length} passage(s) générique(s) repéré(s) (sans effet sur la note)`,
                      status: 'info' as const,
                      source: 'ai' as const,
                      details: editorial.quality.informationGain.genericFluff.map((passage) => ({ label: `« ${passage} »`, tag: 'Générique' })),
                    },
                  ]
                : []),
            ]
          )
      : editorial.quality
        ? diagnostic(
            {
              ...qualityAccordion(editorial.quality, role),
              items: [
                ...qualityAccordion(editorial.quality, role).items.map((item) => ({ ...item, source: 'ai' as const })),
                // Page qui informe analysée avant la note : à relancer ; page qui présente : la preuve est déjà jugée
                // dans « Crédibilité » ou « Savoir-faire », ce bloc reste un conseil
                family === 'inform'
                  ? {
                      text: 'Analyse antérieure à la note « Qualité du contenu » : relancez l’analyse de la page pour l’inclure dans la note.',
                      status: 'info' as const,
                    }
                  : {
                      text: `Hors score pour une page qui présente : la preuve est déjà jugée dans « ${(presentCriterion(role) ?? PRESENT_CRITERIA.skills).title} ».`,
                      status: 'info' as const,
                    },
              ],
            },
            qualityTitle,
            [editorial.quality.firstHandExperience.advice, editorial.quality.informationGain.advice].filter(Boolean).join(' ')
          )
        : diagnostic(
            unavailableAccordion('', 'Analyse IA indisponible pour cette page : relancez-la avec « Ré-analyser ».'),
            qualityTitle
          );

  // Page non notée (contact, légale, utilitaire) : les constats restent, sans points ni note
  const unscored = (block: EditorialAccordion) =>
    block.points ? outOfScore(block, 'Page de contact, légale ou utilitaire : exclue de la note éditoriale.') : block;
  return family === 'unscored'
    ? [...scoredBlocks.map(unscored), googleBlock, snippetBlock, localBlock, ...measured.map(unscored), qualityBlock]
    : [...scoredBlocks, googleBlock, snippetBlock, localBlock, ...measured, qualityBlock];
}

/** Barres de score : uniquement les critères retenus pour la page, en pourcentage de leurs points */
export function editorialCategories(editorial: EditorialEvaluation, role: PageRole, family: PageFamily) {
  // Page non notée : aucune barre de score
  if (family === 'unscored') return [];
  const percent = (item: CriterionPoints) => Math.min(100, Math.max(0, Math.round((item.earned / item.max) * 100)));
  const queryConfirmed = queryJudged(editorial.search);
  const opening = role === 'article' || role === 'informational' ? 'Réponse directe' : 'Proposition claire';
  const bars: { name: string; score: number }[] = [];
  if (queryConfirmed) bars.push({ name: 'Intention', score: percent(pointsOf(editorial, 'intent', editorial.intentMatch.score, 20, 15)) });
  // Cannibalisation : seulement quand elle est mesurée dans Google
  if (editorial.points?.cannibal) bars.push({ name: 'Cannibalisation', score: percent(editorial.points.cannibal) });
  if (queryConfirmed) bars.push({ name: 'Couverture des recherches', score: percent(pointsOf(editorial, 'hotZones', editorial.hotZonesOptimization.score, 15, 15)) });
  bars.push({ name: opening, score: percent(pointsOf(editorial, 'opening', editorial.primaryContentTldr.score, 15, 10)) });
  // Critère « sujet » : absent des points quand l'analyse a été faite sans lui (ancien objectif « aller droit au but »)
  if (!editorial.points || editorial.points.goal) {
    bars.push({ name: subjectCriterionTitle(role), score: percent(pointsOf(editorial, 'goal', editorial.semanticDepth.score, 20, 20)) });
  }
  if (role === 'article') bars.push({ name: 'E-E-A-T', score: percent(pointsOf(editorial, 'eeat', editorial.eeatSignals.score, 10, 10)) });
  if (editorial.points?.quality) bars.push({ name: 'Qualité du contenu', score: percent(editorial.points.quality) });
  if (editorial.points?.readability) bars.push({ name: 'Lisibilité', score: percent(editorial.points.readability) });
  return bars;
}
