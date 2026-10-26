import { PageExtractor } from './page-extractor';
import { RawPageData } from '@/core/domain/types';

export interface CrawlDomainMeta {
  domain: string;
  gptBotAllowed: boolean;
  claudeBotAllowed: boolean;
  perplexityBotAllowed: boolean;
  hasLlmsTxt: boolean;
  llmsTxtValid: boolean;
}

export class SiteCrawler {
  private static readonly GOOGLEBOT_MOBILE_UA =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

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

    // 1. Tester robots.txt
    try {
      const robotsRes = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': this.GOOGLEBOT_MOBILE_UA },
        signal: AbortSignal.timeout(4000)
      });
      if (robotsRes.ok) {
        const text = (await robotsRes.text()).toLowerCase();
        if (text.includes('user-agent: gptbot') && text.includes('disallow: /')) {
          gptBotAllowed = false;
        }
        if (text.includes('user-agent: claudebot') && text.includes('disallow: /')) {
          claudeBotAllowed = false;
        }
        if (text.includes('user-agent: perplexitybot') && text.includes('disallow: /')) {
          perplexityBotAllowed = false;
        }
      }
    } catch {
      // Pas de robots.txt ou timeout -> considérer accessible
    }

    // 2. Tester /llms.txt
    try {
      const llmsRes = await fetch(`${origin}/llms.txt`, {
        headers: { 'User-Agent': this.GOOGLEBOT_MOBILE_UA },
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
      gptBotAllowed,
      claudeBotAllowed,
      perplexityBotAllowed,
      hasLlmsTxt,
      llmsTxtValid
    };
  }

  /**
   * Crawl une page individuelle avec le User-Agent mobile
   */
  public static async crawlPage(
    url: string,
    depth: number = 0,
    inlinksCount: number = 3
  ): Promise<RawPageData> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.GOOGLEBOT_MOBILE_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow'
      });

      const html = await response.text();
      const httpStatus = response.status;

      return PageExtractor.extractFromHtml({
        url,
        html,
        httpStatus,
        depth,
        inlinksCount,
        hasSsl: url.startsWith('https://'),
        redirectHops: response.redirected ? 1 : 0
      });
    } catch (err: any) {
      // Gestion d'échec réseau / offline fallback
      return PageExtractor.extractFromHtml({
        url,
        html: `<!DOCTYPE html><html><head><title>Erreur ou page non joignable</title></head><body><h1>Erreur de crawl</h1><p>${err?.message || 'Inaccessible'}</p></body></html>`,
        httpStatus: 500,
        depth,
        inlinksCount: 0,
        hasSsl: url.startsWith('https://')
      });
    }
  }
}
