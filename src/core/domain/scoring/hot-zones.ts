import { contentTokens } from './autocomplete-relevance';

/**
 * Zones chaudes (15 pts) mesurées par le code, sans l'IA : part des mots de la requête cible présents dans
 * le Title (6 pts), les 100 premiers mots du contenu principal (5 pts) et les sous-titres H2/H3 (4 pts).
 * Comparaison sans casse ni accents, mots outils ignorés, singulier et pluriel confondus.
 * Limite : un synonyme (« maison de retraite » pour « EHPAD ») ne compte pas.
 */
export interface HotZonesMeasure {
  score: number;
  title: { points: number; max: 6; missing: string[] };
  first100Words: { points: number; max: 5; missing: string[] };
  subheadings: { points: number; max: 4; missing: string[] };
}

/** Racine grossière : pluriels en s / x confondus avec le singulier */
const stem = (token: string) => (token.length > 3 ? token.replace(/[sx]$/, '') : token);

function zone(queryTokens: string[], text: string, max: number) {
  const present = new Set(contentTokens(text).map(stem));
  const missing = queryTokens.filter((token) => !present.has(stem(token)));
  const share = queryTokens.length === 0 ? 0 : (queryTokens.length - missing.length) / queryTokens.length;
  return { points: Math.round(max * share), missing };
}

export function measureHotZones(
  query: string,
  page: { title?: string; first100Words: string; headings: { level: number; text: string }[] }
): HotZonesMeasure {
  const queryTokens = Array.from(new Set(contentTokens(query)));
  const subheadings = page.headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => h.text)
    .join(' ');
  const title = { ...zone(queryTokens, page.title ?? '', 6), max: 6 as const };
  const first100Words = { ...zone(queryTokens, page.first100Words, 5), max: 5 as const };
  const sub = { ...zone(queryTokens, subheadings, 4), max: 4 as const };
  return { score: title.points + first100Words.points + sub.points, title, first100Words, subheadings: sub };
}
