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
import { GlobalScoringEngine } from '@/core/domain/scoring/GlobalScoringEngine';
import { evaluateCitability, scoreCitability } from '@/core/domain/scoring/citability';
import { measureHotZones } from '@/core/domain/scoring/hot-zones';
import { classifyPageRole } from '@/core/domain/scoring/page-role';
import { defaultGoal, resolveGoal } from '@/core/domain/scoring/page-goal';
import { evaluateContentQuality, readabilityPoints } from '@/core/domain/scoring/content-quality';
import { GOAL_CHECKS, INTENT_CHECKS, openingQuoteVerified, scoreChecks } from '@/core/domain/scoring/editorial-checks';
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
import { matchHeading, unverifiedFacts } from '@/core/domain/page-rewrite';
import { isArchivePath, resolveCrawlScope } from '@/core/domain/crawl-scope';
import { prioritizeSearches, remainingSearches, resolveSerpBudget } from '@/core/domain/serp-budget';
import { measurementZones, queryForZone, type GeoZone } from '@/core/domain/zones';
import { detectEstablishments, parseAddress, zoneCoverage } from '@/core/domain/local-visibility';
import { classifyResult, interpretSerp } from '@/core/domain/serp-insights';
import type { EditorialEvaluation, NapSignals, RawPageData, SearchInsights, SerpAnalysis, SerpResult } from '@/core/domain/types';

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
      snippet: { score: 50, titleCritique: '', metaCritique: '', suggestedTitle: '', suggestedMeta: '' },
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

test('Éditorial : requête seulement déduite, désormais notée (groupe de requêtes notées), 70 pts mesurés', () => {
  const evaluation = editorialCoverage({ source: 'AUTO', suggestedByGoogle: false });
  assert.equal(evaluation.search!.targetQuery.confidence, 'INFERRED');
  // Les requêtes notées viennent de l'IA qui lit la page ou de Keyword Planner : plus d'exclusion de 30 pts
  assert.equal(evaluation.coverage!.measured, 70);
});

test('Éditorial : requête proposée par Google, confirmée, 70 pts mesurés (E-E-A-T sans objet hors article)', () => {
  const evaluation = editorialCoverage({ source: 'AUTO', suggestedByGoogle: true });
  assert.equal(evaluation.search!.targetQuery.confidence, 'CONFIRMED');
  assert.equal(evaluation.coverage!.measured, 70);
});

test('Éditorial : requête saisie à la main, toujours notée', () => {
  const evaluation = editorialCoverage({ source: 'MANUAL' });
  assert.equal(evaluation.search!.targetQuery.confidence, 'MANUAL');
  assert.equal(evaluation.coverage!.measured, 70);
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

test('Projet : 40 % technique, 35 % éditorial, 25 % GEO', () => {
  const { overallScore } = GlobalScoringEngine.computeProjectScore([
    { techScore: 100, isPillar: true, editorialScore: 0, geoScore: 0 }
  ]);
  assert.equal(overallScore, 40);
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

test('Éditorial : contenu informatif sans auteur ni date, critère retiré du score (70 pts)', () => {
  const { raw, evaluation } = evaluationWithQuery();
  raw.roleOverride = 'informational';
  const result = EditorialScoringEngine.calculate(raw, { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' } } });
  assert.equal(result.evaluation?.coverage?.measured, 70);
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

test('Objectif de la page : déduit du rôle, sauf choix de l’utilisateur', () => {
  assert.equal(defaultGoal('article'), 'cover');
  assert.equal(defaultGoal('informational'), 'cover');
  assert.equal(defaultGoal('offer'), 'convince');
  assert.equal(defaultGoal('home'), 'convince');
  assert.equal(defaultGoal('contact'), 'direct');
  assert.equal(defaultGoal('case'), 'showcase');
  assert.equal(defaultGoal('brand'), 'reassure');
  assert.deepEqual(resolveGoal({ role: 'offer' }), { goal: 'convince', source: 'auto' });
  assert.deepEqual(resolveGoal({ manual: 'direct', role: 'offer' }), { goal: 'direct', source: 'manual' });
});

test('Éditorial : objectif « aller droit au but », le critère de l’objectif sort du score (20 pts de moins)', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  const weak = { ...confirmed, semanticDepth: { ...confirmed.semanticDepth, score: 0, missingKeyEntities: ['palette de couleurs'] } };
  raw.roleOverride = 'offer';
  const covered = EditorialScoringEngine.calculate({ ...raw, goalOverride: 'convince' }, weak);
  const direct = EditorialScoringEngine.calculate({ ...raw, goalOverride: 'direct' }, weak);
  assert.equal(covered.evaluation?.coverage?.measured, 70);
  assert.equal(direct.evaluation?.coverage?.measured, 50);
  assert.ok(direct.score > covered.score);
  assert.equal(direct.issues.some((issue) => issue.code === 'SEMANTIC_GAPS'), false);
});

test('Éditorial : objectif « présenter et convaincre », pistes en information et non en alerte', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  const weak = { ...confirmed, semanticDepth: { ...confirmed.semanticDepth, score: 5, missingKeyEntities: ['références clients nommées'] } };
  raw.roleOverride = 'offer';
  const convince = EditorialScoringEngine.calculate({ ...raw, goalOverride: 'convince' }, weak).issues.find((issue) => issue.code === 'SEMANTIC_GAPS');
  const cover = EditorialScoringEngine.calculate({ ...raw, goalOverride: 'cover' }, weak).issues.find((issue) => issue.code === 'SEMANTIC_GAPS');
  assert.equal(convince?.severity, 'INFO');
  assert.match(convince?.title ?? '', /convaincre/);
  assert.equal(cover?.severity, 'WARNING');
});

test('Éditorial : objectifs convertir, rassurer et raconter, pistes en information avec leur titre', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  const weak = { ...confirmed, semanticDepth: { ...confirmed.semanticDepth, score: 5, missingKeyEntities: ['délai de réponse annoncé'] } };
  raw.roleOverride = 'offer';
  const expected = { convert: /action/, reassure: /rassurer/, showcase: /raconter|réalisation/ } as const;
  for (const goal of ['convert', 'reassure', 'showcase'] as const) {
    const result = EditorialScoringEngine.calculate({ ...raw, goalOverride: goal }, weak);
    const issue = result.issues.find((item) => item.code === 'SEMANTIC_GAPS');
    assert.equal(issue?.severity, 'INFO', goal);
    assert.match(issue?.title ?? '', expected[goal], goal);
    assert.equal(result.evaluation?.coverage?.measured, 70, goal);
  }
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
  assert.equal(EditorialScoringEngine.calculate(raw, confirmed).evaluation?.coverage?.measured, 70);
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
  const result = EditorialScoringEngine.calculate({ ...raw, goalOverride: 'cover', editorialSignals: signals }, { ...confirmed, quality });
  assert.equal(result.evaluation?.coverage?.measured, 70 + 15 + 5);
  assert.equal(result.evaluation?.coverage?.total, 100);
  assert.equal(result.evaluation?.contentQuality?.score, 3);
  // Objectif « présenter et convaincre » : preuves déjà jugées par l'objectif, qualité hors score
  assert.equal(EditorialScoringEngine.calculate({ ...raw, editorialSignals: signals }, { ...confirmed, quality }).evaluation?.contentQuality, undefined);
  // Page de contact : qualité sans objet
  const contact = EditorialScoringEngine.calculate({ ...raw, roleOverride: 'contact', editorialSignals: signals }, { ...confirmed, quality });
  assert.equal(contact.evaluation?.contentQuality, undefined);
});

test('Grilles à cases : chaque grille vaut son barème (15, 10, 20) et seules les cases cochées comptent', () => {
  assert.equal(scoreChecks(INTENT_CHECKS, {}).max, 15);
  for (const checks of Object.values(GOAL_CHECKS)) assert.equal(scoreChecks(checks, {}).max, 20);
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
});

test('Éditorial : grilles cochées par l’IA, note calculée par le code ; ancien palier converti sans grille', () => {
  const { raw, evaluation } = evaluationWithQuery();
  const confirmed = { ...evaluation, search: { ...evaluation.search!, targetQuery: { ...evaluation.search!.targetQuery, source: 'MANUAL' as const } } };
  // Sans grille (analyse antérieure) : intention 20 sur 20 convertie en 15 sur 15
  const legacy = EditorialScoringEngine.calculate(raw, { ...confirmed, intentMatch: { ...confirmed.intentMatch, score: 20 } });
  assert.deepEqual([legacy.evaluation?.points?.intent?.earned, legacy.evaluation?.points?.intent?.basis], [15, 'legacy']);
  const checks = {
    intent: { need: true, format: true, focus: false, audience: true },
    opening: { lead: true, distinct: false, action: true },
    openingQuote: 'Plombier à Lyon, dépannage rapide.',
    goal: { offer: true, proof: false, distinct: true, action: true },
    goalKey: 'convince' as const
  };
  const result = EditorialScoringEngine.calculate(raw, { ...confirmed, checks });
  const points = result.evaluation!.points!;
  assert.deepEqual([points.intent?.earned, points.intent?.basis], [12, 'checklist']);
  assert.equal(points.opening?.earned, 4 + 3);
  assert.equal(points.goal?.earned, 5 + 4 + 5);
  // Grille remplie sous un autre objectif : ancienne note gardée
  const stale = EditorialScoringEngine.calculate({ ...raw, goalOverride: 'convert' }, { ...confirmed, checks });
  assert.equal(stale.evaluation?.points?.goal?.basis, 'legacy');
  // Phrase d'introduction absente de la page : case « lead » refusée
  const fake = EditorialScoringEngine.calculate(raw, { ...confirmed, checks: { ...checks, openingQuote: 'Une phrase inventée de toutes pièces' } });
  assert.equal(fake.evaluation?.points?.opening?.earned, 3);
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
  // Contact (« aller droit au but ») : intention 15 + cannibalisation 10 + zones chaudes 15 + début de page 10
  assert.equal(result.coverage!.measured, 50);
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
