import type { BacklinkAnchorType, BacklinkLocation, DiscoveredBacklink, SerpResult } from './types';
import { pageKeyOf } from './fix-plan';
import { brandVariants } from './scoring/autocomplete-relevance';

/**
 * Recherche des liens précis : règles pures (sans réseau). Google donne des pages qui citent le site ; le code les lit
 * ensuite pour y relever le vrai lien. Ici : quelles recherches faire dans quel ordre, quelles pages garder, et comment
 * qualifier un lien lu (emplacement, nature de l'ancre).
 */

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** L'hôte est ce domaine ou l'un de ses sous-domaines */
export const isSameSite = (host: string, domain: string): boolean => {
  const bare = domain.toLowerCase().replace(/^www\./, '');
  return host === bare || host.endsWith(`.${bare}`);
};

export interface BacklinkSearch {
  /** Recherche sur le nom de marque, hors du site audité */
  kind: 'brand';
  query: string;
  /** Pages de résultats lues d'un coup (un navigateur lancé, chaque page compte dans le budget de recherches Google) */
  pages: number;
  /** Première page lue : 0 = première page de Google */
  start: number;
}

/** Pages de résultats lues par appel, et pages lues au plus par requête (jusqu'à la neuvième : au-delà, Google se tarit) */
export const SEARCH_CHUNK_PAGES = 3;
export const MAX_PAGES_PER_QUERY = 9;

/**
 * Recherches à faire : le nom de marque (avec et sans espace : « big happy », « bighappy »), hors du site audité,
 * défilé page après page. Les lots de pages sont entrelacés entre les requêtes : un budget court lit d'abord le début
 * de chacune, puis va plus profond. Un nom de domaine entre guillemets ou une recherche par domaine référent ne
 * marchent pas : les liens trouvés portent la marque dans leur texte, pas le nom de domaine.
 */
export function planBacklinkSearches(target: string): BacklinkSearch[] {
  const bare = target.toLowerCase().replace(/^www\./, '');
  const queries = brandVariants(bare).map((brand) => `"${brand}" -site:${bare}`);
  const searches: BacklinkSearch[] = [];
  for (let start = 0; start < MAX_PAGES_PER_QUERY; start += SEARCH_CHUNK_PAGES) {
    for (const query of queries) searches.push({ kind: 'brand', query, pages: SEARCH_CHUNK_PAGES, start });
  }
  return searches;
}

/** Une page de ce nom d'hôte n'est pas lue : réseaux sociaux et plateformes dont les pages ne donnent pas de backlink lisible */
const SKIPPED_HOSTS = [
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'pinterest.fr',
  'reddit.com',
  'google.com',
  'wikipedia.org'
];

/** Texte normalisé (minuscules, sans accents, mots séparés par une espace, bordé d'espaces) pour chercher un mot entier */
const flatten = (value: string) =>
  ` ${value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

/**
 * La page nomme le site audité : son nom de domaine, ou sa marque en mots entiers (avec ou sans espace). Le nom de marque
 * peut désigner une autre entreprise : une mention sans lien est une piste à confirmer, pas un fait.
 */
export function mentionsBrand(text: string, domain: string, brands: string[]): boolean {
  const bare = domain.toLowerCase().replace(/^www\./, '');
  if (text.toLowerCase().includes(bare)) return true;
  const flat = flatten(text);
  return brands.some((brand) => brand.length >= 3 && flat.includes(` ${brand} `));
}

/** Garde les recherches que le budget permet, dans l'ordre ; une recherche qui ne tient pas en entier est écartée */
export function trimToBudget(searches: BacklinkSearch[], remaining: number): BacklinkSearch[] {
  const kept: BacklinkSearch[] = [];
  let left = remaining;
  for (const search of searches) {
    if (search.pages > left) continue;
    kept.push(search);
    left -= search.pages;
  }
  return kept;
}

export interface BacklinkCandidate {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  inCommonCrawl: boolean;
  foundBy: DiscoveredBacklink['foundBy'];
}

/**
 * Pages de résultats à lire : jamais le site audité ni ses sous-domaines, ni les réseaux sociaux et plateformes
 * (`SKIPPED_HOSTS`), une seule fois chaque page (`pageKeyOf`), au plus `maxPerDomain` par domaine (un gros site ne doit
 * pas épuiser la lecture), `maxTotal` au total. L'ordre des résultats est gardé : les mieux classés sont lus d'abord.
 */
export function candidatesFromResults(
  batches: { results: SerpResult[]; foundBy: BacklinkCandidate['foundBy'] }[],
  options: { target: string; referring: Set<string>; maxPerDomain?: number; maxTotal?: number }
): BacklinkCandidate[] {
  const { target, referring, maxPerDomain = 5, maxTotal = 150 } = options;
  const seen = new Set<string>();
  const perDomain = new Map<string, number>();
  const kept: BacklinkCandidate[] = [];
  for (const { results, foundBy } of batches) {
    for (const result of results) {
      if (kept.length >= maxTotal) return kept;
      if (!/^https?:\/\//i.test(result.url)) continue;
      const host = hostOf(result.url);
      if (!host || isSameSite(host, target) || SKIPPED_HOSTS.some((skipped) => isSameSite(host, skipped))) continue;
      const key = pageKeyOf(result.url);
      if (seen.has(key)) continue;
      const count = perDomain.get(host) ?? 0;
      if (count >= maxPerDomain) continue;
      seen.add(key);
      perDomain.set(host, count + 1);
      kept.push({
        url: result.url,
        domain: host,
        title: result.title,
        snippet: result.snippet,
        inCommonCrawl: Array.from(referring).some((domain) => isSameSite(host, domain)),
        foundBy
      });
    }
  }
  return kept;
}

/** Balise parente d'un lien, du plus proche au plus lointain */
export interface LinkAncestor {
  tag: string;
  role?: string;
  id?: string;
  className?: string;
}

const COMMENT_HINT = /(^|[\s_-])(comment|comments|commentaire|commentaires|disqus|reply|respond)([\s_-]|$)/i;
const FOOTER_HINT = /(^|[\s_-])(footer|colophon|site-info)([\s_-]|$)/i;
const NAV_HINT = /(^|[\s_-])(navbar|menu|breadcrumb|breadcrumbs|main-navigation|site-navigation)([\s_-]|$)/i;
const ASIDE_HINT = /(^|[\s_-])(sidebar|widget-area|widgets-area|aside)([\s_-]|$)/i;
const HEADER_HINT = /(^|[\s_-])(masthead|site-header|topbar)([\s_-]|$)/i;

/**
 * Le mot « widget » seul ne veut pas dire colonne latérale (les blocs de contenu d'Elementor s'appellent
 * `elementor-widget-container`), ni « nav » seul un menu (`nav-tabs` de Bootstrap) : seuls des noms sans ambiguïté sont lus.
 *
 * Emplacement d'un lien d'après ses balises parentes, la plus proche qui dit quelque chose l'emporte : commentaires
 * (identifiant ou classe), pied de page (`footer`, rôle contentinfo), menu (`nav`), colonne latérale (`aside`, barre
 * latérale), en-tête, puis `article` ou `main` = contenu. Sans aucun repère : contenu si le lien est dans un paragraphe,
 * une liste ou un titre, sinon inconnu.
 */
export function classifyLinkLocation(ancestors: LinkAncestor[]): BacklinkLocation {
  for (const node of ancestors) {
    const hints = `${node.id ?? ''} ${node.className ?? ''}`;
    if (COMMENT_HINT.test(hints)) return 'comment';
    if (node.tag === 'footer' || node.role === 'contentinfo' || FOOTER_HINT.test(hints)) return 'footer';
    if (node.tag === 'nav' || node.role === 'navigation' || NAV_HINT.test(hints)) return 'nav';
    if (node.tag === 'aside' || node.role === 'complementary' || ASIDE_HINT.test(hints)) return 'aside';
    if (node.tag === 'header' || node.role === 'banner' || HEADER_HINT.test(hints)) return 'header';
    if (node.tag === 'article' || node.tag === 'main' || node.role === 'main') return 'content';
  }
  return ancestors.some((node) => ['p', 'li', 'blockquote', 'td', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.tag)) ? 'content' : 'unknown';
}

const GENERIC_ANCHORS = new Set([
  'ici',
  'cliquez ici',
  'cliquer ici',
  'click here',
  'here',
  'lien',
  'le lien',
  'ce lien',
  'site',
  'le site',
  'site web',
  'website',
  'voir',
  'voir le site',
  'visiter',
  'visiter le site',
  'en savoir plus',
  'lire la suite',
  'read more',
  'source',
  'plus'
]);

const normalizeAnchor = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Nature de l'ancre : image (aucun texte), adresse (le texte est une URL ou un nom de domaine), marque (contient le nom
 * du site, avec ou sans espace), formule générique, sinon autre texte. `brands` : variantes sans accent du nom du site.
 */
export function classifyAnchor(anchor: string, brands: string[]): BacklinkAnchorType {
  const text = anchor.trim();
  if (!text) return 'image';
  if (/^(https?:\/\/|www\.)\S+$/i.test(text) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text)) return 'url';
  const normalized = normalizeAnchor(text);
  const squeezed = normalized.replace(/ /g, '');
  if (brands.some((brand) => brand && (normalized.includes(brand) || squeezed.includes(brand.replace(/ /g, ''))))) return 'brand';
  if (GENERIC_ANCHORS.has(normalized)) return 'generic';
  return 'other';
}

/** Texte de `max` caractères au plus, recentré sur le repère (le lien) quand le paragraphe est plus long */
export function windowAround(text: string, marker: string, max = 800): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const at = Math.max(0, flat.indexOf(marker));
  const start = Math.max(0, Math.min(at - Math.floor(max / 2), flat.length - max));
  const slice = flat.slice(start, start + max).trim();
  return `${start > 0 ? '… ' : ''}${slice}${start + max < flat.length ? ' …' : ''}`;
}
