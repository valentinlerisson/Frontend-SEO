import type { QueryCandidate, SerpAnalysis } from '../types';
import type { KeywordResearch } from '../keyword-research';
import { swapsOneWord } from '../keyword-research';
import { isSameQuery, normalizeText } from './autocomplete-relevance';

/**
 * Requêtes notées d'une page : la note ne repose plus sur une seule requête mais sur un groupe de 4 recherches au
 * plus, pondérées par leur volume (Keyword Planner). Couverture, intention et concurrence entre pages sont calculées
 * pour chaque requête puis moyennées selon ces poids.
 *
 * Formation du groupe, dans l'ordre :
 * 1. page de contact ou utilitaire : la requête de marque seule ;
 * 2. choix de l'utilisateur (requêtes cochées ou ajoutées) ;
 * 3. vrais volumes : les 4 recherches les plus tapées (20 par mois au moins) auxquelles la page répond selon l'IA, sans
 *    variante d'une requête déjà retenue ;
 * 4. sans vrais volumes : les 3 premiers mots-clés choisis par l'IA en lisant la page, à poids égal.
 * Des volumes simulés ne servent jamais à noter.
 */

export const MAX_QUERY_SET = 4;
/** Requêtes notées choisies à la main : autant que de requêtes mesurables dans Google par page */
export const MAX_MANUAL_QUERY_SET = 6;
/** Volume minimal pour noter une requête : « 10 » est le plus petit palier de Google, trop imprécis */
export const MIN_SCORED_VOLUME = 20;
/** Poids maximal d'une requête dans un groupe de 3 ou plus : une recherche très générale n'écrase pas les autres */
export const WEIGHT_CAP = 0.5;
/** Requêtes notées sans volume connu : les premiers mots-clés de l'IA */
export const FALLBACK_QUERY_SET = 3;
/** Poids maximal dans un groupe de 2 */
export const WEIGHT_CAP_PAIR = 0.75;

export type QuerySetSource = 'volume' | 'target' | 'candidate' | 'manual';

export interface QuerySetEntry {
  query: string;
  /** Part de la note, de 0 à 1 ; la somme du groupe vaut 1 */
  weight: number;
  volume?: number;
  source: QuerySetSource;
  /** Vraie recherche : volume Keyword Planner, suggestion Google, saisie ou requête confirmée */
  confirmed: boolean;
}

/** Mesures par requête, enregistrées avec l'analyse */
export interface QuerySetMeasure extends QuerySetEntry {
  /** Requête dans le Title, le début du texte et les sous-titres (sur 15) et zones où elle manque */
  coverage: { score: number; missing: string[] };
  /** Grille d'intention de l'IA pour cette requête (sur 15) ; null : pas encore jugée */
  intent: number | null;
  /** Cases de la grille d'intention cochées et non cochées pour cette requête */
  intentPassed?: string[];
  intentFailed?: string[];
  /** Concurrence entre les pages du site mesurée dans Google (sur 20) ; null : pas de mesure exploitable */
  cannibal: number | null;
  /** Position de la page dans le dernier relevé de cette requête */
  position?: number | null;
}

/**
 * Poids proportionnels aux valeurs, plafonnés (50 % dans un groupe de 3 ou plus, 75 % dans un groupe de 2) ; le
 * surplus est redistribué aux autres au prorata. Valeurs toutes nulles : poids égaux.
 */
export function cappedWeights(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const cap = n >= 3 ? WEIGHT_CAP : WEIGHT_CAP_PAIR;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return values.map(() => 1 / n);
  const weights = values.map((value) => Math.max(0, value) / total);
  const fixed = new Set<number>();
  for (let round = 0; round < n; round++) {
    const over = weights.map((weight, i) => (weight > cap + 1e-9 && !fixed.has(i) ? i : -1)).filter((i) => i >= 0);
    if (over.length === 0) break;
    over.forEach((i) => {
      weights[i] = cap;
      fixed.add(i);
    });
    const rest = 1 - fixed.size * cap;
    const freeTotal = values.reduce((sum, value, i) => (fixed.has(i) ? sum : sum + Math.max(0, value)), 0);
    weights.forEach((_, i) => {
      if (!fixed.has(i)) weights[i] = freeTotal > 0 ? (rest * Math.max(0, values[i])) / freeTotal : rest / (n - fixed.size);
    });
  }
  return weights;
}

/** Deux recherches presque identiques : un mot ajouté (dans un sens ou l'autre) ou un mot remplacé */
function near(a: string, b: string): boolean {
  return isSameQuery(a, b) || isSameQuery(b, a) || swapsOneWord(a, b);
}

function realVolumes(research?: KeywordResearch): KeywordResearch | undefined {
  return research?.provider && !research.simulated && !research.error ? research : undefined;
}

export function buildQuerySet(input: {
  target?: { query: string; confirmed: boolean; isBrand?: boolean };
  research?: KeywordResearch;
  candidates?: QueryCandidate[];
  /** Requêtes choisies par l'utilisateur (cochées ou ajoutées) */
  override?: string[];
  /** Page de contact ou utilitaire : on y cherche le site par son nom */
  brandOnly?: boolean;
}): QuerySetEntry[] {
  const given = input.target?.query.trim() ? input.target : undefined;
  if (given && input.brandOnly) {
    return [{ query: given.query, weight: 1, source: 'target', confirmed: given.confirmed }];
  }
  // Page générique dont la requête cible contient la marque (ancienne déduction) : elle n'est pas notée, le site sort
  // forcément dessus
  const target = given && !given.isBrand ? given : undefined;
  const research = realVolumes(input.research);
  const volumeOf = (query: string) =>
    research?.rows.find((row) => normalizeText(row.keyword) === normalizeText(query))?.avgMonthlySearches ?? undefined;
  const sourceOf = (query: string, fallback: QuerySetSource): QuerySetSource =>
    target && normalizeText(target.query) === normalizeText(query) ? 'target' : fallback;

  const override = (input.override ?? []).map((query) => query.trim()).filter(Boolean).slice(0, MAX_MANUAL_QUERY_SET);
  if (override.length > 0) {
    const volumes = override.map(volumeOf);
    const weights = volumes.every((volume) => (volume ?? 0) > 0) ? cappedWeights(volumes as number[]) : override.map(() => 1 / override.length);
    return override.map((query, i) => ({
      query,
      weight: weights[i],
      ...(volumes[i] !== undefined ? { volume: volumes[i] as number } : {}),
      source: 'manual' as const,
      confirmed: true
    }));
  }

  if (research) {
    const picked: { query: string; volume: number }[] = [];
    // Avis de l'IA disponible : seules les recherches auxquelles la page répond sont notées d'office ; sinon, les idées
    // reliées à la page par un seul mot sont écartées
    const judged = research.rows.some((row) => row.relevance !== undefined);
    for (const row of [...research.rows].sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0))) {
      if (judged ? row.relevance !== 'match' : row.weak) continue;
      if ((row.avgMonthlySearches ?? 0) < MIN_SCORED_VOLUME || picked.length >= MAX_QUERY_SET) continue;
      if (picked.some((kept) => near(kept.query, row.keyword))) continue;
      picked.push({ query: row.keyword, volume: row.avgMonthlySearches as number });
    }
    if (picked.length > 0) {
      const weights = cappedWeights(picked.map((item) => item.volume));
      return picked.map((item, i) => ({ query: item.query, weight: weights[i], volume: item.volume, source: sourceOf(item.query, 'volume'), confirmed: true }));
    }
  }

  // Sans volume : les premiers mots-clés choisis par l'IA en lisant la page (la requête cible en tête), à poids égal
  const entries: Omit<QuerySetEntry, 'weight'>[] = target ? [{ query: target.query, source: 'target', confirmed: true }] : [];
  for (const candidate of input.candidates ?? []) {
    if (entries.length >= FALLBACK_QUERY_SET) break;
    if (entries.some((entry) => near(entry.query, candidate.query))) continue;
    entries.push({ query: candidate.query, source: 'candidate', confirmed: true });
  }
  return entries.map((entry) => ({ ...entry, weight: 1 / entries.length }));
}

/** Moyenne pondérée des valeurs connues ; les poids des valeurs absentes sont répartis sur les autres */
export function weightedAverage(items: { weight: number; value: number | null }[]): number | null {
  const known = items.filter((item): item is { weight: number; value: number } => item.value !== null);
  const total = known.reduce((sum, item) => sum + item.weight, 0);
  return total > 0 ? known.reduce((sum, item) => sum + item.weight * item.value, 0) / total : null;
}

/**
 * Concurrence entre les pages du site d'après un relevé Google (sur 20) : trois pages ou plus du site = 5, deux = 10,
 * une autre page du site à la place de celle-ci = 10, seule cette page = 20. Aucune page du site : non mesurable (null).
 */
export function cannibalFromSerp(serp: SerpAnalysis | undefined, pageUrl: string): number | null {
  if (!serp || serp.status !== 'DONE') return null;
  const key = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  const others = serp.ownUrls.filter((own) => key(own.url) !== key(pageUrl));
  if (serp.ownUrls.length >= 3) return 5;
  if (serp.ownUrls.length === 2) return 10;
  if (others.length === 1) return 10;
  if (serp.ownUrls.length === 1) return 20;
  return null;
}
