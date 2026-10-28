import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SerpFeatures, SerpResult } from '@/core/domain/types';
import { SerpBlockedError, type SerpProviderPort } from '@/core/ports/serp-provider';

const ENDPOINT = 'https://google.serper.dev/search';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RESULTS_PER_PAGE = 10;

type SerperResponse = {
  organic?: { title?: string; link?: string; snippet?: string; position?: number; sitelinks?: { title?: string; link?: string }[] }[];
  peopleAlsoAsk?: { question?: string }[];
  places?: unknown[];
};

type Payload = { results: SerpResult[]; features?: SerpFeatures };

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Résultats Google via l'API Serper.dev (payante, conforme aux conditions de Google côté utilisateur de l'app).
 * Activée par SERP_PROVIDER=serper et SERPER_API_KEY. Même cache disque de 24 h que le navigateur local,
 * pour ne pas repayer une requête déjà lue. Une page de résultats = un crédit.
 */
export class SerperApiSerp implements SerpProviderPort {
  readonly id = 'serper';
  private readonly cacheDir = path.join(process.cwd(), '.cache', 'serp-api');

  constructor(private readonly apiKey: string) {}

  async search(
    query: string,
    options: { pages?: number; start?: number; domain?: string; fresh?: boolean } = {}
  ): Promise<{ results: SerpResult[]; features?: SerpFeatures }> {
    const pages = Math.max(1, Math.min(3, options.pages ?? (Number(process.env.SERP_PAGES) || 1)));
    const start = Math.max(0, Math.min(2, options.start ?? 0));
    const domain = (options.domain ?? '').toLowerCase().replace(/^www\./, '');
    const cacheFile = this.cacheFile(query, pages, domain, start);

    const cached = options.fresh ? null : await this.readCache(cacheFile);
    if (cached) return cached;

    const results: SerpResult[] = [];
    let features: SerpFeatures | undefined;
    for (let page = start; page < start + pages; page++) {
      const data = await this.fetchPage(query, page);
      (data.organic ?? []).forEach((item, index) => {
        if (!item.link) return;
        const resultDomain = hostOf(item.link);
        const own = Boolean(domain) && (resultDomain === domain || resultDomain.endsWith(`.${domain}`));
        results.push({
          position: page * RESULTS_PER_PAGE + (item.position ?? index + 1),
          title: item.title ?? '',
          url: item.link,
          snippet: item.snippet ?? '',
          domain: resultDomain,
          ...(own && item.sitelinks?.length
            ? {
                sitelinks: item.sitelinks
                  .filter((link): link is { title?: string; link: string } => Boolean(link.link))
                  .map((link) => ({ title: link.title ?? '', url: link.link }))
              }
            : {})
        });
      });
      // Pack local et questions : relevés sur la première page lue, comme le navigateur local
      if (page === start && start === 0) {
        features = {
          localPack: (data.places ?? []).length > 0,
          peopleAlsoAsk: (data.peopleAlsoAsk ?? []).map((q) => q.question ?? '').filter(Boolean)
        };
      }
    }

    // Une recherche sans aucun résultat n'est pas une mesure : pas de mise en cache
    if (results.length === 0) throw new Error('Aucun résultat renvoyé par l’API SERP');
    const payload: Payload = { results, features };
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(payload));
    return payload;
  }

  private async fetchPage(query: string, page: number): Promise<SerperResponse> {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'fr', hl: 'fr', num: RESULTS_PER_PAGE, page: page + 1 })
    });
    // Clé refusée ou crédits épuisés : même traitement qu'un blocage, l'utilisateur doit intervenir
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new SerpBlockedError(`API SERP refusée (HTTP ${response.status}) : vérifier la clé ou les crédits`);
    }
    if (!response.ok) throw new Error(`API SERP en erreur (HTTP ${response.status})`);
    return (await response.json()) as SerperResponse;
  }

  private cacheFile(query: string, pages: number, domain: string, start: number): string {
    const key = createHash('sha1')
      .update(`${query.toLowerCase().replace(/\s+/g, ' ').trim()}|${pages}|${domain}|${start}`)
      .digest('hex');
    return path.join(this.cacheDir, `${key}.json`);
  }

  private async readCache(file: string): Promise<Payload | null> {
    try {
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
      return JSON.parse(await fs.readFile(file, 'utf-8')) as Payload;
    } catch {
      return null;
    }
  }
}
