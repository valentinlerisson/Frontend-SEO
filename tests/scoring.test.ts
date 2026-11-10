/**
 * Tests des moteurs de score : vérifient que le code applique les règles décrites dans docs/tableau-metriques.md.
 *   npm run test:scoring
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNap, napMeasuredPoints } from '@/core/domain/scoring/nap';
import { GeoScoringEngine, geoMeasuredPoints } from '@/core/domain/scoring/GeoScoringEngine';
import { EditorialScoringEngine } from '@/core/domain/scoring/EditorialScoringEngine';
import { buildSerpAnalysis, localPackRank } from '@/core/domain/scoring/serp-analysis';
import { TechScoringEngine } from '@/core/domain/scoring/TechScoringEngine';
import { GlobalScoringEngine, PILLAR_WEIGHTS } from '@/core/domain/scoring/GlobalScoringEngine';
import { GEO_ENABLED } from '@/core/domain/features';
import { evaluateCitability, scoreCitability } from '@/core/domain/scoring/citability';
import { measureHotZones } from '@/core/domain/scoring/hot-zones';
import { classifyPageRole } from '@/core/domain/scoring/page-role';
import { familyOf, subjectGridOf } from '@/core/domain/scoring/page-family';
import { evaluateContentQuality, readabilityPoints } from '@/core/domain/scoring/content-quality';
import { gridMatches, INTENT_CHECKS, SUBJECT_CHECKS, openingQuoteVerified, proofQuoteVerified, scoreChecks } from '@/core/domain/scoring/editorial-checks';
import {
  betterMeasuredTarget,
  chooseTargetQuery,
  containsBrand,
  sanitizeCandidates,
  serpQueriesFor,
  serpForQuery,
  chosenSerpQueries
} from '@/core/domain/scoring/query-candidates';
import { brandVariants, stripPlaces, suggestionSeeds } from '@/core/domain/scoring/autocomplete-relevance';
import { compareReferringDomains } from '@/core/domain/backlinks';
import { buildKeywordRows, keywordPresence, keywordSeeds, keywordsForSerp, matchEvidenceVerified, trendOf } from '@/core/domain/keyword-research';
import { MockKeywordVolumes } from '@/adapters/secondary/search-data/mock-keyword-volumes';
import { buildQuerySet, cannibalFromSerp, cappedWeights, weightedAverage } from '@/core/domain/scoring/query-set';
import { isHistoricalMention, staleMentions } from '@/core/domain/scoring/freshness';
import { brandsFromDomains, classifyOpportunities, seasonalityOf } from '@/core/domain/keyword-opportunities';
import { isRewriteOutdated, matchHeading, rewriteMarkdown, rewriteOutline, unverifiedFacts } from '@/core/domain/page-rewrite';
import { editorialCriteria, pageLosses, siteGains, techCriteria } from '@/core/domain/scoring/score-losses';
import { pageHealthOf, searchDemandOf } from '@/adapters/primary/presenters/dashboard-data';
import { isArchivePath, resolveCrawlScope } from '@/core/domain/crawl-scope';
import { prioritizeSearches, remainingSearches, resolveSerpBudget } from '@/core/domain/serp-budget';
import { cleanPlaceName, measurementZones, queryForZone, type GeoZone } from '@/core/domain/zones';
import { detectEstablishments, parseAddress, zoneBand, zoneCoverage } from '@/core/domain/local-visibility';
import { communesInRadius, distanceKm, simplifyRing } from '@/core/domain/geo-radius';
import { pageKeyOf, reorderColumn, verificationOf } from '@/core/domain/fix-plan';
import { clampWidth, defaultLayout, layoutSummary, mergeLayout, moveColumn, stickyOffsets, toggleHidden, togglePinned, visibleColumns, type TableColumn } from '@/lib/table-layout';
import { classifyResult, interpretSerp } from '@/core/domain/serp-insights';
import type { EditorialEvaluation, NapSignals, PageRole, RawPageData, SearchInsights, SerpAnalysis, SerpResult } from '@/core/domain/types';

const DOMAIN = 'exemple.fr';

function page(path: string, overrides: Partial<RawPageData> = {}): RawPageData {
  return {
    url: `https://${DOMAIN}${path}`,
    path,
    httpStatus: 200,
    depth: 1,
    isPillar: true,
    isIndexable: true,
    title: 'Plombier à Lyon : dépannage rapide',
    metaDescription: 'Dépannage plomberie à Lyon, intervention en 1 h.',
    h1: 'Plombier à Lyon',
    h1Count: 1,
    headings: [{ level: 1, text: 'Plombier à Lyon' }],
    headingHierarchyValid: true,
    headingHierarchyErrors: [],
    wordCount: 800,
    inlinksCount: 5,
    outlinksCount: 10,
    links: [],
    images: [],
    imagesTotal: 0,
    imagesWithAlt: 0,
    hasSsl: true,
    redirectHops: 0,
    hasSchemaOrg: false,
    schemaTypes: [],
    first100Words: 'Plombier à Lyon, dépannage rapide.',
    hasAuthor: false,
    hasPublicationDate: false,
    externalAuthoritativeLinksCount: 0,
    bodyText: 'Plombier à Lyon, dépannage rapide.',
    ...overrides
  };
}

const PHONE = '0472000000';
const ADDRESS = { postalCode: '69003', city: 'Lyon', text: '10 rue de la Gare, 69003 Lyon' };

// ---------------------------------------------------------------- NAP

test('NAP : sans JSON-LD à comparer, la cohérence sort du calcul (10 pts sur 10)', () => {
  const nap: NapSignals = { phones: [PHONE], addresses: [ADDRESS] };
  const result = analyzeNap([{ url: 'a', nap }]).get('a')!;
  assert.equal(result.consistencyMeasured, false);
  assert.equal(result.score, 10);
  assert.equal(napMeasuredPoints(result), 10);
});

test('NAP : JSON-LD conforme aux coordonnées visibles, 15 pts sur 15', () => {
  const nap: NapSignals = { phones: [PHONE], addresses: [ADDRESS], schema: { phone: PHONE, postalCode: '69003' } };
  const result = analyzeNap([{ url: 'a', nap }]).get('a')!;
  assert.equal(result.consistencyMeasured, true);
  assert.equal(result.isConsistent, true);
  assert.equal(result.score, 15);
  assert.equal(napMeasuredPoints(result), 15);
});

test('NAP : téléphone visible différent du JSON-LD de la page, 10 pts sur 15', () => {
  const nap: NapSignals = { phones: [PHONE], addresses: [ADDRESS], schema: { phone: '0473999999' } };
  const result = analyzeNap([{ url: 'a', nap }]).get('a')!;
  assert.equal(result.isConsistent, false);
  assert.equal(result.score, 10);
  assert.equal(napMeasuredPoints(result), 15);
});

test('NAP : groupe multi-établissements, chaque fiche jugée contre son propre JSON-LD', () => {
  const lyon: NapSignals = { phones: [PHONE], addresses: [ADDRESS], schema: { phone: PHONE } };
  const paris: NapSignals = {
    phones: ['0140000000'],
    addresses: [{ postalCode: '75011', city: 'Paris', text: '5 rue Oberkampf, 75011 Paris' }],
    schema: { phone: '0140000000' }
  };
  const results = analyzeNap([
    { url: 'lyon', nap: lyon },
    { url: 'lyon-2', nap: lyon },
    { url: 'paris', nap: paris }
  ]);
  assert.equal(results.get('paris')!.isConsistent, true);
  assert.equal(results.get('paris')!.score, 15);
});

test('NAP : aucune coordonnée sur le site, critère exclu (0 pt mesuré)', () => {
  const result = analyzeNap([{ url: 'a', nap: { phones: [], addresses: [] } }]).get('a')!;
  assert.equal(result.measured, false);
  assert.equal(napMeasuredPoints(result), 0);
});

// ---------------------------------------------------------------- GEO

const BOTS = { gptBotAllowed: true, claudeBotAllowed: true, perplexityBotAllowed: true, hasLlmsTxt: false, llmsTxtValid: false };

function geoRatio(nap: NapSignals) {
  const napResult = analyzeNap([{ url: 'a', nap }]).get('a')!;
  const { score, evaluation } = GeoScoringEngine.calculate(page('/'), undefined, BOTS, napResult);
  const e = evaluation!;
  const raw =
    e.aiBotsAccessibility.score + e.aiCitability.score + e.authoritySources.score + e.schemaOrgLdJson.score + e.napConsistency.score;
  return { score, raw, denominator: 85 + napMeasuredPoints(e.napConsistency) };
}

test('GEO : dénominateur de 95 quand la cohérence NAP n’est pas mesurable', () => {
  const { score, raw, denominator } = geoRatio({ phones: [PHONE], addresses: [ADDRESS] });
  assert.equal(denominator, 95);
  assert.ok(Math.abs(score - (raw / 95) * 100) <= 1, `${score} vs ${(raw / 95) * 100}`);
});

test('GEO : dénominateur de 100 quand la cohérence NAP est mesurée', () => {
  const { score, raw, denominator } = geoRatio({ phones: [PHONE], addresses: [ADDRESS], schema: { phone: PHONE } });
  assert.equal(denominator, 100);
  assert.ok(Math.abs(score - raw) <= 1);
});

test('GEO : Schema.org noté selon le type décrit', () => {
  assert.equal(GeoScoringEngine.scoreSchema(true, ['LocalBusiness']).score, 25);
  assert.equal(GeoScoringEngine.scoreSchema(true, ['WebPage', 'BreadcrumbList']).score, 10);
  assert.equal(GeoScoringEngine.scoreSchema(false, []).score, 0);
});

// ---------------------------------------------------------------- Cannibalisation mesurée

const QUERY = 'plombier lyon';
const AUDITED = `https://${DOMAIN}/plombier-lyon/`;

function evaluationWithQuery(): { raw: RawPageData; evaluation: EditorialEvaluation } {
  const raw = page('/plombier-lyon/', { url: AUDITED, roleOverride: 'offer' });
  const base = EditorialScoringEngine.calculate(raw).evaluation!;
  const evaluation: EditorialEvaluation = {
    ...base,
    cannibalizationRisk: { ...base.cannibalizationRisk, score: 14, source: 'AI', critique: 'Estimation IA.' },
    search: {
      targetQuery: { query: QUERY, intent: 'TRANSACTIONAL', source: 'AUTO' },
      autocomplete: { suggestions: [], source: 'UNAVAILABLE' },
      snippet: { score: 50, titleCritique: '', metaCritique: '' },
      contentGaps: { missingSections: [], missingEntities: [], source: 'AI_ESTIMATE' },
      local: { isLocalBusiness: true, city: 'Lyon', hasLocalSignals: true, advice: '' },
      analyzedBy: { engine: 'HEURISTIC' }
    }
  };
  return { raw, evaluation };
}

function serpWith(ownUrls: string[]) {
  const results: SerpResult[] = Array.from({ length: 10 }, (_, i) => ({
    position: i + 1,
    title: `Résultat ${i + 1}`,
    url: `https://concurrent${i}.fr/`,
    snippet: '',
    domain: `concurrent${i}.fr`
  }));
  ownUrls.forEach((url, i) => {
    results[i * 2 + 1] = { position: i * 2 + 2, title: 'Nous', url, snippet: '', domain: DOMAIN };
  });
  return buildSerpAnalysis({ query: QUERY, fetchedAt: '', results, domain: DOMAIN, pageUrl: AUDITED, competitors: [], ourText: '' });
}

function cannibalization(ownUrls: string[]) {
  const { raw, evaluation } = evaluationWithQuery();
  const result = EditorialScoringEngine.calculate(raw, evaluation, serpWith(ownUrls));
  return { risk: result.evaluation!.cannibalizationRisk, issues: result.issues };
}

test('Cannibalisation : seule la page auditée sort, 20 pts mesurés', () => {
  const { risk } = cannibalization([AUDITED]);
  assert.equal(risk.score, 20);
  assert.equal(risk.source, 'SERP');
});

test('Cannibalisation : deux pages du site, 10 pts ; trois, 5 pts', () => {
  assert.equal(cannibalization([AUDITED, `https://${DOMAIN}/plombier/`]).risk.score, 10);
  assert.equal(
    cannibalization([AUDITED, `https://${DOMAIN}/plombier/`, `https://${DOMAIN}/contact/`]).risk.score,
    5
  );
});

test('Cannibalisation : une autre page du site sort à la place, 10 pts et anomalie', () => {
  const other = `https://${DOMAIN}/plombier/`;
  const { risk, issues } = cannibalization([other]);
  assert.equal(risk.score, 10);
  assert.equal(risk.otherPageRanks, true);
  assert.equal(risk.competingUrl, other);
  const issue = issues.find((i) => i.code === 'CANNIBALIZATION_RISK');
  assert.ok(issue);
  assert.equal(issue!.severity, 'WARNING');
});

test('Cannibalisation : site absent des résultats, pas de 20/20, estimation de l’IA conservée', () => {
  const { risk } = cannibalization([]);
  assert.equal(risk.score, 14);
  assert.equal(risk.source, 'AI');
  assert.match(risk.critique, /non mesurable/);
});

// ---------------------------------------------------------------- Technique

const crawl = (overrides: Partial<RawPageData>) => TechScoringEngine.calculate(page('/offre/', overrides));
const codes = (overrides: Partial<RawPageData>) => crawl(overrides).issues.map((i) => i.code);

test('Technique : canonique vers soi 5 pts, absente 3 pts, vers une autre URL 0 pt et anomalie', () => {
  const self = crawl({ canonicalUrl: `https://www.${DOMAIN}/offre` }).breakdown.crawlability;
  const missing = crawl({ canonicalUrl: undefined }).breakdown.crawlability;
  const elsewhere = crawl({ canonicalUrl: `https://${DOMAIN}/autre/` });
  assert.equal(self - missing, 2);
  assert.equal(self - elsewhere.breakdown.crawlability, 5);
  assert.ok(elsewhere.issues.some((i) => i.code === 'CANONICAL_ELSEWHERE'));
});

test('Technique : une redirection unique n’est pas une chaîne ; deux sauts coûtent 5 pts', () => {
  const one = crawl({ redirectHops: 1, redirectStatuses: [301] });
  const two = crawl({ redirectHops: 2, redirectStatuses: [301, 301] });
  assert.ok(!one.issues.some((i) => i.code === 'REDIRECT_CHAIN'));
  assert.ok(two.issues.some((i) => i.code === 'REDIRECT_CHAIN'));
  assert.equal(one.breakdown.securityAndHttp - two.breakdown.securityAndHttp, 5);
});

test('Technique : redirection temporaire signalée, permanente non', () => {
  assert.ok(codes({ redirectHops: 1, redirectStatuses: [302] }).includes('TEMPORARY_REDIRECT'));
  assert.ok(!codes({ redirectHops: 1, redirectStatuses: [301] }).includes('TEMPORARY_REDIRECT'));
});

test('Technique : page en 404, anomalie HTTP_404 sans cascade sur la canonique', () => {
  const issues = codes({ httpStatus: 404 });
  assert.ok(issues.includes('HTTP_404'));
  assert.ok(!issues.includes('CANONICAL_ELSEWHERE'));
});

test('Technique : critère non mesuré hors dénominateur, jamais crédité', () => {
  const result = crawl({ inSitemap: undefined, isBlockedByRobotsTxt: undefined });
  assert.ok((result.unmeasuredPoints ?? 0) >= 10);
});

// ---------------------------------------------------------------- Éditorial : requête cible

function editorialCoverage(targetQuery: Partial<SearchInsights['targetQuery']>) {
  const { raw, evaluation } = evaluationWithQuery();
  evaluation.search = { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, ...targetQuery } };
  return EditorialScoringEngine.calculate(raw, evaluation).evaluation!;
}

test('Éditorial : requête seulement déduite, désormais notée (groupe de requêtes notées), 60 pts mesurés (cannibalisation estimée hors note)', () => {
  const evaluation = editorialCoverage({ source: 'AUTO', suggestedByGoogle: false });
  assert.equal(evaluation.search!.targetQuery.confidence, 'INFERRED');
  // Les requêtes notées viennent de l'IA qui lit la page ou de Keyword Planner : plus d'exclusion de 30 pts
  assert.equal(evaluation.coverage!.measured, 60);
});

test('Éditorial : requête proposée par Google, confirmée, 60 pts mesurés (E-E-A-T sans objet hors article)', () => {
  const evaluation = editorialCoverage({ source: 'AUTO', suggestedByGoogle: true });
  assert.equal(evaluation.search!.targetQuery.confidence, 'CONFIRMED');
  assert.equal(evaluation.coverage!.measured, 60);
});

test('Éditorial : requête saisie à la main, toujours notée', () => {
  const evaluation = editorialCoverage({ source: 'MANUAL' });
  assert.equal(evaluation.search!.targetQuery.confidence, 'MANUAL');
  assert.equal(evaluation.coverage!.measured, 60);
});

// ---------------------------------------------------------------- Score du projet

test('Projet : pages en noindex volontaire exclues de la moyenne technique', () => {
  const { techAvg } = GlobalScoringEngine.computeProjectScore([
    { techScore: 80, isPillar: false },
    { techScore: 20, isPillar: false, excludedFromTechAverage: true }
  ]);
  assert.equal(techAvg, 80);
});

test('Projet : moyenne éditoriale pondérée par les points mesurés', () => {
  const { editorialAvg } = GlobalScoringEngine.computeProjectScore([
    { techScore: 50, isPillar: true, editorialScore: 100, editorialMeasured: 90, geoScore: 50 },
    { techScore: 50, isPillar: true, editorialScore: 40, editorialMeasured: 55, geoScore: 50 }
  ]);
  assert.equal(editorialAvg, Math.round((100 * 90 + 40 * 55) / 145));
});

test('Projet : 40 % technique, 35 % éditorial, 25 % GEO ; GEO mis de côté : 40 et 35 ramenés à 100', () => {
  const { overallScore } = GlobalScoringEngine.computeProjectScore([
    { techScore: 100, isPillar: true, editorialScore: 0, geoScore: 0 }
  ]);
  assert.equal(overallScore, GEO_ENABLED ? 40 : 53);
  // Note d'une page pilier : moyenne des piliers comptés (veste-maroc : 90, 85 et GEO 47)
  assert.equal(GlobalScoringEngine.computePageScore(90, 85, 47, true), GEO_ENABLED ? 74 : 88);
  assert.equal(GlobalScoringEngine.computePageScore(90, undefined, undefined, true), 90);
  assert.equal(GlobalScoringEngine.computePageScore(90, 85, 47, false), 90);
  assert.ok(Math.abs(PILLAR_WEIGHTS.tech + PILLAR_WEIGHTS.editorial + PILLAR_WEIGHTS.geo - 1) < 1e-9);
});

// ---------------------------------------------------------------- Citabilité GEO

const CONTENT =
  'Le Groupe Exemple gère 28 résidences pour personnes âgées en France, dont 12 EHPAD habilités à l’aide sociale. ' +
  'Une résidence services seniors accueille des personnes autonomes dans des appartements privatifs, avec restauration et animations. ' +
  'Nous vous accompagnons avec bienveillance.';

test('Citabilité : grille 16 + 8 + 8 + 8', () => {
  assert.equal(scoreCitability({ passages: 3, definition: true, fact: true, questionHeadings: 2 }), 40);
  assert.equal(scoreCitability({ passages: 1, definition: false, fact: true, questionHeadings: 1 }), 20);
  assert.equal(scoreCitability({ passages: 0, definition: false, fact: false, questionHeadings: 0 }), 0);
});

test('Citabilité : seuls les extraits retrouvés mot pour mot comptent', () => {
  const result = evaluateCitability({
    excerpt: CONTENT,
    headings: [
      { level: 2, text: 'Qu’est-ce qu’une résidence services seniors ?' },
      { level: 3, text: 'Combien coûte un EHPAD ?' },
      { level: 2, text: 'Nos valeurs' }
    ],
    quotablePassages: [
      'Une résidence services seniors accueille des personnes autonomes dans des appartements privatifs, avec restauration et animations.',
      'Une résidence services seniors accueille des personnes âgées dépendantes.',
      'Nous vous accompagnons avec bienveillance.'
    ],
    definitionQuote: 'Une résidence services seniors accueille des personnes autonomes dans des appartements privatifs, avec restauration et animations.',
    factQuote: 'Le Groupe Exemple gère 28 résidences pour personnes âgées en France, dont 12 EHPAD habilités à l’aide sociale.'
  });
  // Passage inventé rejeté, slogan trop court rejeté
  assert.equal(result.checks.passages, 1);
  assert.equal(result.checks.definition, true);
  assert.equal(result.checks.fact, true);
  assert.equal(result.checks.questionHeadings, 2);
  assert.equal(result.score, 8 + 8 + 8 + 8);
});

test('Citabilité : un « fait » sans chiffre ne compte pas', () => {
  const result = evaluateCitability({
    excerpt: CONTENT,
    headings: [],
    quotablePassages: [],
    definitionQuote: '',
    factQuote: 'Nous vous accompagnons avec bienveillance.'
  });
  assert.equal(result.checks.fact, false);
  assert.equal(result.score, 0);
});

test('GEO : citabilité sans objet sur une page de contact, 40 pts hors dénominateur', () => {
  const nap: NapSignals = { phones: [PHONE], addresses: [ADDRESS], schema: { phone: PHONE } };
  const napResult = analyzeNap([{ url: 'a', nap }]).get('a')!;
  const contact = GeoScoringEngine.calculate(page('/nous-contacter/', { roleOverride: 'contact' }), undefined, BOTS, napResult);
  const e = contact.evaluation!;
  assert.equal(e.aiCitability.applicable, false);
  assert.equal(geoMeasuredPoints(e), 60);
  const raw = e.aiBotsAccessibility.score + e.authoritySources.score + e.schemaOrgLdJson.score + e.napConsistency.score;
  assert.ok(Math.abs(contact.score - (raw / 60) * 100) <= 1);
  assert.ok(!contact.issues.some((i) => i.code === 'LOW_AI_CITABILITY'));
});

test('GEO : citabilité comptée sur une page d’offre', () => {
  const { evaluation } = GeoScoringEngine.calculate(page('/offre/', { roleOverride: 'offer' }), undefined, BOTS);
  assert.equal(evaluation!.aiCitability.applicable, true);
});

// ---------------------------------------------------------------- Zones chaudes mesurées

test('Zones chaudes : mesurées sans casse, accents ni pluriel', () => {
  const hot = measureHotZones('résidence senior Lyon', {
    title: 'Résidences seniors à LYON',
    first100Words: 'Nos residences pour seniors à Lyon accueillent...',
    headings: [{ level: 2, text: 'Vivre en résidence à Lyon' }]
  });
  assert.equal(hot.title.points, 6);
  assert.equal(hot.first100Words.points, 5);
  assert.deepEqual(hot.subheadings.missing, ['senior']);
  assert.equal(hot.subheadings.points, 3);
  assert.equal(hot.score, 14);
});

test('Zones chaudes : le moteur remplace l’estimation de l’IA par la mesure', () => {
  const { raw, evaluation } = evaluationWithQuery();
  evaluation.hotZonesOptimization = { ...evaluation.hotZonesOptimization, score: 2 };
  const result = EditorialScoringEngine.calculate(raw, evaluation).evaluation!;
  assert.equal(result.hotZonesOptimization.source, 'MEASURED');
  // « plombier lyon » : présent dans le Title et les 100 premiers mots, absent des H2/H3
  assert.equal(result.hotZonesOptimization.score, 11);
});

// ---------------------------------------------------------------- Requêtes candidates (sans la marque)

test('Requêtes candidates : la marque, les rubriques et les doublons sont écartés', () => {
  const brands = brandVariants('big-happy.fr');
  const kept = sanitizeCandidates(
    [
      { query: 'Big Happy agence', intent: 'NAVIGATIONAL' },
      { query: 'bighappy avis', intent: 'NAVIGATIONAL' },
      { query: 'Agence marketing Toulouse', intent: 'COMMERCIAL' },
      { query: 'agences marketing toulouse', intent: 'COMMERCIAL' },
      { query: 'actualités', intent: 'INFORMATIONAL' },
      { query: 'agence data', intent: 'COMMERCIAL' }
    ],
    brands
  );
  assert.deepEqual(
    kept.map((candidate) => candidate.query),
    ['agence marketing toulouse', 'agence data']
  );
  assert.equal(containsBrand('groupe associatif edenis', brandVariants('edenis.fr')), true);
  assert.equal(containsBrand('association ehpad toulouse', brandVariants('edenis.fr')), false);
});

test('Requêtes candidates : la cible est la première suggérée par Google, sinon la première de l’IA', () => {
  const candidates = [
    { query: 'agence data', intent: 'COMMERCIAL' as const, suggestedByGoogle: false },
    { query: 'agence marketing toulouse', intent: 'COMMERCIAL' as const, suggestedByGoogle: true }
  ];
  assert.equal(chooseTargetQuery(candidates)?.query, 'agence marketing toulouse');
  assert.equal(chooseTargetQuery(candidates.map((c) => ({ ...c, suggestedByGoogle: false })))?.query, 'agence data');
  // 3 recherches au plus : la cible, puis les suggérées par Google
  assert.deepEqual(
    serpQueriesFor('agence data', [...candidates, { query: 'conseil data', intent: 'COMMERCIAL', suggestedByGoogle: false }, { query: 'agence seo', intent: 'COMMERCIAL', suggestedByGoogle: true }]),
    ['agence data', 'agence marketing toulouse', 'agence seo']
  );
});

test('Requêtes candidates : une cible non confirmée cède la place à une candidate où la page sort', () => {
  const candidates = [
    { query: 'agence data', intent: 'COMMERCIAL' as const, suggestedByGoogle: false },
    { query: 'conseil data', intent: 'COMMERCIAL' as const, suggestedByGoogle: false }
  ];
  const absent = { ...serpWith([]), query: 'agence data toulouse', status: 'DONE' as const };
  const found = { ...serpWith([AUDITED]), query: 'conseil data toulouse', status: 'DONE' as const };
  assert.equal(betterMeasuredTarget(candidates[0], [absent, found], candidates), 'conseil data toulouse');
  // Cible suggérée par Google : elle reste
  assert.equal(betterMeasuredTarget({ ...candidates[0], suggestedByGoogle: true }, [absent, found], candidates), undefined);
});

test('Cannibalisation : une requête générique se mesure aussi sur une page institutionnelle', () => {
  const { raw, evaluation } = evaluationWithQuery();
  raw.roleOverride = 'brand';
  evaluation.search!.targetQuery.isBrand = false;
  const risk = EditorialScoringEngine.calculate(raw, evaluation, serpWith([AUDITED])).evaluation!.cannibalizationRisk;
  assert.equal(risk.source, 'SERP');
  evaluation.search!.targetQuery.isBrand = true;
  const brandRisk = EditorialScoringEngine.calculate(raw, evaluation, serpWith([AUDITED])).evaluation!.cannibalizationRisk;
  assert.equal(brandRisk.source, 'AI');
});

// ---------------------------------------------------------------- Backlinks

test('Backlinks : domaines gagnés et perdus depuis l’audit précédent', () => {
  const previous = {
    status: 'DONE' as const,
    source: 'COMMON_CRAWL' as const,
    release: 'cc-main-2026-jul-aug-sep',
    fetchedAt: '2026-10-01T00:00:00.000Z',
    referringDomains: [
      { domain: 'a.fr', hosts: 1 },
      { domain: 'b.fr', hosts: 1 }
    ]
  };
  const changes = compareReferringDomains(previous, [
    { domain: 'b.fr', hosts: 1 },
    { domain: 'c.fr', hosts: 2 }
  ]);
  assert.deepEqual(changes?.added, ['c.fr']);
  assert.deepEqual(changes?.lost, ['a.fr']);
  // Relevé précédent en échec ou absent : pas de comparaison
  assert.equal(compareReferringDomains({ ...previous, status: 'UNAVAILABLE' }, []), undefined);
  assert.equal(compareReferringDomains(null, []), undefined);
});

// ---------------------------------------------------------------- Périmètre d'exploration

test('Périmètre : plafond borné, pages principales à 50, sitemaps vides = tout le site', () => {
  assert.deepEqual(resolveCrawlScope(null, 5000), { mode: 'full', maxPages: 2000, maxDepth: 6 });
  assert.deepEqual(resolveCrawlScope({ mode: 'main' }, 300), { mode: 'main', maxPages: 50, maxDepth: 2 });
  assert.equal(resolveCrawlScope({ mode: 'sitemaps', sitemaps: [] }, 150).mode, 'full');
  assert.deepEqual(resolveCrawlScope({ mode: 'sitemaps', sitemaps: ['https://a.fr/page-sitemap.xml', 'javascript:x'] }, 80).sitemaps, [
    'https://a.fr/page-sitemap.xml'
  ]);
});

test('Périmètre : archives et listes écartées des pages principales, articles datés gardés', () => {
  assert.equal(isArchivePath('/tag/seo/'), true);
  assert.equal(isArchivePath('/category/actualites/page/2/'), true);
  assert.equal(isArchivePath('/2023/08/'), true);
  assert.equal(isArchivePath('/blog?page=3'), true);
  assert.equal(isArchivePath('/2023/08/28/migration-site'), false);
  assert.equal(isArchivePath('/services/audit-seo/'), false);
});

// ---------------------------------------------------------------- Budget de recherches Google

test('Budget Google : bornes, reste du lancement et du jour', () => {
  assert.deepEqual(resolveSerpBudget({ perRun: 500, perDay: 1 }), { perRun: 60, perDay: 10 });
  assert.deepEqual(resolveSerpBudget(null), { perRun: 20, perDay: 60 });
  const budget = { perRun: 20, perDay: 60 };
  assert.equal(remainingSearches(budget, 5, 10), 15);
  assert.equal(remainingSearches(budget, 5, 55), 5);
  assert.equal(remainingSearches(budget, 25, 0), 0);
});

test('Budget Google : la requête visée de chaque page passe avant les recherches génériques', () => {
  const order = prioritizeSearches([
    { id: 'blog', isPillar: false, queries: ['b1', 'b2'] },
    { id: 'offre', isPillar: true, queries: ['o1', 'o2', 'o3'] }
  ]).map(({ page, queryIndex }) => page.queries[queryIndex]);
  assert.deepEqual(order, ['o1', 'b1', 'o2', 'b2', 'o3']);
});

test('Budget Google avec zones : requête visée partout, puis génériques dans la zone principale, puis le reste', () => {
  const order = prioritizeSearches([{ isPillar: true, queries: ['cible', 'g1', 'g2'], zoneCount: 2 }]).map(
    ({ page, queryIndex, zoneIndex }) => `${page.queries[queryIndex]}@${zoneIndex}`
  );
  assert.deepEqual(order, ['cible@0', 'cible@1', 'g1@0', 'g2@0', 'g1@1', 'g2@1']);
});

// ---------------------------------------------------------------- Zones ciblées

test('Zones : la zone propre d’une page remplace celles du projet ; sans zone, mesure sans lieu simulé', () => {
  const zone = (id: string, name: string) =>
    ({ id, kind: 'commune', code: id, name, label: name, city: { code: id, name, region: 'Centre-Val de Loire', latitude: 48.4481, longitude: 1.5046 } }) as const;
  const project = [zone('28085', 'Chartres'), zone('28134', 'Dreux'), zone('28280', 'Lucé'), zone('45234', 'Orléans')];
  assert.deepEqual(measurementZones(project).map((z) => z?.name), ['Chartres', 'Dreux', 'Lucé']);
  assert.deepEqual(measurementZones(project, zone('28134', 'Dreux')).map((z) => z?.name), ['Dreux']);
  assert.deepEqual(measurementZones([]), [undefined]);
  // La zone s'ajoute à la fin de la recherche, une seule fois ; sans zone, rien n'est ajouté
  assert.equal(queryForZone('agence web', project[0]), 'agence web chartres');
  assert.equal(queryForZone('agence web chartres', project[0]), 'agence web chartres');
  assert.equal(queryForZone('agence web'), 'agence web');
});

test('Recherches proposées sans lieu : villes, zones composées, codes postaux et départements retirés', () => {
  assert.equal(stripPlaces('agence web chartres', ['Chartres']), 'agence web');
  assert.equal(stripPlaces('création site internet eure-et-loir', ['Eure-et-Loir']), 'création site internet');
  assert.equal(stripPlaces('e agence web seo oise (60)', ['Oise']), 'e agence web seo');
  assert.equal(stripPlaces('ehpad à toulouse 31000', ['Toulouse']), 'ehpad');
  assert.equal(stripPlaces('association loi 1901', ['Toulouse']), 'association loi 1901');
  const kept = sanitizeCandidates([{ query: 'agence web Chartres', intent: 'COMMERCIAL' }, { query: 'agence web', intent: 'COMMERCIAL' }], [], 5, ['Chartres']);
  assert.deepEqual(kept.map((candidate) => candidate.query), ['agence web']);
});

test('Requête changée : les résultats Google de l’ancienne requête ne sont plus utilisés', () => {
  const old = { ...serpWith([AUDITED]), query: 'groupe associatif edenis', status: 'DONE' as const };
  const candidate = { ...serpWith([]), query: 'association ehpad toulouse', status: 'DONE' as const };
  assert.equal(serpForQuery('association ehpad toulouse', old, [old, candidate]), candidate);
  assert.equal(serpForQuery('maison de retraite associative', old, [old, candidate]), undefined);
  // Requête locale mesurée avec la ville ajoutée : c'est bien la même requête
  const local = { ...candidate, query: 'agence web chartres' };
  assert.equal(serpForQuery('agence web', local), local);
});

// ---------------------------------------------------------------- Visibilité locale

test('Visibilité locale : couverture par zone (rattachement, Title, H1, adresse), pas par simple mention', () => {
  const dreux: GeoZone = {
    id: 'commune:28134', kind: 'commune', code: '28134', name: 'Dreux', label: 'Dreux (28)', postalCodes: ['28100'],
    city: { code: '28134', name: 'Dreux', region: 'Centre-Val de Loire', latitude: 48.74, longitude: 1.36 }
  };
  const eure: GeoZone = { ...dreux, id: 'departement:28', kind: 'departement', code: '28', name: 'Eure-et-Loir', label: 'Eure-et-Loir (28)', postalCodes: undefined };
  const pages = [
    { id: 'a', path: '/agence-dreux/', title: 'Agence web à Dreux' },
    { id: 'b', path: '/contact/', title: 'Contact', address: 'Siège : 2 rue X 28100 Dreux' },
    { id: 'c', path: '/blog/', title: 'Blog', h1: 'Nos articles' },
    { id: 'd', path: '/offre/', title: 'Offre', zoneId: 'commune:28134' }
  ];
  assert.deepEqual(zoneCoverage(dreux, pages).map((p) => `${p.id}:${p.reason}`), ['a:title', 'b:adresse', 'd:zone']);
  assert.deepEqual(zoneCoverage(eure, pages).map((p) => p.id), ['b']);
  assert.deepEqual(parseAddress('us contacter Siège social : 3 rue Claude Marie Perroud 31100 Toulouse'), { postalCode: '31100', city: 'Toulouse' });
});

test('Visibilité locale : établissements = adresses différentes du siège (code postal dominant)', () => {
  const pages = [
    { id: '1', path: '/', address: 'Siège 31100 Toulouse' },
    { id: '2', path: '/mission/', address: 'Siège 31100 Toulouse' },
    { id: '3', path: '/etablissements/edelweiss/', address: '12 rue des Lilas 31700 Beauzelle' },
    { id: '4', path: '/blog/' }
  ];
  assert.deepEqual(detectEstablishments(pages).map((e) => `${e.page.id}:${e.postalCode}:${e.city}`), ['3:31700:Beauzelle']);
});

test('Pack local : place du site repérée par son domaine ou son nom', () => {
  const features = { localPack: true, peopleAlsoAsk: [], localPackEntries: [{ name: 'Concurrent' }, { name: 'Agence Big Happy', website: 'https://autre.fr/' }] };
  assert.equal(localPackRank(features, 'big-happy.fr'), 2);
  assert.equal(localPackRank({ ...features, localPackEntries: [{ name: 'Concurrent' }] }, 'big-happy.fr'), null);
  assert.equal(localPackRank({ localPack: true, peopleAlsoAsk: [] }, 'big-happy.fr'), undefined);
});

// ---------------------------------------------------------------- Lecture des résultats Google

test('Résultats Google : Top 10 classé (votre site, annuaires, sites publics, concurrents)', () => {
  assert.equal(classifyResult('www.pagesjaunes.fr', 'exemple.fr'), 'directory');
  assert.equal(classifyResult('pour-les-personnes-agees.gouv.fr', 'exemple.fr'), 'public');
  assert.equal(classifyResult('blog.exemple.fr', 'exemple.fr'), 'own');
  assert.equal(classifyResult('concurrent.fr', 'exemple.fr'), 'competitor');
});

test('Résultats Google : interprétation et priorité tirées des mesures', () => {
  const absent = { ...serpWith([`https://${DOMAIN}/plombier/`]), status: 'DONE' as const };
  const reading = interpretSerp({ measures: [absent], main: absent, pageUrl: AUDITED, ownDomain: DOMAIN, pageWords: 400 });
  assert.match(reading.sentences[0], /aucune des 1 recherche/);
  assert.match(reading.sentences[1], /\/plombier\/ \(n°2\)/);
  assert.match(reading.priority, /Décider quelle page doit se classer/);
  const found = { ...serpWith([AUDITED]), status: 'DONE' as const };
  assert.match(interpretSerp({ measures: [found], main: found, pageUrl: AUDITED, ownDomain: DOMAIN, pageWords: 400 }).priority, /bien placée/);
});

test('Rôle : contenu informatif (guide, FAQ) distinct de l’article daté', () => {
  const base = { depth: 2, wordCount: 600 };
  assert.equal(classifyPageRole({ ...base, path: '/questions/quels-sont-les-criteres-dadmission/' }), 'informational');
  assert.equal(classifyPageRole({ ...base, path: '/guide-du-financement/' }), 'informational');
  assert.equal(classifyPageRole({ ...base, path: '/aide/', schemaTypes: ['FAQPage'] }), 'informational');
  assert.equal(classifyPageRole({ ...base, path: '/guide-du-financement/', schemaTypes: ['Article'] }), 'article');
  assert.equal(classifyPageRole({ ...base, path: '/blog/nouveau-site/' }), 'article');
});

test('Éditorial : contenu informatif sans auteur ni date, critère retiré du score (60 pts sans cannibalisation mesurée)', () => {
  const { raw, evaluation } = evaluationWithQuery();
  raw.roleOverride = 'informational';
  const result = EditorialScoringEngine.calculate(raw, { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' } } });
  // Intention 15 + couverture des recherches 15 + début de page 10 + couverture du sujet 20
  assert.equal(result.evaluation?.coverage?.measured, 60);
  assert.equal(result.evaluation?.family, 'inform');
});

test('Suggestions Google : variantes plus courtes (sans les lieux, puis 3 et 2 mots principaux)', () => {
  assert.deepEqual(suggestionSeeds('accompagnement des familles ehpad'), [
    'accompagnement des familles ehpad',
    'accompagnement familles ehpad',
    'accompagnement familles'
  ]);
  assert.deepEqual(suggestionSeeds('agence web seo chartres', ['Chartres']), ['agence web seo chartres', 'agence web seo', 'agence web']);
});

test('Requêtes choisies : ordre gardé, doublons et textes trop longs écartés, 6 au plus, lieux conservés', () => {
  assert.deepEqual(chosenSerpQueries(['  piano  numérique ', 'Piano numérique', 'piano toulouse', 42, '', 'x'.repeat(121)]), [
    'piano numérique',
    'piano toulouse'
  ]);
  assert.equal(chosenSerpQueries(['a b', 'c d', 'e f', 'g h', 'i j', 'k l', 'm n']).length, 6);
  assert.deepEqual(chosenSerpQueries('piano'), []);
});

test('Famille de la page : déduite du rôle (informer, présenter, non notée)', () => {
  assert.equal(familyOf('article'), 'inform');
  assert.equal(familyOf('informational'), 'inform');
  for (const role of ['home', 'offer', 'hub', 'brand', 'case'] as const) assert.equal(familyOf(role), 'present', role);
  assert.equal(familyOf('contact'), 'unscored');
  assert.equal(familyOf('utility'), 'unscored');
});

test('Éditorial : page de contact ou légale non notée (note nulle, hors moyenne, aucune alerte de critère)', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  const weak = { ...confirmed, intentMatch: { ...confirmed.intentMatch, score: 0 }, primaryContentTldr: { ...confirmed.primaryContentTldr, score: 0 } };
  for (const role of ['contact', 'utility'] as const) {
    const result = EditorialScoringEngine.calculate({ ...raw, roleOverride: role }, weak);
    assert.equal(result.score, null, role);
    assert.equal(result.evaluation?.coverage?.measured, 0, role);
    assert.equal(result.evaluation?.points?.goal, undefined, role);
    assert.equal(result.issues.some((issue) => ['INTENT_MISMATCH', 'MISSING_TLDR_SUMMARY', 'SEMANTIC_GAPS', 'HOT_ZONES_UNOPTIMIZED'].includes(issue.code)), false, role);
  }
  // Exclue de la moyenne du projet (note éditoriale absente)
  const project = GlobalScoringEngine.computeProjectScore([
    { techScore: 80, editorialScore: 60, isPillar: true, editorialMeasured: 60 },
    { techScore: 80, editorialScore: undefined, isPillar: true, editorialMeasured: 0 }
  ]);
  assert.equal(project.editorialAvg, 60);
  assert.equal(GlobalScoringEngine.computePageScore(80, undefined, undefined, true), 80);
});

test('Éditorial : famille « présenter », pistes en information ; « informer », manque en avertissement', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  const weak = { ...confirmed, semanticDepth: { ...confirmed.semanticDepth, score: 5, missingKeyEntities: ['références clients nommées'] } };
  const present = EditorialScoringEngine.calculate({ ...raw, roleOverride: 'offer' }, weak).issues.find((issue) => issue.code === 'SEMANTIC_GAPS');
  const inform = EditorialScoringEngine.calculate({ ...raw, roleOverride: 'informational' }, weak).issues.find((issue) => issue.code === 'SEMANTIC_GAPS');
  assert.equal(present?.severity, 'INFO');
  assert.match(present?.title ?? '', /savoir-faire/);
  assert.equal(inform?.severity, 'WARNING');
});

test('Éditorial : accueil, offre, liste, marque et réalisation notés sur le même barème (60 pts)', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  for (const role of ['home', 'offer', 'hub', 'brand', 'case'] as const) {
    const result = EditorialScoringEngine.calculate({ ...raw, roleOverride: role }, confirmed);
    // Intention 15 + couverture des recherches 15 + début de page 10 + présentation et preuves 20
    assert.equal(result.evaluation?.coverage?.measured, 60, role);
    assert.equal(result.evaluation?.contentQuality, undefined, role);
  }
});

test('Éditorial : analyse faite sous l’ancien objectif « aller droit au but », critère « sujet » hors note (pas de 0 d’office)', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  // L'IA mettait la couverture à 0 sous « aller droit au but » : ce 0 n'est pas un jugement
  const zeroed = { ...confirmed, semanticDepth: { ...confirmed.semanticDepth, score: 0 } };
  const checks = { intent: {}, opening: {}, openingQuote: '', goal: {}, goalKey: 'direct' };
  const result = EditorialScoringEngine.calculate({ ...raw, roleOverride: 'brand' }, { ...zeroed, checks });
  assert.equal(result.evaluation?.points?.goal, undefined);
  assert.equal(result.evaluation?.coverage?.measured, 40);
  // Ancienne analyse sous un objectif de preuve : l'ancien palier reste compté
  const convinced = EditorialScoringEngine.calculate({ ...raw, roleOverride: 'brand' }, { ...zeroed, checks: { ...checks, goalKey: 'reassure' } });
  assert.equal(convinced.evaluation?.points?.goal?.basis, 'legacy');
});

test('Éditorial : cannibalisation notée seulement si mesurée dans Google (estimation de l’IA hors note)', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  const estimated = EditorialScoringEngine.calculate(raw, { ...confirmed, cannibalizationRisk: { ...confirmed.cannibalizationRisk, score: 0, competingUrl: `https://${DOMAIN}/plombier/` } });
  assert.equal(estimated.evaluation?.points?.cannibal, undefined);
  assert.equal(estimated.evaluation?.coverage?.measured, 60);
  // Estimation de l'IA : information, jamais une alerte
  assert.equal(estimated.issues.find((issue) => issue.code === 'CANNIBALIZATION_RISK')?.severity, 'INFO');
  const measured = EditorialScoringEngine.calculate(raw, confirmed, serpWith([AUDITED]));
  assert.deepEqual([measured.evaluation?.points?.cannibal?.earned, measured.evaluation?.points?.cannibal?.basis], [10, 'measured']);
  assert.equal(measured.evaluation?.coverage?.measured, 70);
});

test('Qualité du contenu : seuls les extraits retrouvés mot pour mot comptent (15 pts)', () => {
  const content = 'Nous intervenons depuis 2009 à Lyon. Sur un chantier rue Garibaldi, nous avons remplacé 40 m de canalisation en une journée. Nous ne traitons pas les piscines.';
  const result = evaluateContentQuality({
    content,
    experienceQuotes: ['nous avons remplacé 40 m de canalisation en une journée', 'Une phrase inventée par le modèle, absente'],
    originalDataQuote: 'Nous intervenons depuis 2009 à Lyon.',
    concreteCaseQuote: 'Sur un chantier rue Garibaldi, nous avons remplacé 40 m de canalisation',
    limitsQuote: 'Nous ne traitons pas les piscines.'
  });
  assert.equal(result.checks.experience.length, 1);
  assert.equal(result.score, 3 + 4 + 4 + 2);
  assert.equal(evaluateContentQuality({ content, experienceQuotes: [], originalDataQuote: 'nous' }).score, 0);
});

test('Lisibilité mesurée : 5 pts au plus, mesure peu fiable retirée', () => {
  const good = { paragraphCount: 8, avgParagraphWords: 45, longParagraphs: 0, sentenceCount: 30, longSentenceRatio: 0.1, listCount: 2, tableCount: 0 };
  assert.deepEqual([readabilityPoints(good, 900).score, readabilityPoints(good, 900).max], [5, 5]);
  const dense = { ...good, avgParagraphWords: 140, longParagraphs: 6, longSentenceRatio: 0.6, listCount: 0 };
  assert.equal(readabilityPoints(dense, 900).score, 0);
  assert.equal(readabilityPoints({ ...good, paragraphCount: 1, sentenceCount: 4 }, 120).max, 0);
});

test('Éditorial : qualité et lisibilité entrent dans le dénominateur seulement si mesurées', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  // Analyse antérieure : ni extraits ni signaux mesurés
  assert.equal(EditorialScoringEngine.calculate(raw, confirmed).evaluation?.coverage?.measured, 60);
  const quality = {
    firstHandExperience: { detected: true, confidence: 'HIGH' as const, evidence: ['Plombier à Lyon, dépannage rapide.'], advice: '' },
    informationGain: { level: 'MEDIUM' as const, hasOriginalData: false, hasConcreteCases: false, genericFluff: [], mentionsLimits: false, advice: '', originalDataQuote: '', concreteCaseQuote: '', limitsQuote: '' }
  };
  const signals: RawPageData['editorialSignals'] = {
    freshness: { currentYear: 2026, outdatedMentions: [] },
    readability: { paragraphCount: 5, avgParagraphWords: 40, longParagraphs: 0, sentenceCount: 12, longSentenceRatio: 0.1, listCount: 1, tableCount: 0 },
    inContentLinks: { total: 3, internal: 3, external: 0, genericAnchors: 0, links: [] },
    consentGated: false,
    facts: { counts: [] }
  };
  const result = EditorialScoringEngine.calculate({ ...raw, roleOverride: 'informational', editorialSignals: signals }, { ...confirmed, quality });
  assert.equal(result.evaluation?.coverage?.measured, 60 + 15 + 5);
  assert.equal(result.evaluation?.coverage?.total, 100);
  assert.equal(result.evaluation?.contentQuality?.score, 3);
  // Famille « présenter » : preuve déjà jugée dans « Crédibilité » ou « Savoir-faire », qualité hors score
  assert.equal(EditorialScoringEngine.calculate({ ...raw, editorialSignals: signals }, { ...confirmed, quality }).evaluation?.contentQuality, undefined);
  // Page de contact : qualité sans objet
  const contact = EditorialScoringEngine.calculate({ ...raw, roleOverride: 'contact', editorialSignals: signals }, { ...confirmed, quality });
  assert.equal(contact.evaluation?.contentQuality, undefined);
});

test('Fraîcheur : une année qui date un début (« depuis 2019 », « fondée en ») n’est pas à revoir', () => {
  const since = { year: 2019, zone: 'CONTENT' as const, excerpt: 'Big Happy propose depuis 2019 une offre allant de la data' };
  assert.equal(isHistoricalMention(since), true);
  assert.equal(isHistoricalMention({ year: 1998, zone: 'CONTENT', excerpt: 'Agence fondée en 1998 à Toulouse' }), true);
  assert.equal(isHistoricalMention({ year: 2015, zone: 'CONTENT', excerpt: 'Entreprise créée en 2015 par deux associés' }), true);
  const price = { year: 2019, zone: 'CONTENT' as const, excerpt: 'Tarifs en 2019 : 50 € la séance' };
  assert.equal(isHistoricalMention(price), false);
  assert.deepEqual(staleMentions([since, price]), [price]);
});

test('Éditorial : originalité et expérience vécue signalées seulement pour une page qui informe ; zones de chaque requête enregistrées', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const quality = {
    firstHandExperience: { detected: false, confidence: 'LOW' as const, evidence: [], advice: 'Ajouter un retour de terrain.' },
    informationGain: { level: 'LOW' as const, hasOriginalData: false, hasConcreteCases: false, genericFluff: ['Une équipe passionnée'], mentionsLimits: false, advice: '', originalDataQuote: '', concreteCaseQuote: '', limitsQuote: '' }
  };
  const signals: RawPageData['editorialSignals'] = {
    freshness: { currentYear: 2026, outdatedMentions: [{ year: 2019, zone: 'CONTENT', excerpt: 'Big Happy propose depuis 2019 une offre' }] },
    readability: { paragraphCount: 5, avgParagraphWords: 40, longParagraphs: 0, sentenceCount: 12, longSentenceRatio: 0.1, listCount: 1, tableCount: 0 },
    inContentLinks: { total: 3, internal: 3, external: 0, genericAnchors: 0, links: [] },
    consentGated: false,
    facts: { counts: [] }
  };
  const codes = (role: PageRole) =>
    EditorialScoringEngine.calculate({ ...raw, roleOverride: role, editorialSignals: signals }, { ...evaluation, quality }).issues.map((issue) => issue.code);
  // Page qui présente : la preuve est jugée dans « Crédibilité » ou « Savoir-faire », pas de second constat
  assert.equal(codes('offer').includes('GENERIC_CONTENT'), false);
  assert.equal(codes('offer').includes('NO_FIRST_HAND_EXPERIENCE'), false);
  assert.equal(codes('informational').includes('GENERIC_CONTENT'), true);
  assert.equal(codes('informational').includes('NO_FIRST_HAND_EXPERIENCE'), true);
  // « depuis 2019 » : année historique, aucun constat de fraîcheur
  assert.equal(codes('informational').includes('OUTDATED_YEAR_MENTIONS'), false);
  // Détail par zone de chaque requête notée (tableau de l'onglet Contenu)
  const entry = EditorialScoringEngine.calculate(raw, evaluation).evaluation?.querySet?.[0];
  assert.ok(entry?.coverage.zones);
  const zones = entry.coverage.zones;
  assert.deepEqual([zones.title.max, zones.first100Words.max, zones.subheadings.max], [6, 5, 4]);
  assert.equal(zones.title.points + zones.first100Words.points + zones.subheadings.points, entry.coverage.score);
});

test('Grilles à cases : chaque grille vaut son barème (15, 10, 20) et seules les cases cochées comptent', () => {
  assert.equal(scoreChecks(INTENT_CHECKS, {}).max, 15);
  for (const checks of Object.values(SUBJECT_CHECKS)) assert.equal(scoreChecks(checks, {}).max, 20);
  // Grille selon le rôle (v13) : crédibilité pour une page institutionnelle, savoir-faire pour les autres pages qui
  // présentent, aucune pour une page non notée
  assert.equal(subjectGridOf('brand'), 'credibility');
  assert.deepEqual((['home', 'offer', 'hub', 'case'] as const).map(subjectGridOf), ['skills', 'skills', 'skills', 'skills']);
  assert.equal(subjectGridOf('article'), 'inform');
  assert.equal(subjectGridOf('contact'), null);
  // Aucune case ne juge la conversion (prix, modalités)
  assert.equal(Object.values(SUBJECT_CHECKS).flat().some((check) => check.id === 'practical'), false);
  // Grille de couverture inchangée depuis l'objectif « cover » ; grille « present » (v12) et anciens objectifs non repris
  assert.equal(gridMatches('cover', 'inform'), true);
  assert.equal(gridMatches('inform', 'inform'), true);
  assert.equal(gridMatches('present', 'skills'), false);
  assert.equal(gridMatches('convince', 'credibility'), false);
  assert.equal(gridMatches('skills', 'skills'), true);
  const result = scoreChecks(INTENT_CHECKS, { need: true, focus: true, format: false, inconnu: true });
  assert.equal(result.earned, 6 + 3);
  assert.equal(result.failed.length, 2);
  // Clés préfixées par le groupe (« intent.need ») reconnues
  assert.equal(scoreChecks(INTENT_CHECKS, { 'intent.need': true, 'intent.format': true }).earned, 6 + 4);
});

test('Grilles à cases : la phrase d’introduction doit figurer au début de la page', () => {
  const content = `Plombier à Lyon, nous intervenons en 1 h pour toute fuite. ${'mot '.repeat(400)}Phrase très loin dans la page, citée à tort.`;
  assert.equal(openingQuoteVerified(content, 'nous intervenons en 1 h pour toute fuite'), true);
  assert.equal(openingQuoteVerified(content, 'Phrase très loin dans la page, citée à tort.'), false);
  assert.equal(openingQuoteVerified(content, 'inventée par le modèle et absente'), false);
  // Preuve concrète : n'importe où dans la page, 20 caractères au moins
  assert.equal(proofQuoteVerified(content, 'Phrase très loin dans la page, citée à tort.'), true);
  assert.equal(proofQuoteVerified(content, 'en 1 h'), false);
  assert.equal(proofQuoteVerified(content, 'Plus de 300 chantiers réalisés'), false);
});

test('Éditorial : grilles cochées par l’IA, note calculée par le code ; ancien palier converti sans grille', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  // Sans grille (analyse antérieure) : intention 20 sur 20 convertie en 15 sur 15
  const legacy = EditorialScoringEngine.calculate(raw, { ...confirmed, intentMatch: { ...confirmed.intentMatch, score: 20 } });
  assert.deepEqual([legacy.evaluation?.points?.intent?.earned, legacy.evaluation?.points?.intent?.basis], [15, 'legacy']);
  const withProof = { ...raw, bodyText: 'Plombier à Lyon, dépannage rapide. Plus de 300 chantiers réalisés depuis 2009.' };
  const checks = {
    intent: { need: true, format: true, focus: false, audience: true },
    opening: { pitch: true, specific: false },
    openingQuote: 'Plombier à Lyon, dépannage rapide.',
    goal: { proof: true, distinct: true, how: false, needs: true },
    goalKey: 'skills',
    proofQuote: 'Plus de 300 chantiers réalisés depuis 2009.'
  };
  const result = EditorialScoringEngine.calculate(withProof, { ...confirmed, checks });
  const points = result.evaluation!.points!;
  assert.deepEqual([points.intent?.earned, points.intent?.basis], [12, 'checklist']);
  assert.equal(points.opening?.earned, 6);
  assert.equal(points.goal?.earned, 7 + 5 + 4);
  // Preuve citée absente de la page : case « preuve » refusée
  const noProof = EditorialScoringEngine.calculate(withProof, { ...confirmed, checks: { ...checks, proofQuote: 'Une preuve inventée par le modèle' } });
  assert.equal(noProof.evaluation?.points?.goal?.earned, 5 + 4);
  // Grille remplie sous un ancien objectif (« convaincre ») : ancienne note gardée jusqu'à la prochaine analyse
  const stale = EditorialScoringEngine.calculate(withProof, { ...confirmed, checks: { ...checks, goalKey: 'convince' } });
  assert.equal(stale.evaluation?.points?.goal?.basis, 'legacy');
  // Grille « present » du prompt v12 (avec « conditions pratiques ») : ancienne note gardée jusqu'à la prochaine analyse
  const v12 = EditorialScoringEngine.calculate(withProof, { ...confirmed, checks: { ...checks, goalKey: 'present' } });
  assert.equal(v12.evaluation?.points?.goal?.basis, 'legacy');
  // Page institutionnelle : grille « crédibilité » (qui est derrière, repères de solidité)
  const brandChecks = { ...checks, goal: { proof: true, distinct: false, people: true, track: true }, goalKey: 'credibility' };
  const brand = EditorialScoringEngine.calculate({ ...withProof, roleOverride: 'brand' }, { ...confirmed, checks: brandChecks });
  assert.equal(brand.evaluation?.points?.goal?.earned, 7 + 4 + 4);
  assert.equal(brand.evaluation?.subjectGrid, 'credibility');
  // Rôle passé de « marque » à « offre » : la grille crédibilité ne vaut plus, ancienne note en attendant l'analyse
  assert.equal(EditorialScoringEngine.calculate(withProof, { ...confirmed, checks: brandChecks }).evaluation?.points?.goal?.basis, 'legacy');
  // Phrase d'introduction absente de la page : case « pitch » refusée
  const fake = EditorialScoringEngine.calculate(withProof, { ...confirmed, checks: { ...checks, openingQuote: 'Une phrase inventée de toutes pièces' } });
  assert.equal(fake.evaluation?.points?.opening?.earned, 0);
  // Ancienne grille du début de page (proposition de valeur en 3 cases) : ignorée, ancien palier converti
  const oldOpening = EditorialScoringEngine.calculate(withProof, { ...confirmed, checks: { ...checks, opening: { lead: true, distinct: true, action: true } } });
  assert.equal(oldOpening.evaluation?.points?.opening?.basis, 'legacy');
  // Grille mal remplie (texte des requêtes à la place des cases) : ignorée, ancienne note gardée plutôt que 0
  const garbled = { 'agence web': false, 'site vitrine': false };
  const malformed = EditorialScoringEngine.calculate(raw, { ...confirmed, checks: { ...checks, opening: garbled, goal: garbled } });
  assert.equal(malformed.evaluation?.points?.opening?.basis, 'legacy');
  assert.equal(malformed.evaluation?.points?.goal?.basis, 'legacy');
});

test('Éditorial : une requête de marque non confirmée reste jugée (intention et zones chaudes notées)', () => {
  const { raw, evaluation } = evaluationWithQuery();
  evaluation.search = { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'AUTO', suggestedByGoogle: false, isBrand: true } };
  const result = EditorialScoringEngine.calculate({ ...raw, roleOverride: 'contact' }, evaluation).evaluation!;
  assert.equal(result.search!.targetQuery.confidence, 'INFERRED');
  // Contact : critères jugés et affichés, mais page non notée (hors moyenne éditoriale)
  assert.ok(result.points?.intent && result.points?.hotZones);
  assert.equal(result.coverage!.measured, 0);
});

test('Mots-clés : graines sans marque ni lieu, sans doublon, requête visée d’abord', () => {
  const seeds = keywordSeeds({
    target: 'agence web chartres',
    candidates: ['création site internet', 'agence web'],
    title: 'Big Happy | Création de sites internet – Agence web',
    h1: 'À propos',
    headings: [{ level: 2, text: 'Refonte de site vitrine' }, { level: 2, text: 'Ils parlent de nous' }, { level: 2, text: 'Traceurs soumis à consentement' }, { level: 3, text: 'Ignoré (H3)' }],
    brands: brandVariants('big-happy.fr'),
    places: ['Chartres']
  });
  // Graines complètes, puis leurs versions courtes (2 mots principaux) pour trouver des volumes
  assert.deepEqual(seeds.map((seed) => seed.keyword), ['agence web', 'création site internet', 'refonte de site vitrine', 'création site', 'refonte de site']);
  assert.equal(seeds[0].origin, 'target');
  assert.equal(seeds[3].origin, 'core');
});

test('Mots-clés : présence par zone, ordre libre et pluriels confondus', () => {
  const presence = keywordPresence('site internet', {
    title: 'Création de sites internet',
    h1: 'Agence web',
    headings: [{ level: 2, text: 'Internet et site vitrine' }],
    text: 'Nous créons votre site.'
  });
  assert.deepEqual(presence, { title: true, h1: false, h2: true, text: false });
});

test('Mots-clés : 3 meilleurs volumes proposés au positionnement, aucun sans volume', async () => {
  const page = { title: 'Agence web', h1: 'Agence web', headings: [], text: '' };
  const seeds = [
    { keyword: 'agence web', origin: 'target' as const },
    { keyword: 'site vitrine', origin: 'page' as const },
    { keyword: 'refonte site', origin: 'page' as const },
    { keyword: 'création logo', origin: 'page' as const }
  ];
  const result = {
    seeds: [
      { keyword: 'agence web', avgMonthlySearches: 2400 },
      { keyword: 'site vitrine', avgMonthlySearches: 0 },
      { keyword: 'refonte site', avgMonthlySearches: 90, closeVariants: ['refonte de site'] },
      { keyword: 'création logo', avgMonthlySearches: 5400 }
    ],
    ideas: [
      { keyword: 'agence web prix', avgMonthlySearches: 320 },
      { keyword: 'création logo devis', avgMonthlySearches: 300 },
      { keyword: 'création logo prix', avgMonthlySearches: 200 },
      { keyword: 'agence digitale', avgMonthlySearches: 110 },
      { keyword: 'recette crêpes', avgMonthlySearches: 90000 }
    ]
  };
  const rows = buildKeywordRows(seeds, result, page, []);
  // « agence web prix » : variante de la requête visée ; « création logo devis » : variante de « création logo »
  // « agence digitale » : un seul mot en commun avec les graines, idée écartée
  assert.deepEqual(keywordsForSerp({ provider: 'x', simulated: false, fetchedAt: '', rows }), ['création logo', 'agence web', 'refonte site']);
  assert.ok(!rows.some((row) => row.keyword === 'agence digitale'));
  assert.ok(!rows.find((row) => row.keyword === 'création logo prix')?.forSerp);
  assert.ok(!rows.some((row) => row.keyword === 'recette crêpes'));
  assert.equal(buildKeywordRows(seeds, null, page, []).filter((row) => row.forSerp).length, 0);
  // Source de démonstration : mêmes chiffres à chaque appel
  const mock = new MockKeywordVolumes();
  assert.deepEqual(await mock.ideas(['agence web']), await mock.ideas(['agence web']));
});

test('Mots-clés : tendance sur 12 mois (écart de 20 %)', () => {
  assert.equal(trendOf([100, 100, 100, 100, 100, 100, 100, 100, 100, 130, 130, 130]), 'up');
  assert.equal(trendOf([100, 100, 100, 100, 100, 100, 100, 100, 100, 90, 90, 90]), 'flat');
  assert.equal(trendOf([100, 100, 100]), undefined);
});

test('Requêtes notées : poids proportionnels au volume, plafonnés à 50 % (75 % à deux)', () => {
  const round = (values: number[]) => values.map((value) => Math.round(value * 100));
  assert.deepEqual(round(cappedWeights([9000, 100, 100])), [50, 25, 25]);
  assert.deepEqual(round(cappedWeights([600, 300, 100])), [50, 38, 13]);
  assert.deepEqual(round(cappedWeights([9000, 1000])), [75, 25]);
  assert.deepEqual(round(cappedWeights([300])), [100]);
  assert.deepEqual(round(cappedWeights([0, 0])), [50, 50]);
});

test('Requêtes notées : vrais volumes d’abord, sans variante proche ; volumes simulés ignorés', () => {
  const row = (keyword: string, avgMonthlySearches: number) => ({
    keyword,
    origin: 'page' as const,
    avgMonthlySearches,
    presence: { title: false, h1: false, h2: false, text: false },
    forSerp: false
  });
  const rows = [row('agence web', 2400), row('agence web prix', 900), row('site vitrine', 600), row('refonte site', 300), row('logo', 0), row('création logo', 200), row('charte graphique', 100)];
  const candidates = [
    { query: 'agence web', intent: 'COMMERCIAL' as const, suggestedByGoogle: true },
    { query: 'création site internet', intent: 'COMMERCIAL' as const, suggestedByGoogle: true },
    { query: 'formulation inventée', intent: 'COMMERCIAL' as const, suggestedByGoogle: false }
  ];
  const target = { query: 'agence web', confirmed: false };
  const real = buildQuerySet({ target, research: { provider: 'google-ads', simulated: false, fetchedAt: '', rows }, candidates });
  assert.deepEqual(real.map((entry) => entry.query), ['agence web', 'site vitrine', 'refonte site', 'création logo']);
  assert.equal(real[0].source, 'target');
  assert.ok(real.every((entry) => entry.confirmed));
  // Volumes simulés : requête cible puis premiers mots-clés de l'IA, 3 au plus, à poids égal
  const mock = buildQuerySet({ target, research: { provider: 'mock', simulated: true, fetchedAt: '', rows }, candidates });
  assert.deepEqual(mock.map((entry) => entry.query), ['agence web', 'création site internet', 'formulation inventée']);
  assert.ok(mock.every((entry) => Math.abs(entry.weight - 1 / 3) < 1e-9));
  // Contact : la requête de marque seule ; choix de l'utilisateur prioritaire
  assert.equal(buildQuerySet({ target: { query: 'big happy contact', confirmed: true, isBrand: true }, candidates, brandOnly: true }).length, 1);
  // Page générique dont la requête cible contient la marque : requête ignorée, mots-clés de l'IA notés
  assert.ok(!buildQuerySet({ target: { query: 'acheter piano yamaha', confirmed: true, isBrand: true }, candidates }).some((entry) => entry.query.includes('yamaha')));
  assert.deepEqual(buildQuerySet({ target, override: ['agence web', 'site vitrine'], candidates }).map((entry) => entry.source), ['manual', 'manual']);
});

test('Requêtes notées : couverture, intention et concurrence moyennées selon le poids', () => {
  assert.equal(weightedAverage([{ weight: 0.5, value: 15 }, { weight: 0.25, value: 5 }, { weight: 0.25, value: null }]), (0.5 * 15 + 0.25 * 5) / 0.75);
  assert.equal(weightedAverage([{ weight: 1, value: null }]), null);
  const serp = (own: string[]) => ({ status: 'DONE', ownUrls: own.map((url, i) => ({ url, position: i + 1 })) }) as unknown as SerpAnalysis;
  assert.equal(cannibalFromSerp(serp(['https://a.fr/page']), 'https://a.fr/page/'), 20);
  assert.equal(cannibalFromSerp(serp(['https://a.fr/autre']), 'https://a.fr/page'), 10);
  assert.equal(cannibalFromSerp(serp(['https://a.fr/1', 'https://a.fr/2', 'https://a.fr/3']), 'https://a.fr/1'), 5);
  assert.equal(cannibalFromSerp(serp([]), 'https://a.fr/page'), null);
});

test('Réécriture : noms et chiffres absents de la page signalés, marqueurs « à compléter » ignorés', () => {
  const source = 'Agence Big Happy à Toulouse depuis 35 ans, 12 experts, trois offres.';
  const found = unverifiedFacts(
    ['Big Happy, 35 ans à Toulouse', 'Une équipe de 40 experts à Lyon', 'Labels [À COMPLÉTER : agréments Qualiopi 2024]', 'Nos 3 offres'],
    source
  );
  assert.deepEqual(found, ['Lyon', '40']);
});

test('Réécriture : seuls les H2 de la page sont réécrits, bandeau de cookies écarté', () => {
  const headings = [
    { level: 2, text: 'Nos   solutions\n  TROIS OUTILS' },
    { level: 3, text: 'Sous-partie' },
    { level: 2, text: 'TRACEURS NON SOUMIS A VOTRE CONSENTEMENT :' }
  ];
  assert.equal(matchHeading('nos solutions trois outils', headings), 'Nos solutions TROIS OUTILS');
  assert.equal(matchHeading('Sous-partie', headings), undefined);
  assert.equal(matchHeading('Traceurs non soumis à votre consentement', headings), undefined);
  assert.equal(matchHeading('Titre inventé', headings), undefined);
});

test('Mots-clés : variantes comptées comme une seule recherche par Google gardées une fois ; marque d’un sous-domaine', () => {
  const monthly = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
  const rows = buildKeywordRows(
    [{ keyword: 'agence de communication', origin: 'target' as const }],
    {
      seeds: [{ keyword: 'agence de communication', avgMonthlySearches: 14800, monthly }],
      ideas: [
        { keyword: 'agence de com communication', avgMonthlySearches: 14800, monthly },
        { keyword: 'agence communication globale', avgMonthlySearches: 300, monthly: monthly.map((v) => v + 1) }
      ]
    },
    { title: '', h1: '', headings: [], text: '' },
    []
  );
  assert.deepEqual(rows.map((row) => row.keyword), ['agence de communication', 'agence communication globale']);
  assert.deepEqual(brandVariants('fr.yamaha.com'), ['yamaha']);
  assert.deepEqual(brandVariants('www.big-happy.fr'), ['big happy', 'bighappy']);
});

test('Requêtes notées : volumes de moins de 20 recherches ignorés (retour à la requête cible)', () => {
  const rows = [{ keyword: 'veille concurrentielle', origin: 'candidate' as const, avgMonthlySearches: 10, presence: { title: false, h1: false, h2: false, text: false }, forSerp: false }];
  const set = buildQuerySet({ target: { query: 'outil intelligence marché', confirmed: true }, research: { provider: 'google-ads', simulated: false, fetchedAt: '', rows } });
  assert.deepEqual(set.map((entry) => entry.query), ['outil intelligence marché']);
});

test('Mots-clés : idée reliée par un seul mot marquée « lien faible », jamais notée d’office', () => {
  const rows = buildKeywordRows(
    [{ keyword: 'intelligence marché', origin: 'core' as const }],
    {
      seeds: [{ keyword: 'intelligence marché', avgMonthlySearches: 10 }],
      ideas: [
        { keyword: 'étude de marché', avgMonthlySearches: 5400 },
        { keyword: 'agence de pub', avgMonthlySearches: 9000 },
        { keyword: 'intelligence de marché', avgMonthlySearches: 300 }
      ]
    },
    { title: '', h1: '', headings: [], text: '' },
    []
  );
  assert.equal(rows.find((row) => row.keyword === 'étude de marché')?.weak, true);
  assert.ok(!rows.some((row) => row.keyword === 'agence de pub'));
  const set = buildQuerySet({ research: { provider: 'google-ads', simulated: false, fetchedAt: '', rows } });
  assert.deepEqual(set.map((entry) => entry.query), ['intelligence de marché']);
  // Version courte sans mot général ni élision
  assert.deepEqual(keywordSeeds({ target: "outil d'intelligence marché", brands: [] }).map((seed) => seed.keyword), ["outil d'intelligence marché", 'intelligence marché']);
});

test('Requêtes notées : avec l’avis de l’IA, seules les recherches auxquelles la page répond sont notées d’office', () => {
  const row = (keyword: string, avgMonthlySearches: number, relevance: 'match' | 'broad' | 'off') => ({
    keyword, origin: 'core' as const, avgMonthlySearches, relevance, presence: { title: false, h1: false, h2: false, text: false }, forSerp: false
  });
  const rows = [row('intelligence artificielle', 201000, 'broad'), row('agence de communication', 14800, 'match'), row('prise en charge', 2900, 'off')];
  const set = buildQuerySet({ research: { provider: 'google-ads', simulated: false, fetchedAt: '', rows } });
  assert.deepEqual(set.map((entry) => entry.query), ['agence de communication']);
  assert.deepEqual(keywordSeeds({ target: 'prise en charge grand âge', brands: [] }).map((seed) => seed.keyword), ['prise en charge grand âge', 'prise en charge', 'prise en charge grand']);
});

test('Mots-clés : « visée » seulement avec une phrase de la page qui reprend les mots de la recherche', () => {
  const page = 'Nos EHPAD accueillent les personnes âgées dépendantes. Accompagnement de la perte d’autonomie au quotidien.';
  assert.equal(matchEvidenceVerified('perte d autonomie', 'Accompagnement de la perte d’autonomie au quotidien.', page), true);
  // Phrase inventée, ou phrase réelle sans les mots de la recherche
  assert.equal(matchEvidenceVerified('aide à domicile', 'Nous proposons de l’aide à domicile.', page), false);
  assert.equal(matchEvidenceVerified('aide à domicile', 'Nos EHPAD accueillent les personnes âgées dépendantes.', page), false);
  // Synonyme : un mot commun suffit (« autonomie »)
  assert.equal(matchEvidenceVerified('maintien de l autonomie', 'Accompagnement de la perte d’autonomie au quotidien.', page), true);
});

test('Points perdus : critères techniques sans les points non mesurés, ramenés sur la note du pilier', () => {
  const breakdown = { coreWebVitals: 10, architecture: 20, crawlability: 15, securityAndHttp: 15, htmlStructure: 8, metadataAndMedia: 5 };
  // Vitesse : 15 pts non mesurés (INP, CLS) sur 25 ; hiérarchie Hn : 7 pts hors score
  const unmeasured = { coreWebVitals: 15, architecture: 0, crawlability: 0, securityAndHttp: 0, htmlStructure: 7, metadataAndMedia: 0 };
  const criteria = techCriteria(breakdown, unmeasured);
  assert.equal(criteria.find((c) => c.key === 'coreWebVitals')?.max, 10);
  assert.equal(criteria.find((c) => c.key === 'htmlStructure')?.max, 8);
  // Seul « Title, méta, alt » perd des points : 5 sur 78 mesurés → 6,4 pts de la note technique
  const losses = pageLosses(criteria);
  assert.deepEqual(losses.map((l) => l.key), ['metadataAndMedia']);
  assert.ok(Math.abs(losses[0].lost - (5 / 78) * 100) < 1e-9);
});

test('Points perdus : gain du site pondéré par les points mesurés, puis par le poids du pilier', () => {
  const page = (earned: number) => editorialCriteria({ hotZones: { earned, max: 15, basis: 'measured' }, goal: { earned: 20, max: 20, basis: 'checklist' } });
  const gains = siteGains([page(5), page(15)]);
  // 10 pts perdus sur 70 mesurés → 14,3 pts de note éditoriale, × le poids du pilier sur la note globale (0,35, ou
  // 0,35 / 0,75 quand le GEO est mis de côté)
  assert.equal(gains.length, 1);
  assert.equal(gains[0].pages, 1);
  assert.ok(Math.abs(gains[0].pillarPoints - (10 / 70) * 100) < 1e-9);
  assert.ok(Math.abs(gains[0].globalPoints - (10 / 70) * 100 * (GEO_ENABLED ? 0.35 : 0.35 / 0.75)) < 1e-9);
});

test('Synthèse : demande de recherche par position (une fois par requête, meilleure position) et état des pages', () => {
  const measure = (query: string, volume: number | undefined, position?: number | null) => ({
    query, weight: 0.5, volume, source: 'volume', confirmed: true, coverage: { score: 10, missing: [] }, intent: 12, cannibal: null,
    ...(position !== undefined ? { position } : {})
  });
  const pillar = (path: string, set: unknown[], scores: [number, number, number]) => ({
    url: `https://a.fr${path}`, path, httpStatus: 200, depth: 1, isPillar: true, isIndexable: true, wordCount: 500, inlinksCount: 3,
    outlinksCount: 3, techScore: scores[0], editorialScore: scores[1], geoScore: scores[2], metricsRaw: null,
    aiEvaluationRaw: JSON.stringify({ editorial: { querySet: set } })
  });
  const pages = [
    pillar('/', [measure('agence web', 6600, 4), measure('site vitrine', 1600)], [85, 55, 70]),
    pillar('/offre/', [measure('agence web', 6600, 12), measure('refonte site', 260, null)], [40, 65, 82])
  ];
  const demand = searchDemandOf(pages as never)!;
  assert.equal(demand.totalQueries, 3);
  assert.deepEqual(demand.buckets.map((b) => [b.key, b.volume]), [['top3', 0], ['top10', 6600], ['top30', 0], ['absent', 260], ['unmeasured', 1600]]);
  assert.deepEqual(demand.opportunities.map((o) => o.query), ['site vitrine', 'refonte site']);
  assert.deepEqual(pageHealthOf(pages as never, true).map((h) => [h.pillar, h.counts.weak, h.counts.medium, h.counts.strong]), [
    ['tech', 1, 0, 1], ['editorial', 1, 1, 0], ...(GEO_ENABLED ? [['geo', 0, 1, 1]] : [])
  ]);
});

test('Recherches hors page : statut calculé par le code (mots de la page, autre page, hors offre, volume, marque d’un tiers)', () => {
  const page = {
    title: 'Veste Maroc – GOFLEX',
    h1: 'Veste Maroc',
    headings: [{ level: 2, text: 'Avis clients' }],
    text: 'Coupe-vent noir à capuche, léger. Pack Supporter : 1 Veste Maroc, 1 Cagoule, 1 Chaîne.'
  };
  const otherPages = [
    { url: 'https://goflexworld.com/products/cagoule', title: 'Cagoule – GOFLEX', h1: 'Cagoule' },
    { url: 'https://goflexworld.com/products/veste-algerie', title: 'Veste Algérie – GOFLEX', h1: 'Veste Algérie' }
  ];
  const volume = (keyword: string, avgMonthlySearches: number, monthly?: number[]) => ({ keyword, avgMonthlySearches, ...(monthly ? { monthly } : {}) });
  const suggestion = (keyword: string, kind: 'attribute' | 'occasion' | 'synonym' | 'product' | 'brand', evidence = '') => ({ keyword, kind, evidence });
  const thirdPartyBrands = brandsFromDomains(['eu.puma.com', 'intersport.fr', 'goflexworld.com', 'veste-maroc.com'], ['goflexworld'], `${page.title} ${page.h1}`);
  assert.deepEqual(thirdPartyBrands, ['puma', 'intersport']);
  const rows = classifyOpportunities({
    suggestions: [
      suggestion('veste du maroc', 'synonym'),
      suggestion('veste maroc noir', 'attribute', 'Coupe-vent noir à capuche'),
      suggestion('veste maroc homme', 'attribute', 'Phrase inventée par le modèle'),
      suggestion('cagoule maroc', 'product'),
      suggestion('veste algérie', 'product'),
      suggestion('survêtement maroc', 'product'),
      suggestion('pack supporter maroc', 'attribute'),
      suggestion('veste maroc puma', 'attribute'),
      suggestion('veste maroc 2026', 'occasion'),
      suggestion('coupe vent femme', 'attribute')
    ],
    volumes: [
      volume('veste maroc noir', 320, [40, 70, 210, 320, 50, 480, 1300, 210, 320, 210, 90, 260]),
      volume('veste maroc homme', 50),
      volume('cagoule maroc', 40),
      volume('veste algérie', 900),
      volume('survêtement maroc', 2900),
      volume('pack supporter maroc', 10),
      volume('veste maroc puma', 500),
      volume('veste maroc 2026', 70, [0, 0, 0, 70, 10, 50, 90, 30, 260, 170, 30, 50]),
      volume('coupe vent femme', 8100)
    ],
    page,
    otherPages,
    known: ['veste maroc', 'coupe vent maroc'],
    thirdPartyBrands,
    subject: 'veste maroc'
  });
  const byKeyword = new Map(rows.map((row) => [row.keyword, row]));
  // Mêmes mots qu'une recherche déjà listée : pas reprise
  assert.ok(!byKeyword.has('veste du maroc'));
  assert.equal(byKeyword.get('veste maroc noir')?.status, 'ready');
  assert.equal(byKeyword.get('veste maroc noir')?.evidence, 'Coupe-vent noir à capuche');
  assert.equal(byKeyword.get('veste maroc noir')?.peakRatio, 4.4);
  assert.equal(byKeyword.get('veste maroc homme')?.status, 'confirm');
  assert.deepEqual(byKeyword.get('veste maroc homme')?.missing, ['homme']);
  // Phrase introuvable dans la page : non reprise
  assert.equal(byKeyword.get('veste maroc homme')?.evidence, undefined);
  assert.equal(byKeyword.get('cagoule maroc')?.status, 'other-page');
  assert.equal(byKeyword.get('cagoule maroc')?.otherPage?.url, 'https://goflexworld.com/products/cagoule');
  assert.equal(byKeyword.get('veste algérie')?.status, 'other-page');
  assert.equal(byKeyword.get('survêtement maroc')?.status, 'off-offer');
  assert.equal(byKeyword.get('pack supporter maroc')?.rejection, 'low-volume');
  assert.equal(byKeyword.get('veste maroc puma')?.rejection, 'third-party-brand');
  assert.equal(byKeyword.get('veste maroc 2026')?.status, 'confirm');
  assert.equal(byKeyword.get('veste maroc 2026')?.recent, true);
  // Moins de 2 mots en commun avec le sujet : plus large, classée après les recherches du sujet malgré son volume
  assert.equal(byKeyword.get('coupe vent femme')?.broad, true);
  assert.equal(byKeyword.get('veste maroc homme')?.broad, undefined);
  assert.deepEqual(rows.filter((row) => row.status === 'confirm').map((row) => row.keyword), ['veste maroc 2026', 'veste maroc homme', 'coupe vent femme']);
  // Ordre : intégrables, à confirmer (par volume), autre page, hors offre, écartées
  assert.deepEqual(rows.map((row) => row.status), ['ready', 'confirm', 'confirm', 'confirm', 'other-page', 'other-page', 'off-offer', 'rejected', 'rejected']);
  assert.deepEqual(seasonalityOf([100, 100, 100, 100, 100, 100]), {});
});

test('Requêtes notées : recherches hors page notées seulement cochées, avec leur volume ; moins de 20 recherches jamais notées sans volume', () => {
  const opportunities = {
    provider: 'google-ads',
    simulated: false,
    fetchedAt: '',
    rows: [
      {
        keyword: 'veste maroc noir', kind: 'attribute' as const, avgMonthlySearches: 320, status: 'ready' as const, missing: [],
        presence: { title: false, h1: false, h2: false, text: true }
      }
    ]
  };
  const research = {
    provider: 'google-ads', simulated: false, fetchedAt: '',
    rows: [
      { keyword: 'veste maroc', origin: 'target' as const, avgMonthlySearches: 1600, presence: { title: true, h1: true, h2: false, text: true }, forSerp: false, relevance: 'match' as const },
      { keyword: 'pack supporter maroc', origin: 'candidate' as const, avgMonthlySearches: 10, presence: { title: false, h1: false, h2: false, text: true }, forSerp: false, relevance: 'match' as const }
    ]
  };
  const target = { query: 'veste maroc', confirmed: true };
  // Choix automatique : la recherche hors page n'entre pas
  assert.deepEqual(buildQuerySet({ target, research, opportunities }).map((entry) => entry.query), ['veste maroc']);
  // Cochée : poids selon les volumes (1 600 et 320), plafonnés à 75 % à deux
  const manual = buildQuerySet({ target, research, opportunities, override: ['veste maroc', 'veste maroc noir'] });
  assert.deepEqual(manual.map((entry) => [entry.query, entry.volume, Math.round(entry.weight * 100)]), [['veste maroc', 1600, 75], ['veste maroc noir', 320, 25]]);
  // Sans volume retenu (aucune recherche « visée » de 20 ou plus) : la recherche connue à 10 par mois n'est pas notée
  const weak = { ...research, rows: research.rows.map((row) => ({ ...row, relevance: 'broad' as const })) };
  const fallback = buildQuerySet({
    target,
    research: weak,
    candidates: [
      { query: 'pack supporter maroc', intent: 'TRANSACTIONAL' as const, suggestedByGoogle: true },
      { query: 'coupe vent à capuche', intent: 'TRANSACTIONAL' as const, suggestedByGoogle: true }
    ]
  });
  assert.deepEqual(fallback.map((entry) => entry.query), ['veste maroc', 'coupe vent à capuche']);
});

test('Réécriture : périmée quand les requêtes notées changent, ancienne proposition comparée sur la principale seule', () => {
  const base = { contentHash: 'h1', family: 'present' as const, principal: 'veste maroc', queries: ['veste maroc', 'veste logo'] };
  assert.equal(isRewriteOutdated(base, { ...base, queries: ['veste logo', 'veste maroc'] }), false);
  assert.equal(isRewriteOutdated(base, { ...base, queries: ['veste maroc', 'veste logo', 'coupe vent maroc'] }), true);
  assert.equal(isRewriteOutdated(base, { ...base, queries: ['veste maroc'] }), true);
  assert.equal(isRewriteOutdated(base, { ...base, family: 'inform' }), true);
  assert.equal(isRewriteOutdated(base, { ...base, contentHash: 'h2' }), true);
  // Proposition d'avant les familles (sans famille enregistrée) : pas périmée pour autant
  const old = { contentHash: 'h1', principal: 'veste maroc' };
  assert.equal(isRewriteOutdated(old, base), false);
  assert.equal(isRewriteOutdated(old, { ...base, principal: 'veste coupe vent' }), true);
});

test('Zones : pays et autre lieu ajoutés à la fin de la recherche, sans doublon ; texte libre nettoyé', () => {
  const maroc: GeoZone = { id: 'pays:MA', kind: 'pays', code: 'MA', name: 'Maroc', label: 'Maroc' };
  const belgique: GeoZone = { id: 'pays:BE', kind: 'pays', code: 'BE', name: 'Belgique', label: 'Belgique' };
  const azur: GeoZone = { id: 'lieu:cote-d-azur', kind: 'lieu', code: "Côte d'Azur", name: "Côte d'Azur", label: "Côte d'Azur" };
  assert.equal(queryForZone('veste maroc', maroc), 'veste maroc');
  assert.equal(queryForZone('veste coupe vent', belgique), 'veste coupe vent belgique');
  assert.equal(queryForZone('agence web', azur), "agence web côte d'azur");
  assert.equal(cleanPlaceName('  Pays   basque '), 'Pays basque');
  assert.equal(cleanPlaceName('<script>'), null);
  assert.equal(cleanPlaceName('x'), null);
  const france: GeoZone = { id: 'pays:FR', kind: 'pays', code: 'FR', name: 'France', label: 'France' };
  const pages = [{ id: 'p1', path: '/contact', address: '12 rue des Lilas 31000 Toulouse' }];
  assert.deepEqual(zoneCoverage(france, pages).map((page) => page.reason), ['adresse']);
  assert.deepEqual(zoneCoverage(maroc, pages), []);
});

test('Carte des zones : distance, villes du rayon (les plus peuplées), contour allégé, couleur selon la position', () => {
  const toulouse = { latitude: 43.6007, longitude: 1.4328 };
  const colomiers = { code: '31149', name: 'Colomiers', departement: '31', latitude: 43.6139, longitude: 1.3367, population: 40882 };
  const blagnac = { code: '31069', name: 'Blagnac', departement: '31', latitude: 43.6455, longitude: 1.3758, population: 27604 };
  const auch = { code: '32013', name: 'Auch', departement: '32', latitude: 43.6465, longitude: 0.5855, population: 22000 };
  assert.ok(Math.abs(distanceKm(toulouse, colomiers) - 7.9) < 0.3);
  const inside = communesInRadius([blagnac, auch, colomiers], toulouse, 20);
  assert.deepEqual(inside.communes.map((commune) => commune.name), ['Colomiers', 'Blagnac']);
  assert.equal(inside.total, 2);
  assert.equal(communesInRadius([blagnac, auch, colomiers], toulouse, 80).total, 3);
  assert.equal(communesInRadius([blagnac, colomiers], toulouse, 20, 1).communes.length, 1);
  const ring: [number, number][] = [[1, 1], [1.00001, 1.00001], [1.5, 1], [1.5, 1.5], [1, 1.5], [1, 1]];
  const light = simplifyRing(ring, 0.001);
  assert.equal(light.length, 5);
  assert.deepEqual(light[0], light[light.length - 1]);
  const base = { measured: 0, visible: 0, packShown: 0, packPresent: 0, packRead: 0 };
  assert.equal(zoneBand(base), 'unmeasured');
  assert.equal(zoneBand({ ...base, measured: 3 }), 'absent');
  assert.equal(zoneBand({ ...base, measured: 3, visible: 1, best: { query: 'q', path: '/', rank: 2 } }), 'top3');
  assert.equal(zoneBand({ ...base, measured: 3, visible: 1, best: { query: 'q', path: '/', rank: 8 } }), 'top10');
  assert.equal(zoneBand({ ...base, measured: 3, visible: 1, best: { query: 'q', path: '/', rank: 17 } }), 'top30');
});

test('Tableau personnalisable : déplacer dans son groupe, épingler, masquer, largeurs bornées, disposition enregistrée remise d’aplomb', () => {
  const columns: TableColumn[] = [
    { id: 'select', label: 'Sélection', width: 56, fixed: true },
    { id: 'url', label: 'URL', width: 300, minWidth: 160 },
    { id: 'role', label: 'Rôle', width: 260 },
    { id: 'tech', label: 'Score', width: 120 },
    { id: 'words', label: 'Texte', width: 120 },
  ];
  const ids = (layout: ReturnType<typeof defaultLayout>) => visibleColumns(layout, columns).map((column) => column.id);
  let layout = defaultLayout(columns);
  assert.deepEqual(ids(layout), ['select', 'url', 'role', 'tech', 'words']);
  layout = moveColumn(layout, 'tech', 0);
  assert.deepEqual(ids(layout), ['select', 'tech', 'url', 'role', 'words']);
  // Épinglée : passe en tête, après les colonnes fixes ; elle ne se déplace qu'au milieu des épinglées
  layout = togglePinned(layout, 'words');
  assert.deepEqual(ids(layout), ['select', 'words', 'tech', 'url', 'role']);
  assert.deepEqual(stickyOffsets(layout, visibleColumns(layout, columns)), { select: 0, words: 56 });
  assert.equal(moveColumn(layout, 'words', 3), layout);
  layout = moveColumn(layout, 'role', 0);
  assert.deepEqual(ids(layout), ['select', 'words', 'role', 'tech', 'url']);
  // Masquée : retirée des épinglées ; la dernière colonne visible ne se masque pas
  layout = toggleHidden(togglePinned(layout, 'url'), 'url');
  assert.deepEqual(layout.pinned, ['words']);
  for (const id of ['role', 'tech', 'words']) layout = toggleHidden(layout, id);
  assert.equal(layout.hidden.length, 3);
  assert.deepEqual(ids(layout), ['select', 'words']);
  assert.equal(clampWidth(columns[1], 40), 160);
  assert.equal(clampWidth(columns[2], 5000), 640);
  // Enregistrement ancien : colonne inconnue retirée, nouvelle colonne ajoutée, largeur bornée, densité inconnue ignorée
  const merged = mergeLayout({ order: ['words', 'ghost', 'url'], hidden: ['url'], pinned: ['url', 'words'], widths: { url: 10 } }, columns);
  assert.deepEqual(merged.order, ['words', 'url', 'role', 'tech']);
  assert.deepEqual(merged.pinned, ['words']);
  assert.equal(merged.widths.url, 160);
  assert.equal(layoutSummary(merged), '3 sur 4 colonnes · 1 épinglée');
});

test('Tableau personnalisable : métriques ajoutables masquées par défaut, nouvelles métriques masquées à la relecture', () => {
  const columns: TableColumn[] = [
    { id: 'url', label: 'URL', width: 300 },
    { id: 'm:lcp', label: 'LCP', width: 120, group: 'Technique', defaultHidden: true },
    { id: 'm:title', label: 'Title', width: 260, group: 'Page', defaultHidden: true },
  ];
  const base = defaultLayout(columns);
  assert.deepEqual(base.hidden, ['m:lcp', 'm:title']);
  assert.deepEqual(visibleColumns(base, columns).map((column) => column.id), ['url']);
  // Enregistrement d'avant l'ajout de « Title » : LCP affichée par l'utilisateur, Title arrive masquée
  const merged = mergeLayout({ order: ['url', 'm:lcp'], hidden: [], pinned: [], widths: {} }, columns);
  assert.deepEqual(merged.order, ['url', 'm:lcp', 'm:title']);
  assert.deepEqual(merged.hidden, ['m:title']);
  assert.deepEqual(visibleColumns(merged, columns).map((column) => column.id), ['url', 'm:lcp']);
});

test('Plan d’action : une tâche par page, vérifiée par le dernier audit ; ordre des colonnes', () => {
  assert.equal(pageKeyOf('https://www.Big-Happy.fr/contact/'), 'big-happy.fr/contact');
  assert.equal(pageKeyOf('https://big-happy.fr/'), 'big-happy.fr/');
  const created = new Date('2026-11-01');
  const audit = { completedAt: new Date('2026-11-05'), pillarChecked: true, detected: true, pageCrawled: true };
  const task = { status: 'DONE' as const, createdAt: created, doneAt: new Date('2026-11-02'), pillar: 'TECH', pageKey: 'big-happy.fr/contact' };
  assert.equal(verificationOf(task, audit), 'still-detected');
  // Terminée après l'audit : l'audit ne pouvait que la relever, rien à signaler
  assert.equal(verificationOf({ ...task, doneAt: new Date('2026-11-08') }, audit), null);
  assert.equal(verificationOf(task, { ...audit, detected: false }), null);
  assert.equal(verificationOf({ ...task, status: 'TODO' }, { ...audit, detected: false }), 'not-detected');
  // Tâche créée après l'audit : il ne l'a pas vérifiée
  assert.equal(verificationOf({ ...task, status: 'TODO', createdAt: new Date('2026-11-06') }, { ...audit, detected: false }), null);
  assert.equal(verificationOf({ ...task, status: 'DOING' }, { ...audit, pageCrawled: false }), 'page-missing');
  // Contenu pas encore analysé (avant le choix des pages stratégiques) : rien à conclure
  assert.equal(verificationOf({ ...task, pillar: 'EDITORIAL', status: 'TODO' }, { ...audit, detected: false, pillarChecked: false }), null);
  assert.deepEqual(reorderColumn(['a', 'b', 'c'], 'x', 'b'), ['a', 'x', 'b', 'c']);
  assert.deepEqual(reorderColumn(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(reorderColumn(['a', 'b'], 'x', null), ['a', 'b', 'x']);
  assert.deepEqual(reorderColumn(['a', 'b'], 'x', 'inconnu'), ['a', 'b', 'x']);
});

test('Réécriture : plan complet de la page, H2 réécrits à leur place, sections ajoutées en fin', () => {
  const rewrite = {
    h1: { current: 'Bienvenue', proposed: 'Agence de communication à Toulouse' },
    sections: [{ current: 'Nos services', proposed: 'Nos services de communication', intro: 'Nous créons vos supports.', why: 'Requête reprise' }],
    newSections: [{ heading: 'Tarifs', intro: '[À COMPLÉTER : fourchette de prix]', why: 'Question fréquente' }]
  };
  const headings = [
    { level: 1, text: 'Bienvenue' },
    { level: 2, text: 'Nos  services' },
    { level: 3, text: 'Identité visuelle' },
    { level: 2, text: 'Gestion des cookies' },
    { level: 2, text: 'Contact' }
  ];
  const outline = rewriteOutline(rewrite, headings);
  assert.deepEqual(
    outline.map((line) => [line.level, line.text, line.status]),
    [
      [1, 'Agence de communication à Toulouse', 'rewritten'],
      [2, 'Nos services de communication', 'rewritten'],
      [3, 'Identité visuelle', 'kept'],
      [2, 'Contact', 'kept'],
      [2, 'Tarifs', 'added']
    ]
  );
  assert.equal(outline[1].current, 'Nos services');
  // Sans titres enregistrés : les H2 réécrits dans l'ordre de la proposition
  assert.deepEqual(rewriteOutline(rewrite).map((line) => line.text), ['Agence de communication à Toulouse', 'Nos services de communication', 'Tarifs']);
  const markdown = rewriteMarkdown({ title: { current: '', proposed: 'T' }, meta: { current: '', proposed: 'M' } }, outline);
  assert.ok(
    markdown.startsWith(
      ['Title : T', 'Méta description : M', '# Agence de communication à Toulouse', '## Nos services de communication', 'Nous créons vos supports.'].join('\n\n')
    )
  );
  assert.ok(markdown.includes('### Identité visuelle'));
});
