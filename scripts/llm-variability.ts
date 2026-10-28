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
import { measureHotZones } from '@/core/domain/scoring/hot-zones';
import type { EditorialEvaluation, PageRole, RoleSignals } from '@/core/domain/types';

type Snapshot = {
  headings: { level: number; text: string }[];
  excerpt: string;
  hasAuthor: boolean;
  hasPublicationDate: boolean;
  externalAuthoritativeLinksCount: number;
  schemaTypes: string[];
  roleSignals?: RoleSignals;
};

const CRITERIA: { name: string; max: number; pick: (e: EditorialEvaluation) => number }[] = [
  { name: 'Intention', max: 20, pick: (e) => e.intentMatch.score },
  { name: 'Cannibalisation', max: 20, pick: (e) => e.cannibalizationRisk.score },
  // Zones chaudes : mesurées par le code sur la requête retenue, comme dans l'application
  { name: 'Zones chaudes', max: 15, pick: (e) => e.hotZonesOptimization.score },
  { name: 'Réponse / valeur', max: 15, pick: (e) => e.primaryContentTldr.score },
  { name: 'Couverture', max: 20, pick: (e) => e.semanticDepth.score },
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
  const pillars = (project?.audits[0]?.pages ?? []).filter((page) => page.isPillar).slice(0, maxPages);
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
    for (const criterion of CRITERIA) {
      const values = results.map(criterion.pick);
      const spread = Math.max(...values) - Math.min(...values);
      spreads[criterion.name].push(spread);
      console.log(`  ${criterion.name.padEnd(18)} ${values.join(' / ').padEnd(14)} écart ${spread} sur ${criterion.max}`);
    }
  }

  console.log('\nÉcart moyen et maximal par critère (points) :');
  for (const criterion of CRITERIA) {
    const values = spreads[criterion.name];
    if (values.length === 0) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    console.log(
      `  ${criterion.name.padEnd(18)} moyen ${mean.toFixed(1)} · max ${Math.max(...values)} · écart-type des écarts ${stdev(values).toFixed(1)} (sur ${criterion.max})`
    );
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
