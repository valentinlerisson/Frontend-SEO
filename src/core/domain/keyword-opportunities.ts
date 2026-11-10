import type { KeywordVolume } from '../ports/keyword-volume';
import { containsKeyword, GENERIC_TOKENS, keywordPresence, stem, trendOf, type KeywordPresence } from './keyword-research';
import { brandVariants, contentTokens, normalizeText } from './scoring/autocomplete-relevance';
import { containsBrand } from './scoring/query-candidates';
import { MIN_SCORED_VOLUME } from './scoring/query-set';

/**
 * Recherches hors page : quand le contenu d'une page ne donne pas de bonnes recherches à viser, l'IA propose des
 * recherches que les internautes tapent sans qu'elles figurent forcément dans la page ; Keyword Planner donne leur volume
 * et le code dit si la page peut les porter. Lancée par un bouton ; une recherche n'entre dans la note que si
 * l'utilisateur la coche (requêtes notées choisies à la main).
 */

/** Type de recherche donné par l'IA : précision sur le même produit, moment, autre nom, autre produit, marque d'un tiers */
export type OpportunityKind = 'attribute' | 'occasion' | 'synonym' | 'product' | 'brand';
export const OPPORTUNITY_KINDS: OpportunityKind[] = ['attribute', 'occasion', 'synonym', 'product', 'brand'];

/**
 * Statut calculé par le code :
 * - ready : volume suffisant et tous les mots porteurs de sens figurent déjà dans la page ;
 * - confirm : volume suffisant, mais des mots manquent dans la page (« homme », « 2026 ») : à confirmer par l'utilisateur ;
 * - other-page : le sujet est porté par une autre page du site ;
 * - off-offer : autre produit qu'aucune page du site ne porte ;
 * - rejected : volume trop faible ou inconnu, ou marque d'un tiers.
 */
export type OpportunityStatus = 'ready' | 'confirm' | 'other-page' | 'off-offer' | 'rejected';
export type OpportunityRejection = 'low-volume' | 'no-volume' | 'third-party-brand';

/** Recherche proposée par l'IA */
export interface OpportunitySuggestion {
  keyword: string;
  kind: OpportunityKind;
  /** Phrase de la page qui justifie la recherche, selon l'IA (vérifiée par le code) */
  evidence: string;
}

export interface OpportunityRow {
  keyword: string;
  kind: OpportunityKind;
  avgMonthlySearches: number | null;
  /** Concurrence publicitaire (pas la difficulté SEO) */
  competition?: 'LOW' | 'MEDIUM' | 'HIGH';
  trend?: 'up' | 'down' | 'flat';
  /** Mois le plus fort divisé par la moyenne des 12 mois, quand il vaut 2 ou plus : recherche saisonnière */
  peakRatio?: number;
  /** Aucune recherche les 3 premiers des 12 mois : recherche nouvelle, souvent liée à un événement */
  recent?: boolean;
  presence: KeywordPresence;
  status: OpportunityStatus;
  /**
   * Plus large que la page : moins de 2 mots porteurs de sens en commun avec son sujet (requête visée), comme une idée
   * voisine « lien faible » (« coupe vent femme » pour « veste maroc »). Volume souvent fort, mais la page y répond mal.
   */
  broad?: boolean;
  /** Mots porteurs de sens absents de la page */
  missing: string[];
  /** Phrase de la page citée par l'IA, retrouvée mot pour mot */
  evidence?: string;
  /** Page du site qui porte déjà ce sujet (statut other-page) */
  otherPage?: { url: string; title: string };
  rejection?: OpportunityRejection;
  /** Marque d'un tiers repérée dans la recherche (nom de domaine d'un résultat Google) */
  thirdPartyBrand?: string;
}

export interface KeywordOpportunities {
  /** Source des volumes (google-ads, mock) */
  provider: string | null;
  /** Volumes inventés pour tester l'écran : jamais utilisés pour noter */
  simulated: boolean;
  fetchedAt: string;
  /** Modèle qui a proposé les recherches */
  model?: string;
  rows: OpportunityRow[];
}

/** Recherches demandées à l'IA, au plus */
export const MAX_OPPORTUNITIES = 20;
/** Mois le plus fort à partir duquel une recherche est dite saisonnière (fois la moyenne) */
export const SEASONAL_PEAK_RATIO = 2;

const STATUS_ORDER: Record<OpportunityStatus, number> = { ready: 0, confirm: 1, 'other-page': 2, 'off-offer': 3, rejected: 4 };

/** Mêmes mots porteurs de sens, dans n'importe quel ordre (pluriels et mots outils confondus) */
function sameWords(a: string, b: string): boolean {
  const key = (value: string) => [...new Set(contentTokens(value).map(stem))].sort().join(' ');
  return key(a) !== '' && key(a) === key(b);
}

/**
 * Marques des sites présents dans les résultats Google (« eu.puma.com » donne « puma »), sans la marque du site audité ni
 * les mots du Title et du H1 de la page (un domaine « veste-maroc.com » ne fait pas de « veste maroc » une marque).
 */
export function brandsFromDomains(domains: string[], ownBrands: string[], pageHead: string): string[] {
  const head = new Set(contentTokens(pageHead).map(stem));
  const own = new Set(ownBrands.map(normalizeText));
  // Un domaine dont une variante reprend le sujet de la page est écarté en entier (« veste maroc » et « vestemaroc »)
  const brands = domains.filter(Boolean).flatMap((domain) => {
    const variants = brandVariants(domain);
    const excluded = variants.some((brand) => own.has(brand) || contentTokens(brand).some((token) => head.has(stem(token))));
    return excluded ? [] : variants;
  });
  return [...new Set(brands)];
}

/** Saisonnalité tirée des 12 mois : rapport du mois le plus fort à la moyenne, et recherche nouvelle */
export function seasonalityOf(monthly?: number[]): { peakRatio?: number; recent?: boolean } {
  if (!monthly || monthly.length < 6) return {};
  const total = monthly.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return {};
  const ratio = Math.max(...monthly) / (total / monthly.length);
  const first = monthly.slice(0, 3).reduce((sum, value) => sum + value, 0);
  return {
    ...(ratio >= SEASONAL_PEAK_RATIO ? { peakRatio: Math.round(ratio * 10) / 10 } : {}),
    ...(first === 0 ? { recent: true } : {})
  };
}

/**
 * Statut de chaque recherche proposée par l'IA, du plus utile au moins utile puis par volume. Les recherches déjà
 * listées pour la page (mêmes mots) ne sont pas reprises ; deux recherches que Google compte comme une seule (variantes
 * regroupées par Keyword Planner) sont gardées une fois.
 */
export function classifyOpportunities(input: {
  suggestions: OpportunitySuggestion[];
  volumes: KeywordVolume[];
  page: { title?: string | null; h1?: string | null; headings: { level: number; text: string }[]; text: string };
  /** Autres pages du site (traductions de la page exclues) */
  otherPages: { url: string; title?: string | null; h1?: string | null }[];
  /** Recherches déjà listées pour la page : requêtes notées et mots-clés */
  known: string[];
  thirdPartyBrands: string[];
  /** Sujet de la page : sa requête visée, sinon son H1 */
  subject: string;
}): OpportunityRow[] {
  const { page } = input;
  const subjectTokens = new Set(contentTokens(input.subject).map(stem));
  const isBroad = (tokens: string[]) =>
    subjectTokens.size > 0 && tokens.filter((token) => subjectTokens.has(stem(token))).length < Math.min(2, subjectTokens.size);
  const pageText = [page.title, page.h1, ...page.headings.map((h) => h.text), page.text].filter(Boolean).join(' ');
  const pageTokens = new Set(contentTokens(pageText).map(stem));
  const headTokens = new Set(contentTokens(`${page.title ?? ''} ${page.h1 ?? ''}`).map(stem));
  const clean = (value: string) => value.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const cleanPage = clean(pageText);

  const volumeOf = (keyword: string): KeywordVolume | undefined => {
    const key = normalizeText(keyword);
    return input.volumes.find(
      (volume) => normalizeText(volume.keyword) === key || (volume.closeVariants ?? []).some((variant) => normalizeText(variant) === key)
    );
  };

  const rows: OpportunityRow[] = [];
  const usedVolumes = new Set<KeywordVolume>();
  for (const suggestion of input.suggestions) {
    const keyword = suggestion.keyword.replace(/\s+/g, ' ').trim().toLowerCase();
    if (contentTokens(keyword).length === 0) continue;
    if (input.known.some((known) => sameWords(known, keyword)) || rows.some((row) => sameWords(row.keyword, keyword))) continue;
    const volume = volumeOf(keyword);
    if (volume && usedVolumes.has(volume)) continue;
    if (volume) usedVolumes.add(volume);

    const tokens = contentTokens(keyword);
    const missing = tokens.filter((token) => !pageTokens.has(stem(token)));
    const quote = clean(suggestion.evidence ?? '');
    const evidence = quote.length >= 8 && cleanPage.includes(quote) ? suggestion.evidence.trim() : undefined;
    const thirdPartyBrand = input.thirdPartyBrands.find((brand) => containsBrand(keyword, [brand]));
    const searches = volume?.avgMonthlySearches ?? null;

    let status: OpportunityStatus;
    let rejection: OpportunityRejection | undefined;
    let otherPage: OpportunityRow['otherPage'];
    if (thirdPartyBrand || suggestion.kind === 'brand') {
      status = 'rejected';
      rejection = 'third-party-brand';
    } else if (searches === null) {
      status = 'rejected';
      rejection = 'no-volume';
    } else if (searches < MIN_SCORED_VOLUME) {
      status = 'rejected';
      rejection = 'low-volume';
    } else {
      // Mots qui ne sont pas le sujet de la page (absents du Title et du H1) : s'ils font le Title ou le H1 d'une
      // autre page du site, la recherche lui revient (« cagoule maroc » pour la page « Cagoule »)
      const foreign = tokens.filter((token) => !headTokens.has(stem(token)) && !GENERIC_TOKENS.has(stem(token)));
      const other =
        (suggestion.kind === 'product' || missing.length > 0) && foreign.length > 0
          ? input.otherPages.find((candidate) => foreign.every((token) => containsKeyword(`${candidate.title ?? ''} ${candidate.h1 ?? ''}`, token)))
          : undefined;
      if (other) {
        status = 'other-page';
        otherPage = { url: other.url, title: (other.h1 || other.title || other.url).replace(/\s+/g, ' ').trim() };
      } else if (missing.length === 0) status = 'ready';
      else if (suggestion.kind === 'product') status = 'off-offer';
      else status = 'confirm';
    }

    rows.push({
      keyword,
      kind: suggestion.kind,
      avgMonthlySearches: searches,
      ...(volume?.competition ? { competition: volume.competition } : {}),
      ...(trendOf(volume?.monthly) ? { trend: trendOf(volume?.monthly) } : {}),
      ...seasonalityOf(volume?.monthly),
      presence: keywordPresence(keyword, page),
      status,
      ...((status === 'ready' || status === 'confirm') && isBroad(tokens) ? { broad: true } : {}),
      missing,
      ...(evidence ? { evidence } : {}),
      ...(otherPage ? { otherPage } : {}),
      ...(rejection ? { rejection } : {}),
      ...(thirdPartyBrand ? { thirdPartyBrand } : {})
    });
  }
  // Dans un même statut : les recherches du sujet de la page avant les plus larges, puis par volume
  return rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      Number(Boolean(a.broad)) - Number(Boolean(b.broad)) ||
      (b.avgMonthlySearches ?? -1) - (a.avgMonthlySearches ?? -1)
  );
}

/** Recherches que l'utilisateur peut cocher pour noter la page : la page peut les porter (telle quelle ou après confirmation) */
export function isScorableOpportunity(row: OpportunityRow): boolean {
  return row.status === 'ready' || row.status === 'confirm';
}
