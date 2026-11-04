import type { KeywordIdeasResult, KeywordVolume } from '../ports/keyword-volume';
import { contentTokens, isSameQuery, isUsableSeed, normalizeText, stripBrand, stripPlaces } from './scoring/autocomplete-relevance';
import { containsBrand } from './scoring/query-candidates';

/**
 * Mots-clés d'une page avec leur volume de recherche : graines tirées de la page et des recherches déjà connues,
 * enrichies par l'outil de planification (Google Ads Keyword Planner), puis repérées dans le Title, le H1, les
 * sous-titres et le texte. Les mieux placés en volume partent dans l'onglet Positionnement. N'entre pas dans la note.
 */

/** D'où vient le mot-clé : requête visée, recherche proposée, titres de la page, version courte d'un des précédents, ou idée de l'outil */
export type KeywordOrigin = 'target' | 'candidate' | 'page' | 'core' | 'idea';

export interface KeywordSeed {
  keyword: string;
  origin: KeywordOrigin;
}

export type KeywordRelevance = 'match' | 'broad' | 'off';

/** Mots-clés soumis à l'avis de l'IA : ceux qui ont un volume exploitable, les plus recherchés d'abord */
export const MAX_JUDGED_KEYWORDS = 25;

export interface KeywordPresence {
  title: boolean;
  h1: boolean;
  h2: boolean;
  text: boolean;
}

export interface KeywordRow {
  keyword: string;
  origin: KeywordOrigin;
  avgMonthlySearches: number | null;
  competition?: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Évolution sur 12 mois : 3 derniers mois comparés aux 3 premiers (écart de 20 % ou plus) */
  trend?: 'up' | 'down' | 'flat';
  presence: KeywordPresence;
  /** Proposé dans l'onglet Positionnement (meilleurs volumes) */
  forSerp: boolean;
  /** Idée voisine reliée à la page par un seul mot : montrée, mais notée seulement si l'utilisateur la coche */
  weak?: boolean;
  /**
   * Avis de l'IA sur la recherche : la page y répond (match), recherche plus large ou voisine (broad), hors sujet (off).
   * Absent : pas d'avis (IA indisponible) ; seules les recherches « match » sont notées d'office.
   */
  relevance?: KeywordRelevance;
}

export interface KeywordResearch {
  /** Source des volumes (google-ads, mock) ; aucune source : volumes inconnus */
  provider: string | null;
  /** Volumes inventés pour tester l'écran (source de démonstration) : jamais présentés comme réels */
  simulated: boolean;
  fetchedAt: string;
  /** Source configurée mais en échec : message affiché, la liste reste disponible sans volumes */
  error?: string;
  /** Dernière actualisation en échec : volumes précédents gardés (message affiché) */
  warning?: string;
  rows: KeywordRow[];
}

/** Graines envoyées à l'outil */
export const MAX_KEYWORD_SEEDS = 20;
/** Graines complètes gardées avant d'ajouter leurs versions courtes */
const MAX_FULL_SEEDS = 12;
/** Idées voisines gardées en plus des graines */
export const MAX_KEYWORD_IDEAS = 8;
/** Mots-clés proposés dans l'onglet Positionnement */
export const KEYWORDS_FOR_SERP = 3;

/**
 * Titre de page qui n'est pas une recherche : phrase adressée au lecteur (pronoms) ou bandeau de cookies
 * (« ils parlent de nous », « traceurs non soumis à votre consentement »)
 */
const NOT_A_SEARCH = /(^| )(je|j|tu|il|ils|elle|elles|on|nous|vous|notre|nos|votre|vos|leur|leurs|cookies?|traceurs?|consentement)( |$)/;

/** Parties d'un Title ou d'un H1 séparées par | – — : ou « - » */
function segments(value?: string | null): string[] {
  return (value ?? '').split(/\s*[|–—:]\s*|\s+-\s+/).map((part) => part.trim()).filter(Boolean);
}

/**
 * Graines d'une page, dans l'ordre de confiance : requête visée, recherches proposées, puis Title, H1 et H2. Sans marque
 * ni lieu, de 2 à 6 mots porteurs de sens, sans doublon (mêmes mots normalisés). Les suggestions Google n'en font pas
 * partie : elles ajoutent des villes au hasard et des sujets voisins ; les idées de l'outil jouent ce rôle.
 */
export function keywordSeeds(input: {
  target?: string;
  candidates?: string[];
  title?: string | null;
  h1?: string | null;
  headings?: { level: number; text: string }[];
  brands: string[];
  places?: string[];
}): KeywordSeed[] {
  const places = input.places ?? [];
  const raw: KeywordSeed[] = [
    ...(input.target ? [{ keyword: input.target, origin: 'target' as const }] : []),
    ...(input.candidates ?? []).map((keyword) => ({ keyword, origin: 'candidate' as const })),
    ...[...segments(input.title), ...segments(input.h1), ...(input.headings ?? []).filter((h) => h.level === 2).map((h) => h.text)].map(
      (keyword) => ({ keyword, origin: 'page' as const })
    )
  ];
  const seeds: KeywordSeed[] = [];
  const keyOf = (value: string) => contentTokens(value).map(stem).sort().join(' ');
  for (const seed of raw) {
    const clean = stripPlaces(stripBrand(seed.keyword, input.brands), places).replace(/\s+/g, ' ').trim().toLowerCase();
    const words = clean.split(' ');
    if (!clean || words.length > 6 || !isUsableSeed(clean) || containsBrand(clean, input.brands)) continue;
    if (seed.origin === 'page' && NOT_A_SEARCH.test(normalizeText(clean))) continue;
    if (seeds.some((kept) => keyOf(kept.keyword) === keyOf(clean))) continue;
    seeds.push({ keyword: clean, origin: seed.origin });
    if (seeds.length >= MAX_FULL_SEEDS) break;
  }
  // Versions courtes (2 puis 3 mots principaux) : une formulation longue (« outil d'intelligence marché ») n'a souvent
  // aucun volume ni idée voisine, sa version courte (« intelligence marché ») en a
  const cores: KeywordSeed[] = [];
  for (const seed of seeds) {
    // Mots trop généraux retirés en tête (« outil d'intelligence marché » donne « intelligence marché ») ; les petits
    // mots du milieu sont gardés (« prise en charge », pas « prise charge »)
    const words = seed.keyword.split(' ');
    const isMeaningful = (word: string) => contentTokens(word).length > 0;
    const isDropped = (word: string) => isMeaningful(word) && contentTokens(word).every((token) => CORE_DROP.has(stem(token)));
    let start = 0;
    while (start < words.length && (!isMeaningful(words[start]) || isDropped(words[start]))) start++;
    for (const size of [2, 3]) {
      const picked: string[] = [];
      let count = 0;
      for (const word of words.slice(start)) {
        if (count >= size) break;
        picked.push(word);
        if (isMeaningful(word)) count++;
      }
      if (count < size) continue;
      // Élision retirée en tête : « d'intelligence » devient « intelligence »
      picked[0] = picked[0].replace(/^(?:[ldjmnstc]|qu)['’]/i, '');
      const core = picked.join(' ');
      if (!isUsableSeed(core) || [...seeds, ...cores].some((kept) => keyOf(kept.keyword) === keyOf(core))) continue;
      cores.push({ keyword: core, origin: 'core' });
    }
  }
  return [...seeds, ...cores].slice(0, MAX_KEYWORD_SEEDS);
}

/** Mots trop généraux pour relier à eux seuls une idée voisine à la page (racines, sans accents) */
const GENERIC_TOKENS = new Set([
  'agence', 'site', 'service', 'entreprise', 'solution', 'offre', 'conseil', 'groupe', 'societe', 'cabinet', 'prestation',
  'prix', 'devis', 'avi', 'gratuit', 'ligne', 'france', 'outil', 'plateforme', 'logiciel', 'meilleur', 'definition', 'exemple'
]);

/** Mots retirés d'une version courte : ils n'apportent pas de sujet (« outil d'intelligence marché » donne « intelligence marché ») */
const CORE_DROP = new Set(['outil', 'plateforme', 'logiciel', 'solution', 'demande', 'demo', 'decouvrir', 'nouveau', 'nouvelle', 'meilleur']);

/** Racine grossière : pluriels en s / x confondus avec le singulier (comme les zones chaudes) */
const stem = (token: string) => (token.length > 3 ? token.replace(/[sx]$/, '') : token);

/** Tous les mots porteurs de sens du mot-clé figurent dans le texte (ordre libre, pluriels confondus) */
export function containsKeyword(text: string, keyword: string): boolean {
  const tokens = contentTokens(keyword).map(stem);
  if (tokens.length === 0) return false;
  const present = new Set(contentTokens(text).map(stem));
  return tokens.every((token) => present.has(token));
}

export function keywordPresence(
  keyword: string,
  page: { title?: string | null; h1?: string | null; headings: { level: number; text: string }[]; text: string }
): KeywordPresence {
  return {
    title: containsKeyword(page.title ?? '', keyword),
    h1: containsKeyword(page.h1 ?? '', keyword),
    h2: page.headings.some((h) => (h.level === 2 || h.level === 3) && containsKeyword(h.text, keyword)),
    text: containsKeyword(page.text, keyword)
  };
}

export function trendOf(monthly?: number[]): KeywordRow['trend'] {
  if (!monthly || monthly.length < 6) return undefined;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const first = sum(monthly.slice(0, 3));
  const last = sum(monthly.slice(-3));
  if (first === 0) return last > 0 ? 'up' : 'flat';
  const change = (last - first) / first;
  return change >= 0.2 ? 'up' : change <= -0.2 ? 'down' : 'flat';
}

/**
 * Tableau des mots-clés : graines avec leur volume (variantes regroupées par l'outil comprises), puis les idées
 * voisines qui partagent un mot avec une graine, classées par volume. Les 3 meilleurs volumes (supérieurs à 0, sans
 * variante d'une requête déjà retenue) sont proposés dans Positionnement ; sans volume, aucun n'est proposé et le choix habituel s'applique.
 */
export function buildKeywordRows(
  seeds: KeywordSeed[],
  result: KeywordIdeasResult | null,
  page: { title?: string | null; h1?: string | null; headings: { level: number; text: string }[]; text: string },
  brands: string[]
): KeywordRow[] {
  const volumes = result?.seeds ?? [];
  const volumeOf = (keyword: string): KeywordVolume | undefined => {
    const key = normalizeText(keyword);
    return volumes.find(
      (volume) => normalizeText(volume.keyword) === key || (volume.closeVariants ?? []).some((variant) => normalizeText(variant) === key)
    );
  };
  const toRow = (keyword: string, origin: KeywordOrigin, volume?: KeywordVolume): KeywordRow => ({
    keyword,
    origin,
    avgMonthlySearches: volume?.avgMonthlySearches ?? null,
    ...(volume?.competition ? { competition: volume.competition } : {}),
    ...(trendOf(volume?.monthly) ? { trend: trendOf(volume?.monthly) } : {}),
    presence: keywordPresence(keyword, page),
    forSerp: false
  });

  // Idée voisine : au moins 2 mots porteurs de sens en commun avec une même graine, ou un seul s'il n'est pas un mot
  // trop général (« étude de marché » pour « intelligence marché » ; pas « agence de pub » pour « agence de communication »)
  const tokensOf = (value: string) => new Set(contentTokens(value).map(stem));
  const seedTokenSets = seeds.map((seed) => tokensOf(seed.keyword));
  const strength = (keyword: string): 'strong' | 'weak' | null => {
    const tokens = [...tokensOf(keyword)];
    let best: 'strong' | 'weak' | null = null;
    for (const set of seedTokenSets) {
      const shared = tokens.filter((token) => set.has(token));
      if (shared.length >= Math.min(2, tokens.length)) return 'strong';
      if (shared.some((token) => !GENERIC_TOKENS.has(token))) best = 'weak';
    }
    return best;
  };
  const seedEntries = seeds.map((seed) => ({ row: toRow(seed.keyword, seed.origin, volumeOf(seed.keyword)), volume: volumeOf(seed.keyword) }));
  const ideaEntries = (result?.ideas ?? [])
    .filter((idea) => isUsableSeed(idea.keyword) && !containsBrand(idea.keyword, brands) && strength(idea.keyword) !== null)
    .filter((idea) => !seedEntries.some((entry) => normalizeText(entry.row.keyword) === normalizeText(idea.keyword)))
    .slice(0, MAX_KEYWORD_IDEAS)
    .map((idea) => ({
      row: { ...toRow(idea.keyword, 'idea', idea), ...(strength(idea.keyword) === 'weak' ? { weak: true } : {}) },
      volume: idea as KeywordVolume | undefined
    }));

  // Variantes que Google compte comme une seule recherche (« agence de com », « agence de pub » : mêmes chiffres mois
  // par mois) : une seule ligne gardée, la graine d'abord
  const signatures = new Set<string>();
  const unique = [...seedEntries, ...ideaEntries].filter(({ volume }) => {
    if (!volume?.monthly?.length || !volume.avgMonthlySearches) return true;
    const signature = `${volume.avgMonthlySearches}|${volume.monthly.join(',')}`;
    if (signatures.has(signature)) return false;
    signatures.add(signature);
    return true;
  });

  const rows = unique.map((entry) => entry.row).sort(
    (a, b) => (b.avgMonthlySearches ?? -1) - (a.avgMonthlySearches ?? -1) || Number(b.origin === 'target') - Number(a.origin === 'target')
  );
  // Variante qui ajoute ou change un mot d'une requête déjà retenue (« agence web prix » après « agence web » ou
  // « agence web devis ») : presque les mêmes résultats Google, elle n'est pas proposée
  const target = seeds.find((seed) => seed.origin === 'target')?.keyword;
  const picked: string[] = [];
  for (const row of rows) {
    if (picked.length >= KEYWORDS_FOR_SERP || (row.avgMonthlySearches ?? 0) <= 0) continue;
    const near = [...picked, ...(target && row.keyword !== target ? [target] : [])];
    if (near.some((kept) => isSameQuery(kept, row.keyword) || swapsOneWord(kept, row.keyword))) continue;
    row.forSerp = true;
    picked.push(row.keyword);
  }
  return rows;
}

/** Mêmes mots à un mot remplacé près (« agence web prix » et « agence web devis »), au moins deux mots en commun */
export function swapsOneWord(a: string, b: string): boolean {
  const left = contentTokens(a).map(stem);
  const right = contentTokens(b).map(stem);
  const common = left.filter((token) => right.includes(token)).length;
  return left.length === right.length && common >= 2 && common === left.length - 1;
}

/**
 * Preuve d'une recherche « visée » : la phrase citée par l'IA figure mot pour mot dans la page et partage au moins un mot
 * porteur de sens avec la recherche (pluriels confondus) ; un synonyme reste possible (« étude de marché » prouvée par
 * « données de marché »). Sinon la recherche passe en « plus large ».
 */
export function matchEvidenceVerified(keyword: string, evidence: string, pageText: string): boolean {
  const clean = (value: string) => value.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const quote = clean(evidence);
  if (quote.length < 8 || !clean(pageText).includes(quote)) return false;
  const tokens = contentTokens(keyword).map(stem);
  const inQuote = new Set(contentTokens(quote).map(stem));
  return tokens.some((token) => inQuote.has(token));
}

/** Mots-clés proposés dans l'onglet Positionnement, du plus recherché au moins recherché */
export function keywordsForSerp(research?: KeywordResearch): string[] {
  return (research?.rows ?? []).filter((row) => row.forSerp).map((row) => row.keyword);
}
