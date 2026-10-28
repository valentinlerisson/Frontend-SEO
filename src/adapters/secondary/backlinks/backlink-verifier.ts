import type { ReferringDomain, VerifiedBacklink } from '@/core/domain/types';
import { SiteCrawler } from '@/adapters/secondary/crawler/site-crawler';

/** Pages d'un site où l'on trouve d'habitude les liens sortants : partenaires, références, crédits, presse */
const LIKELY_PAGES =
  /(partenaire|partner|reference|référence|client|lien|link|credit|crédit|mention|legal|légal|realis|réalis|presse|press|annuaire|ressource)/i;

/** Domaines vérifiés au plus, et pages lues au plus par domaine (accueil compris) */
export const MAX_VERIFIED_DOMAINS = 20;
const MAX_PAGES_PER_DOMAIN = 4;
const CONCURRENCY = 4;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Le graphe Common Crawl ne dit pas quelle page fait le lien : on lit l'accueil du domaine référent, puis jusqu'à
 * 3 pages dont l'adresse ou le libellé évoque des partenaires, références, crédits ou mentions légales, et l'on garde
 * les liens vers le site audité (adresse, texte du lien, nofollow). Un lien sur une page plus profonde n'est pas vu.
 */
export async function verifyReferringDomain(referring: string, target: string): Promise<NonNullable<ReferringDomain['verification']>> {
  const targetHost = target.toLowerCase().replace(/^www\./, '');
  const pointsToTarget = (href: string) => {
    const host = hostOf(href);
    return host === targetHost || host.endsWith(`.${targetHost}`);
  };

  const home = (await SiteCrawler.fetchSinglePage(`https://${referring}/`)) ?? (await SiteCrawler.fetchSinglePage(`http://${referring}/`));
  if (!home) return { status: 'UNREACHABLE', pagesChecked: 0, links: [] };

  const found: VerifiedBacklink[] = [];
  const collect = (page: NonNullable<typeof home>) => {
    const sourceUrl = page.finalUrl ?? page.url;
    for (const link of page.links) {
      if (!pointsToTarget(link.href)) continue;
      if (found.some((item) => item.sourceUrl === sourceUrl && item.targetUrl === link.href)) continue;
      found.push({ sourceUrl, targetUrl: link.href, anchor: link.text, nofollow: link.nofollow });
    }
  };
  collect(home);

  let pagesChecked = 1;
  if (found.length === 0) {
    const candidates = Array.from(
      new Set(
        home.links
          .filter((link) => link.internal && (LIKELY_PAGES.test(link.href) || LIKELY_PAGES.test(link.text)))
          .map((link) => link.href.split('#')[0])
      )
    ).slice(0, MAX_PAGES_PER_DOMAIN - 1);
    for (const url of candidates) {
      const page = await SiteCrawler.fetchSinglePage(url);
      pagesChecked++;
      if (page) collect(page);
      if (found.length > 0) break;
    }
  }
  return { status: found.length > 0 ? 'FOUND' : 'NOT_FOUND', pagesChecked, links: found.slice(0, 10) };
}

/** Vérifie les premiers domaines référents (4 en parallèle) ; les suivants restent non vérifiés */
export async function verifyReferringDomains(domains: ReferringDomain[], target: string): Promise<ReferringDomain[]> {
  const result = domains.map((item) => ({ ...item }));
  const queue = result.slice(0, MAX_VERIFIED_DOMAINS);
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          item.verification = await verifyReferringDomain(item.domain, target);
        } catch {
          item.verification = { status: 'UNREACHABLE', pagesChecked: 0, links: [] };
        }
      }
    })
  );
  return result;
}
