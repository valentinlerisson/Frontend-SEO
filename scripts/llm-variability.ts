/**
 * Variabilité du scoring IA : relance l'analyse éditoriale des pages piliers d'un projet plusieurs fois, sans rien
 * enregistrer, et affiche l'écart observé critère par critère.
 *
 *   npm run variability -- big-happy.fr          (3 analyses par pilier, 10 piliers au plus)
 *   npm run variability -- big-happy.fr 5 6      (5 analyses, 6 piliers)
 *
 * Coût : analyses × piliers appels au modèle (30 par défaut). Avec Gemini en offre gratuite (20 requêtes par jour
 * et par modèle), le quota est vite épuisé : préférer un point d'accès compatible OpenAI (LLM_BASE_URL).
 * Les suggestions Google enregistrées sont réutilisées : seule la réponse de l'IA varie. Chaque appel porte un
 * identifiant unique (nonce) : aucun cache (application, routeur OmniRoute, fournisseur) ne peut resservir une réponse.
 * Pour comparer un autre modèle : LLM_MODEL=autre-modele npm run variability -- site.fr
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { llmGateway } from '@/adapters/secondary/llm/llm-gateway';
import { classifyPageRole, resolvePageRole } from '@/core/domain/scoring/page-role';
import { familyOf, subjectGridOf } from '@/core/domain/scoring/page-family';
import { measureHotZones } from '@/core/domain/scoring/hot-zones';
import { INTENT_CHECKS, SUBJECT_CHECKS, openingChecks, openingQuoteVerified, proofQuoteVerified, scoreChecks } from '@/core/domain/scoring/editorial-checks';
import type { EditorialEvaluation, PageFamily, PageRole, RoleSignals } from '@/core/domain/types';

type Snapshot = {
  headings: { level: number; text: string }[];
  excerpt: string;
  hasAuthor: boolean;
  hasPublicationDate: boolean;
  externalAuthoritativeLinksCount: number;
  schemaTypes: string[];
  roleSignals?: RoleSignals;
};

type Context = { role: PageRole; family: PageFamily; content: string };

/** Extraits vérifiés comme dans l'application : introduction dans les 150 premiers mots, preuve n'importe où */
const verifier = (e: EditorialEvaluation, content: string) => (field: 'openingQuote' | 'proofQuote') =>
  field === 'openingQuote' ? openingQuoteVerified(content, e.checks?.openingQuote) : proofQuoteVerified(content, e.checks?.proofQuote);

/**
 * Critères mesurés : les grilles à cases (prompt v12), qui font la note, calculées comme par le moteur ; la
 * cannibalisation estimée (hors note depuis v12) et la citabilité restent suivies pour comparaison. null : critère
 * sans objet ou grille absente pour cette analyse.
 */
const CRITERIA: { name: string; max: number; pick: (e: EditorialEvaluation, ctx: Context) => number | null }[] = [
  { name: 'Intention (grille)', max: 15, pick: (e) => (e.checks ? scoreChecks(INTENT_CHECKS, e.checks.intent).earned : null) },
  // Zones chaudes : mesurées par le code sur la requête retenue, comme dans l'application
  { name: 'Zones chaudes', max: 15, pick: (e) => e.hotZonesOptimization.score },
  {
    name: 'Début de page (grille)',
    max: 10,
    pick: (e, ctx) => (e.checks ? scoreChecks(openingChecks(ctx.role), e.checks.opening, verifier(e, ctx.content)).earned : null)
  },
  {
    name: 'Sujet (grille)',
    max: 20,
    pick: (e, ctx) =>
      e.checks && subjectGridOf(ctx.role) ? scoreChecks(SUBJECT_CHECKS[subjectGridOf(ctx.role)!], e.checks.goal, verifier(e, ctx.content)).earned : null
  },
  { name: 'Cannibalisation (estimée)', max: 20, pick: (e) => e.cannibalizationRisk.score },
  { name: 'Citabilité (GEO)', max: 40, pick: (e) => e.citability?.score ?? 0 }
];

const stdev = (values: number[]) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

async function main() {
  const [domain, runsArg, pagesArg] = process.argv.slice(2);
  if (!domain) throw new Error('Domaine manquant : npm run variability -- site.fr [analyses] [piliers]');
  const runs = Math.max(2, Number(runsArg) || 3);
  const maxPages = Math.max(1, Number(pagesArg) || 10);
  if (!llmGateway.isConfigured()) throw new Error('Aucun fournisseur IA configuré');

  const project = await prisma.project.findFirst({
    where: { domain },
    include: { audits: { orderBy: { createdAt: 'desc' }, take: 1, include: { pages: true } } }
  });
  // Pages notées seulement : une page de contact ou légale n'entre pas dans la note éditoriale
  const pillars = (project?.audits[0]?.pages ?? [])
    .filter((page) => {
      if (!page.isPillar) return false;
      const metrics = JSON.parse(page.metricsRaw || '{}') as { content?: Snapshot; roleOverride?: PageRole };
      const role = resolvePageRole({
        manual: metrics.roleOverride,
        detected: classifyPageRole({ path: page.path, depth: page.depth, wordCount: page.wordCount, ...metrics.content?.roleSignals })
      }).role;
      return familyOf(role) !== 'unscored';
    })
    .slice(0, maxPages);
  if (pillars.length === 0) throw new Error('Aucune page pilier pour ce domaine');
  console.log(`${pillars.length} pilier(s) × ${runs} analyses = ${pillars.length * runs} appels au modèle (${process.env.LLM_MODEL ?? 'modèle par défaut'}, nonce par appel)\n`);

  const spreads: Record<string, number[]> = Object.fromEntries(CRITERIA.map((c) => [c.name, []]));
  for (const page of pillars) {
    const metrics = JSON.parse(page.metricsRaw || '{}') as { content?: Snapshot; roleOverride?: PageRole; keptQuery?: string };
    const stored = JSON.parse(page.aiEvaluationRaw || '{}') as { editorial?: EditorialEvaluation };
    const snapshot = metrics.content;
    if (!snapshot) continue;
    const role = resolvePageRole({
      manual: metrics.roleOverride,
      detected: classifyPageRole({
        path: page.path,
        depth: page.depth,
        wordCount: page.wordCount,
        hasPublicationDate: snapshot.hasPublicationDate,
        schemaTypes: snapshot.schemaTypes,
        ...snapshot.roleSignals
      })
    }).role;
    const manualQuery = page.targetQuerySource === 'MANUAL' && page.targetQuery ? page.targetQuery : undefined;

    const results: EditorialEvaluation[] = [];
    for (let run = 0; run < runs; run++) {
      try {
        results.push(
          await llmGateway.evaluateEditorial({
            url: page.url,
            domain,
            role,
            family: familyOf(role),
            title: page.title ?? undefined,
            metaDescription: page.metaDescription ?? undefined,
            h1: page.h1 ?? undefined,
            headings: snapshot.headings,
            excerpt: snapshot.excerpt,
            wordCount: page.wordCount,
            signals: {
              hasAuthor: snapshot.hasAuthor,
              hasPublicationDate: snapshot.hasPublicationDate,
              externalAuthoritativeLinksCount: snapshot.externalAuthoritativeLinksCount,
              schemaTypes: snapshot.schemaTypes
            },
            manualQuery,
            // Comme l'application : la requête déduite conservée n'est pas redéduite à chaque analyse (à défaut, la
            // dernière requête déduite enregistrée pour la page)
            fixedQuery: manualQuery
              ? undefined
              : (metrics.keptQuery ?? (page.targetQuerySource === 'AUTO' ? page.targetQuery ?? undefined : undefined)),
            nonce: randomUUID(),
            suggestions: stored.editorial?.search?.autocomplete.suggestions ?? [],
            siblingPages: pillars
              .filter((other) => other.id !== page.id)
              .map((other) => ({ url: other.url, title: other.title ?? undefined, h1: other.h1 ?? undefined }))
          })
        );
      } catch (err) {
        console.error(`  échec d'une analyse pour ${page.path} : ${(err as Error).message}`);
      }
    }
    if (results.length < 2) continue;
    // Comme l'application : zones chaudes mesurées sur la requête de chaque analyse
    for (const result of results) {
      const query = result.search?.targetQuery.query ?? '';
      result.hotZonesOptimization.score = measureHotZones(query, {
        title: page.title ?? undefined,
        first100Words: snapshot.excerpt.split(' ').slice(0, 100).join(' '),
        headings: snapshot.headings
      }).score;
    }
    // Contrôle anti-cache : des constats identiques mot pour mot sur toutes les analyses trahiraient une réponse resservie
    const texts = results.map((r) =>
      [r.intentMatch.critique, r.primaryContentTldr.critique, r.semanticDepth.actionableAdvice, r.citability?.critique ?? ''].join('|')
    );
    const identical = texts.every((text) => text === texts[0]);

    console.log(`${page.path}${identical ? '  ⚠ constats identiques mot pour mot : réponse peut-être en cache' : '  (constats rédigés différemment : pas de cache)'}`);
    const queries = new Set(results.map((r) => r.search?.targetQuery.query ?? ''));
    if (queries.size > 1) console.log(`  requête déduite différente selon l'analyse : ${Array.from(queries).join(' | ')}`);
    const ctx: Context = { role, family: familyOf(role), content: snapshot.excerpt };
    console.log(`  famille ${ctx.family}, ${results.filter((r) => r.checks).length}/${results.length} analyses avec grilles`);
    for (const criterion of CRITERIA) {
      const picked = results.map((result) => criterion.pick(result, ctx));
      if (picked.some((value) => value === null)) {
        console.log(`  ${criterion.name.padEnd(26)} sans objet ou grille absente`);
        continue;
      }
      const values = picked as number[];
      const spread = Math.max(...values) - Math.min(...values);
      spreads[criterion.name].push(spread);
      console.log(`  ${criterion.name.padEnd(26)} ${values.join(' / ').padEnd(14)} écart ${spread} sur ${criterion.max}`);
    }
  }

  console.log('\nÉcart moyen et maximal par critère (points) :');
  for (const criterion of CRITERIA) {
    const values = spreads[criterion.name];
    if (values.length === 0) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    console.log(
      `  ${criterion.name.padEnd(26)} moyen ${mean.toFixed(1)} · max ${Math.max(...values)} · écart-type des écarts ${stdev(values).toFixed(1)} (sur ${criterion.max})`
    );
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
