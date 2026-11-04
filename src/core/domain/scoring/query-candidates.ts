import type { QueryCandidate, SearchIntent, SerpAnalysis } from '../types';
import { contentTokens, isSameQuery, isUsableSeed, normalizeText, stripPlaces } from './autocomplete-relevance';

/**
 * Requêtes candidates d'une page : recherches génériques qu'un prospect taperait sans connaître le site
 * (« agence data Toulouse » plutôt que « big happy »). Une requête qui contient la marque est écartée par le code :
 * le site sort forcément dessus, la mesurer ne prouve rien.
 */

/** Mots-clés de départ gardés par page (envoyés à Keyword Planner) */
export const MAX_QUERY_CANDIDATES = 12;
/**
 * Version de la consigne qui produit les mots-clés de départ : des candidates d'une version précédente (5 formulations
 * longues, souvent sans volume) ne sont pas reprises, l'IA en propose de nouvelles
 */
export const CANDIDATES_VERSION = 2;

/** Au moins un mot porteur de sens du mot-clé figure dans la page (pluriels confondus) : l'IA n'invente pas de sujet */
export function mentionedInPage(query: string, pageText: string): boolean {
  const stem = (token: string) => (token.length > 3 ? token.replace(/[sx]$/, '') : token);
  const page = new Set(contentTokens(pageText).map(stem));
  return contentTokens(query).some((token) => page.has(stem(token)));
}
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
  max = MAX_QUERY_CANDIDATES,
  places: string[] = []
): QueryCandidate[] {
  const kept: QueryCandidate[] = [];
  for (const proposal of proposals) {
    // Aucun lieu dans une recherche proposée : la zone choisie est ajoutée au moment de la mesure
    const clean = stripPlaces(proposal.query.replace(/\s+/g, ' ').trim().toLowerCase(), places);
    const query = clean.split(' ').slice(0, 6).join(' ');
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

/** Requêtes choisies à la main pour une page avant une mesure Google (proposées gardées et requêtes ajoutées) */
export const MAX_CHOSEN_SERP_QUERIES = 6;

/**
 * Liste de requêtes choisie par l'utilisateur, nettoyée : textes de 120 caractères au plus, espaces réduits, sans
 * doublon (même texte normalisé), dans l'ordre donné, 6 au plus. Mesurées telles quelles : aucun lieu retiré.
 */
export function chosenSerpQueries(raw: unknown, max = MAX_CHOSEN_SERP_QUERIES): string[] {
  if (!Array.isArray(raw)) return [];
  const queries: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const query = value.replace(/\s+/g, ' ').trim();
    if (!query || query.length > 120 || queries.some((kept) => normalizeText(kept) === normalizeText(query))) continue;
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

/**
 * Relevé Google de la requête visée : celui de la cible enregistrée s'il porte sur cette requête, sinon une mesure de
 * la même requête parmi les recherches mesurées (une candidate devenue cible). Requête changée sans nouvelle mesure :
 * aucun relevé, plutôt qu'afficher et compter les résultats d'une autre requête. Mêmes mots à un près dans les deux
 * sens (la ville ajoutée à une requête locale) ; correspondance exacte préférée.
 */
export function serpForQuery(
  target: string | undefined,
  serp: SerpAnalysis | undefined,
  measured: SerpAnalysis[] = []
): SerpAnalysis | undefined {
  if (!target) return undefined;
  const done = [serp, ...measured].filter((item): item is SerpAnalysis => item?.status === 'DONE');
  return (
    done.find((item) => normalizeText(item.query) === normalizeText(target)) ??
    done.find((item) => isSameQuery(item.query, target) || isSameQuery(target, item.query))
  );
}

