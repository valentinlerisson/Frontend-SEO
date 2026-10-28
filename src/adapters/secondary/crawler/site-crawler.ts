import { PageExtractor } from './page-extractor';
import * as cheerio from 'cheerio';
import { RawPageData } from '@/core/domain/types';
import { isPathAllowed, parseRobotsTxt, RobotsRules } from '@/core/domain/robots-txt';

export interface CrawlDomainMeta {
  domain: string;
  gptBotAllowed: boolean;
  claudeBotAllowed: boolean;
  perplexityBotAllowed: boolean;
  hasLlmsTxt: boolean;
  llmsTxtValid: boolean;
  /** Règles robots.txt pour Googlebot ; null : robots.txt injoignable, blocage par URL non mesurable */
  robots: RobotsRules | null;
  /** Robots IA probablement refusés par le serveur (pare-feu, CDN) : test avec leur user-agent depuis une IP non officielle */
  firewallBlocked: string[];
}

type FetchResult = {
  /** null : réponse non HTML (ignorée par le crawl) */
  page: RawPageData | null;
  html: string;
  /** URL finale après redirection(s), base de résolution des liens relatifs */
  finalUrl: string;
  networkError?: string;
};

export class SiteCrawler {
  /** En-têtes d'un navigateur moderne : certains serveurs rejettent les requêtes Node.js brutes */
  /** Au-delà, la page est jugée en boucle de redirection */
  private static readonly MAX_REDIRECTS = 10;

  private static readonly BROWSER_HEADERS: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none'
  };

  /**
   * Vérifie le robots.txt et le llms.txt du domaine
   */
  public static async analyzeDomainMetadata(domainUrl: string): Promise<CrawlDomainMeta> {
    const origin = new URL(domainUrl).origin;
    let gptBotAllowed = true;
    let claudeBotAllowed = true;
    let perplexityBotAllowed = true;
    let hasLlmsTxt = false;
    let llmsTxtValid = false;
    let robots: RobotsRules | null = null;

    // 1. Tester robots.txt
    try {
      const robotsRes = await fetch(`${origin}/robots.txt`, {
        headers: this.BROWSER_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(4000)
      });
      if (robotsRes.status === 404 || robotsRes.status === 410) {
        // Pas de robots.txt : tout est autorisé, et c'est une mesure valide
        robots = { rules: [], sitemaps: [] };
      }
      if (robotsRes.ok) {
        const rawText = await robotsRes.text();
        robots = parseRobotsTxt(rawText);
        // Groupe propre à chaque robot IA, à défaut le groupe « * » (mêmes règles que Google) : bloqué si la page
        // d'accueil est interdite ; un blocage partiel (quelques dossiers) laisse le site citable
        gptBotAllowed = isPathAllowed(parseRobotsTxt(rawText, 'gptbot'), '/');
        claudeBotAllowed = isPathAllowed(parseRobotsTxt(rawText, 'claudebot'), '/');
        perplexityBotAllowed = isPathAllowed(parseRobotsTxt(rawText, 'perplexitybot'), '/');
      }
    } catch {
      // Pas de robots.txt ou timeout -> considérer accessible
    }

    // 1 bis. Blocage hors robots.txt (pare-feu, CDN) : la page d'accueil demandée avec le user-agent de chaque robot
    const firewallBlocked: string[] = [];
    const botAgents: { name: string; agent: string }[] = [
      {
        name: 'GPTBot',
        agent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)'
      },
      {
        name: 'ClaudeBot',
        agent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'
      },
      {
        name: 'PerplexityBot',
        agent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'
      }
    ];
    const browserStatus = await this.probeStatus(`${origin}/`, this.BROWSER_HEADERS['User-Agent']);
    if (browserStatus !== null && browserStatus < 400) {
      for (const bot of botAgents) {
        const status = await this.probeStatus(`${origin}/`, bot.agent);
        // Un faux robot (notre IP n'est pas celle d'OpenAI ou d'Anthropic) peut être refusé alors que le vrai passe :
        // blocage seulement probable, signalé sans retirer de points
        if (status === 401 || status === 403 || status === 429 || status === 503) {
          firewallBlocked.push(`${bot.name} (HTTP ${status})`);
        }
      }
    }

    // 2. Tester /llms.txt
    try {
      const llmsRes = await fetch(`${origin}/llms.txt`, {
        headers: this.BROWSER_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(4000)
      });
      if (llmsRes.ok) {
        hasLlmsTxt = true;
        const text = await llmsRes.text();
        if (text.includes('#') && text.length > 50) {
          llmsTxtValid = true;
        }
      }
    } catch {
      hasLlmsTxt = false;
    }

    return {
      domain: origin,
      firewallBlocked,
      gptBotAllowed,
      claudeBotAllowed,
      perplexityBotAllowed,
      hasLlmsTxt,
      llmsTxtValid,
      robots
    };
  }

  /** Code HTTP d'une URL demandée avec un user-agent donné (null : pas de réponse) */
  private static async probeStatus(url: string, userAgent: string): Promise<number | null> {
    try {
      const response = await fetch(url, {
        headers: { ...this.BROWSER_HEADERS, 'User-Agent': userAgent },
        redirect: 'follow',
        signal: AbortSignal.timeout(6000)
      });
      await response.body?.cancel();
      return response.status;
    } catch {
      return null;
    }
  }

  /** Télécharge et extrait une seule page (par exemple une page concurrente), sans suivre ses liens */
  public static async fetchSinglePage(url: string): Promise<RawPageData | null> {
    const result = await this.fetchPage(url, 0);
    return result.page && !result.networkError && result.page.httpStatus < 400 ? result.page : null;
  }

  /** Clé de comparaison d'une URL : nom d'hôte sans www, chemin sans slash final, requête conservée */
  public static urlKey(url: string): string {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
      return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}${u.search}`;
    } catch {
      return url;
    }
  }

  /**
   * URL déclarées dans le sitemap : lignes `Sitemap:` du robots.txt, à défaut emplacements usuels.
   * Gère les index de sitemaps (2 niveaux, 15 fichiers au plus). Retourne null si aucun sitemap n'est lisible.
   * Les sitemaps compressés (.gz) ne sont pas lus. Clé : `urlKey` ; valeur : URL telle que déclarée.
   */
  public static async loadSitemapUrls(origin: string, declared: string[]): Promise<Map<string, string> | null> {
    const MAX_FILES = 15;
    const MAX_URLS = 50000;
    const candidates =
      declared.length > 0
        ? declared
        : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
    const urls = new Map<string, string>();
    const visited = new Set<string>();
    let found = false;

    const visit = async (sitemapUrl: string, depth: number): Promise<void> => {
      if (depth > 2 || visited.size >= MAX_FILES || visited.has(sitemapUrl) || sitemapUrl.endsWith('.gz')) return;
      visited.add(sitemapUrl);
      try {
        const response = await fetch(sitemapUrl, {
          headers: this.BROWSER_HEADERS,
          redirect: 'follow',
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) return;
        const $ = cheerio.load(await response.text(), { xmlMode: true });

        const children = $('sitemap > loc')
          .map((_, el) => $(el).text().trim())
          .get();
        if (children.length > 0) {
          found = true;
          for (const child of children) await visit(child, depth + 1);
        }
        $('url > loc').each((_, el) => {
          if (urls.size >= MAX_URLS) return;
          found = true;
          const loc = $(el).text().trim();
          urls.set(this.urlKey(loc), loc);
        });
      } catch {
        // Sitemap illisible : ignoré
      }
    };

    for (const candidate of candidates) {
      await visit(candidate, 0);
      if (found) break;
    }
    return found ? urls : null;
  }

  /**
   * Parcours en largeur depuis la racine : suit les liens internes réels
   * (même domaine), jusqu'à maxPages / maxDepth. Les inlinks sont calculés
   * à partir du graphe de liens observé.
   *
   * - La racine est retentée sur la variante www / sans www si elle échoue (4xx, 5xx, réseau).
   * - L'origine de base est réécrite d'après l'URL finale après redirection (ex. apex vers www).
   * Lève une erreur si la page racine est injoignable.
   */
  public static async crawlSite(
    originUrl: string,
    options: {
      maxPages?: number;
      maxDepth?: number;
      concurrency?: number;
      onProgress?: (crawled: number, maxPages: number) => Promise<void> | void;
      /** Règles robots.txt (null : non mesuré) */
      robots?: RobotsRules | null;
      /** URL du sitemap indexées par `urlKey` (null : aucun sitemap trouvé, non mesuré) */
      sitemapUrls?: Map<string, string> | null;
    } = {}
  ): Promise<RawPageData[]> {
    const { maxPages = 50, maxDepth = 3, concurrency = 5, onProgress, robots, sitemapUrls } = options;

    let rootOrigin = new URL(originUrl).origin;
    let rootRes = await this.fetchPage(`${rootOrigin}/`, 0);

    // Stratégie de secours : variante inverse (www / sans www)
    if (this.isFailure(rootRes)) {
      const alternateOrigin = this.alternateOrigin(rootOrigin);
      const alternateRes = await this.fetchPage(`${alternateOrigin}/`, 0);
      if (!this.isFailure(alternateRes)) {
        console.warn(`[SiteCrawler] ${rootOrigin}/ en échec, bascule sur ${alternateOrigin}/`);
        rootOrigin = alternateOrigin;
        rootRes = alternateRes;
      } else {
        console.error(
          `[SiteCrawler] Échec racine malgré la nouvelle tentative : ${rootOrigin}/ -> ${this.describeFailure(rootRes)} ; ${alternateOrigin}/ -> ${this.describeFailure(alternateRes)}`
        );
      }
    }

    if (rootRes.networkError) {
      throw new Error(`Site injoignable : ${rootRes.networkError}`);
    }
    if (!rootRes.page) {
      throw new Error('La page racine ne renvoie pas de HTML');
    }

    // Réécriture de l'origine de base d'après l'URL finale (apex vers www, http vers https…)
    try {
      rootOrigin = new URL(rootRes.finalUrl).origin;
    } catch {
      // URL finale illisible : on garde l'origine courante
    }
    const rootUrl = `${rootOrigin}/`;
    rootRes.page.url = rootUrl;

    // Pages, liens entrants et URL déjà vues indexés par `urlKey` : « /page » et « /page/ » sont la même page
    const key = (url: string) => this.urlKey(url);
    const results = new Map<string, RawPageData>();
    const inlinks = new Map<string, Set<string>>();
    const seen = new Set<string>([key(rootUrl)]);
    let frontier: { url: string; depth: number }[] = [];

    // Crawl incomplet : liens trouvés mais non explorés (limite de pages) ou pages dont les liens n'ont pas été suivis
    let depthCut = false;
    const register = async (
      item: { url: string; depth: number },
      res: FetchResult,
      via: 'links' | 'sitemap' = 'links'
    ) => {
      if (!res.page) return;
      res.page.discoveredVia = via;

      // Blocage par robots.txt et présence au sitemap : mesurés par URL quand les sources sont disponibles
      try {
        const parsed = new URL(item.url);
        if (robots) res.page.isBlockedByRobotsTxt = !isPathAllowed(robots, `${parsed.pathname}${parsed.search}`);
        if (sitemapUrls) res.page.inSitemap = sitemapUrls.has(SiteCrawler.urlKey(item.url));
      } catch {
        // URL illisible : critères non mesurés
      }

      results.set(key(item.url), res.page);
      await onProgress?.(results.size, maxPages);

      if (res.html && res.page.httpStatus < 400) {
        if (via === 'links' && item.depth >= maxDepth) {
          depthCut = true;
          return;
        }
        // Les liens relatifs se résolvent par rapport à l'URL finale après redirection
        for (const link of PageExtractor.extractInternalLinks(res.html, res.finalUrl, rootOrigin)) {
          const linkKey = key(link);
          if (linkKey === key(item.url)) continue;
          if (!inlinks.has(linkKey)) inlinks.set(linkKey, new Set());
          inlinks.get(linkKey)!.add(item.url);
          // Une page venue du sitemap compte pour les liens entrants, mais le parcours ne repart pas d'elle
          if (via === 'links' && !seen.has(linkKey)) {
            seen.add(linkKey);
            frontier.push({ url: link, depth: item.depth + 1 });
          }
        }
      }
    };

    await register({ url: rootUrl, depth: 0 }, rootRes);

    while (frontier.length > 0 && results.size < maxPages) {
      const current = frontier;
      frontier = [];

      for (let i = 0; i < current.length && results.size < maxPages; i += concurrency) {
        const batch = current.slice(i, i + concurrency).slice(0, maxPages - results.size);
        const fetched = await Promise.all(batch.map((item) => this.fetchPage(item.url, item.depth)));

        for (let j = 0; j < batch.length; j++) {
          await register(batch[j], fetched[j]);
        }
      }
    }

    // Graphe complet : tous les liens trouvés ont été explorés, sans coupure de profondeur
    const linkGraphComplete = !depthCut && Array.from(seen).every((url) => results.has(url));

    // Pages du sitemap qu'aucun lien n'a permis d'atteindre : explorées dans la limite restante. Si le graphe est
    // complet, ce sont des pages orphelines (aucun lien depuis les pages accessibles depuis l'accueil).
    if (sitemapUrls && results.size < maxPages) {
      const rootHost = new URL(rootOrigin).hostname.replace(/^www\./, '');
      const missing = Array.from(sitemapUrls.entries())
        .filter(([key, url]) => {
          if (seen.has(key)) return false;
          try {
            return new URL(url).hostname.replace(/^www\./, '') === rootHost;
          } catch {
            return false;
          }
        })
        .map(([, url]) => {
          // Même origine que le crawl (www, https) pour comparer les liens
          const parsed = new URL(url);
          return `${rootOrigin}${parsed.pathname}${parsed.search}`;
        })
        .slice(0, maxPages - results.size);
      for (let i = 0; i < missing.length; i += concurrency) {
        const batch = missing.slice(i, i + concurrency);
        const fetched = await Promise.all(batch.map((url) => this.fetchPage(url, -1)));
        for (let j = 0; j < batch.length; j++) {
          seen.add(key(batch[j]));
          await register({ url: batch[j], depth: -1 }, fetched[j], 'sitemap');
        }
      }
    }

    for (const [pageKey, page] of results) {
      page.linkGraphComplete = linkGraphComplete;
      const sources = inlinks.get(pageKey);
      page.inlinksCount = sources?.size ?? 0;
      page.inlinkSources = sources
        ? Array.from(sources).map((source) => source.replace(rootOrigin, '') || '/')
        : [];
    }

    return Array.from(results.values());
  }

  private static isFailure(res: FetchResult): boolean {
    return Boolean(res.networkError) || (res.page !== null && res.page.httpStatus >= 400);
  }

  private static describeFailure(res: FetchResult): string {
    return res.networkError
      ? `erreur réseau (${res.networkError})`
      : `HTTP ${res.page?.httpStatus ?? '?'}`;
  }

  /** Variante inverse : avec www si l'origine était nue, sans www sinon */
  private static alternateOrigin(origin: string): string {
    const url = new URL(origin);
    url.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
    return url.origin;
  }

  /**
   * Télécharge et extrait une page avec des en-têtes de navigateur, en suivant les redirections.
   */
  private static async fetchPage(url: string, depth: number): Promise<FetchResult> {
    const startedAt = performance.now();
    try {
      // Redirections suivies une à une pour connaître leur nombre et leurs codes (301, 302…)
      const redirectStatuses: number[] = [];
      let currentUrl = url;
      let response = await fetch(currentUrl, {
        headers: this.BROWSER_HEADERS,
        signal: AbortSignal.timeout(10000),
        redirect: 'manual'
      });
      while (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        if (redirectStatuses.length >= this.MAX_REDIRECTS) throw new Error(`Plus de ${this.MAX_REDIRECTS} redirections`);
        redirectStatuses.push(response.status);
        currentUrl = new URL(response.headers.get('location')!, currentUrl).href;
        response = await fetch(currentUrl, {
          headers: this.BROWSER_HEADERS,
          signal: AbortSignal.timeout(10000),
          redirect: 'manual'
        });
      }

      const finalUrl = currentUrl;

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !contentType.includes('html')) {
        return { page: null, html: '', finalUrl };
      }

      const html = await response.text();
      const responseTimeMs = Math.round(performance.now() - startedAt);

      const page = PageExtractor.extractFromHtml({
        url,
        html,
        httpStatus: response.status,
        depth,
        inlinksCount: 0,
        hasSsl: finalUrl.startsWith('https://'),
        redirectHops: redirectStatuses.length
      });
      page.responseTimeMs = responseTimeMs;
      page.redirectStatuses = redirectStatuses;
      if (redirectStatuses.length > 0 && finalUrl !== url) {
        page.finalUrl = finalUrl;
      }

      return { page, html, finalUrl };
    } catch (err: any) {
      const cause = err?.cause?.code || err?.cause?.message;
      const message = `${err?.message || 'Inaccessible'}${cause ? ` (${cause})` : ''}`;
      console.warn(`[SiteCrawler] Requête en échec : ${url} -> ${message}`);
      const page = PageExtractor.extractFromHtml({
        url,
        html: '',
        httpStatus: 500,
        depth,
        inlinksCount: 0,
        hasSsl: url.startsWith('https://')
      });
      page.fetchError = message;
      return { page, html: '', finalUrl: url, networkError: message };
    }
  }
}
