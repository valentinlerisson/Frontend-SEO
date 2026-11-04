import type { CrawlScope } from './types';

/** Pages explorées au plus : réglable dans les paramètres, de 10 à 2 000 (150 par défaut) */
export const DEFAULT_MAX_CRAWL_PAGES = 150;
export const MIN_MAX_CRAWL_PAGES = 10;
export const MAX_MAX_CRAWL_PAGES = 2000;
/** Pages principales : 2 clics au plus depuis l'accueil, 50 pages au plus */
export const MAIN_PAGES_DEPTH = 2;
export const MAIN_PAGES_LIMIT = 50;
/** Tout le site : au-delà de 3 clics la profondeur est réellement mesurée (4 et 5 clics pénalisés) */
export const FULL_SITE_DEPTH = 6;

export function clampMaxCrawlPages(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_MAX_CRAWL_PAGES;
  return Math.min(MAX_MAX_CRAWL_PAGES, Math.max(MIN_MAX_CRAWL_PAGES, Math.round(number)));
}

/**
 * Périmètre effectif d'un audit à partir du choix de l'utilisateur (ou de celui gardé pour le projet) et du plafond
 * de pages des paramètres. Sans choix : tout le site. Mode sitemaps sans sitemap choisi : tout le site.
 */
export function resolveCrawlScope(input: Partial<CrawlScope> | null | undefined, maxPages?: unknown): CrawlScope {
  const limit = clampMaxCrawlPages(maxPages ?? input?.maxPages ?? DEFAULT_MAX_CRAWL_PAGES);
  const sitemaps = (input?.sitemaps ?? []).filter((url) => typeof url === 'string' && /^https?:\/\//.test(url));
  if (input?.mode === 'main') {
    return { mode: 'main', maxPages: Math.min(MAIN_PAGES_LIMIT, limit), maxDepth: MAIN_PAGES_DEPTH };
  }
  if (input?.mode === 'sitemaps' && sitemaps.length > 0) {
    return { mode: 'sitemaps', sitemaps: sitemaps.slice(0, 50), maxPages: limit, maxDepth: FULL_SITE_DEPTH };
  }
  return { mode: 'full', maxPages: limit, maxDepth: FULL_SITE_DEPTH };
}

/**
 * Pages de liste sans contenu propre, écartées du mode « pages principales » : étiquettes, catégories, auteurs,
 * pagination, archives par date, flux et API. Un article daté (/2023/08/28/titre) n'est pas une archive.
 */
export function isArchivePath(pathAndQuery: string): boolean {
  const [path, query = ''] = pathAndQuery.split('?');
  return (
    /\/(tag|tags|etiquette|category|categorie|categories|author|auteur|page)\/[^/]*/i.test(path) ||
    /^\/\d{4}(\/\d{1,2}){0,2}\/?$/.test(path) ||
    /\/(feed|rss|wp-json|amp)(\/|$)/i.test(path) ||
    /(^|&)(page|paged|p|s|q)=/i.test(query)
  );
}

/** Périmètre en une phrase, affiché dans la synthèse et le rapport */
export function describeCrawlScope(scope: CrawlScope): string {
  if (scope.mode === 'main') return `Pages principales (${scope.maxDepth} clics au plus, ${scope.maxPages} pages au plus)`;
  if (scope.mode === 'sitemaps') {
    const names = (scope.sitemaps ?? []).map((url) => url.split('/').pop() || url);
    return `Sitemap${names.length > 1 ? 's' : ''} choisi${names.length > 1 ? 's' : ''} : ${names.join(', ')} (${scope.maxPages} pages au plus)`;
  }
  return `Tout le site (${scope.maxPages} pages au plus)`;
}
