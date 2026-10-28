import type { QueryCandidate, SearchIntent, SerpAnalysis } from '../types';
import { isSameQuery, isUsableSeed, normalizeText } from './autocomplete-relevance';

/**
 * Requêtes candidates d'une page : recherches génériques qu'un prospect taperait sans connaître le site
 * (« agence data Toulouse » plutôt que « big happy »). Une requête qui contient la marque est écartée par le code :
 * le site sort forcément dessus, la mesurer ne prouve rien.
 */

/** Requêtes candidates gardées par page */
export const MAX_QUERY_CANDIDATES = 5;
/** Requêtes mesurées dans Google par page et par lancement */
export const MAX_SERP_QUERIES = 3;

/** La requête contient la marque (mot entier, avec ou sans espace : « big happy », « bighappy ») */
export function containsBrand(query: string, brands: string[]): boolean {
  const padded = ` ${normalizeText(query)} `;
  const compact = normalizeText(query).replace(/ /g, '');
  return brands.some((brand) => padded.includes(` ${brand} `) || (brand.length >= 5 && compact.includes(brand.replace(/ /g, ''))));
}

/**
 * Nettoie les propositions de l'IA : requêtes de 2 à 6 mots porteurs de sens, sans la marque, sans libellé de rubrique,
 * sans doublon (mêmes mots à un près), dans l'ordre de pertinence donné par l'IA.
 */
export function sanitizeCandidates(
  proposals: { query: string; intent: SearchIntent }[],
  brands: string[],
  max = MAX_QUERY_CANDIDATES
): QueryCandidate[] {
  const kept: QueryCandidate[] = [];
  for (const proposal of proposals) {
    const query = proposal.query.replace(/\s+/g, ' ').trim().toLowerCase().split(' ').slice(0, 6).join(' ');
    if (!query || !isUsableSeed(query) || containsBrand(query, brands)) continue;
    if (kept.some((candidate) => isSameQuery(candidate.query, query) || isSameQuery(query, candidate.query))) continue;
    kept.push({ query, intent: proposal.intent });
    if (kept.length >= max) break;
  }
  return kept;
}

/** Propositions de l'IA parmi lesquelles la cible est choisie : au-delà, la requête s'éloigne du sujet de la page */
const TARGET_POOL = 3;

/**
 * Requête cible parmi les candidates : parmi les 3 premières de l'IA, la première que Google suggère (vraie
 * recherche), sinon la première de l'IA
 */
export function chooseTargetQuery(candidates: QueryCandidate[]): QueryCandidate | undefined {
  return candidates.slice(0, TARGET_POOL).find((candidate) => candidate.suggestedByGoogle) ?? candidates[0];
}

/** Requêtes mesurées dans Google : la requête cible, puis les autres candidates (suggérées d'abord) */
export function serpQueriesFor(target: string, candidates: QueryCandidate[], max = MAX_SERP_QUERIES): string[] {
  const ordered = [
    ...candidates.filter((candidate) => candidate.suggestedByGoogle),
    ...candidates.filter((candidate) => !candidate.suggestedByGoogle)
  ].map((candidate) => candidate.query);
  const queries: string[] = [];
  for (const query of [target, ...ordered]) {
    if (!query.trim() || queries.some((kept) => normalizeText(kept) === normalizeText(query))) continue;
    queries.push(query);
    if (queries.length >= max) break;
  }
  return queries;
}

/** Position de la page dans un relevé : à part entière, sinon en lien annexe */
export function pageRank(serp: Pick<SerpAnalysis, 'pagePosition' | 'pageSitelinkOf'>): number | null {
  return serp.pagePosition ?? serp.pageSitelinkOf ?? null;
}

/**
 * Requête cible non confirmée par Google (ni suggérée, ni page trouvée dans les résultats) alors qu'une autre candidate
 * fait sortir la page : la requête de ce relevé (ville comprise) devient la cible (meilleure position). Sinon undefined,
 * la cible reste inchangée.
 */
export function betterMeasuredTarget(
  target: QueryCandidate | undefined,
  measured: SerpAnalysis[],
  candidates: QueryCandidate[]
): string | undefined {
  if (!target || target.suggestedByGoogle) return undefined;
  // Une requête locale est mesurée avec la ville ajoutée : un mot d'écart toléré dans les deux sens
  const same = (a: string, b: string) => isSameQuery(a, b) || isSameQuery(b, a);
  const done = measured.filter((serp) => serp.status === 'DONE');
  const targetSerp = done.find((serp) => same(serp.query, target.query));
  if (!targetSerp || pageRank(targetSerp) !== null) return undefined;
  const best = done
    .filter((serp) => !same(serp.query, target.query) && pageRank(serp) !== null)
    .map((serp) => ({ serp, candidate: candidates.find((candidate) => same(serp.query, candidate.query)) }))
    .filter((entry) => entry.candidate)
    .sort((a, b) => (pageRank(a.serp) ?? 99) - (pageRank(b.serp) ?? 99))[0];
  return best?.serp.query;
}
