/**
 * Tests des moteurs de score : vérifient que le code applique les règles décrites dans docs/tableau-metriques.md.
 *   npm run test:scoring
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNap, napMeasuredPoints } from '@/core/domain/scoring/nap';
import { GeoScoringEngine, geoMeasuredPoints } from '@/core/domain/scoring/GeoScoringEngine';
import { EditorialScoringEngine } from '@/core/domain/scoring/EditorialScoringEngine';
import { buildSerpAnalysis } from '@/core/domain/scoring/serp-analysis';
import { TechScoringEngine } from '@/core/domain/scoring/TechScoringEngine';
import { GlobalScoringEngine } from '@/core/domain/scoring/GlobalScoringEngine';
import { evaluateCitability, scoreCitability } from '@/core/domain/scoring/citability';
import { measureHotZones } from '@/core/domain/scoring/hot-zones';
import type { EditorialEvaluation, NapSignals, RawPageData, SearchInsights, SerpResult } from '@/core/domain/types';

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

test('Éditorial : requête seulement déduite, intention et zones chaudes (35 pts) hors dénominateur', () => {
  const evaluation = editorialCoverage({ source: 'AUTO', suggestedByGoogle: false });
  assert.equal(evaluation.search!.targetQuery.confidence, 'INFERRED');
  assert.equal(evaluation.coverage!.measured, 55);
});

test('Éditorial : requête proposée par Google, confirmée, 90 pts mesurés (E-E-A-T sans objet hors article)', () => {
  const evaluation = editorialCoverage({ source: 'AUTO', suggestedByGoogle: true });
  assert.equal(evaluation.search!.targetQuery.confidence, 'CONFIRMED');
  assert.equal(evaluation.coverage!.measured, 90);
});

test('Éditorial : requête saisie à la main, toujours notée', () => {
  const evaluation = editorialCoverage({ source: 'MANUAL' });
  assert.equal(evaluation.search!.targetQuery.confidence, 'MANUAL');
  assert.equal(evaluation.coverage!.measured, 90);
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
