import * as cheerio from 'cheerio';
import { RawPageData } from '@/core/domain/types';

export class PageExtractor {
  public static extractFromHtml(params: {
    url: string;
    html: string;
    httpStatus: number;
    depth: number;
    inlinksCount: number;
    isBlockedByRobotsTxt?: boolean;
    inSitemap?: boolean;
    hasSsl?: boolean;
    redirectHops?: number;
  }): RawPageData {
    const {
      url,
      html,
      httpStatus,
      depth,
      inlinksCount,
      isBlockedByRobotsTxt = false,
      inSitemap = true,
      hasSsl = url.startsWith('https://'),
      redirectHops = 0
    } = params;

    const $ = cheerio.load(html);

    // 1. Parsing URL & Path
    let path = '/';
    try {
      const parsedUrl = new URL(url);
      path = parsedUrl.pathname || '/';
    } catch {
      path = url;
    }

    // 2. Balise Title & Meta Description
    const title = $('title').first().text().trim() || undefined;
    const metaDescription =
      $('meta[name="description" i]').attr('content')?.trim() ||
      $('meta[property="og:description" i]').attr('content')?.trim() ||
      undefined;

    // 3. Balises H1 & Hiérarchie Hn
    const h1Elements = $('h1');
    const h1Count = h1Elements.length;
    const h1 = h1Elements.first().text().trim() || undefined;

    const headings: { level: number; text: string }[] = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const tagName = el.tagName.toLowerCase();
      const level = parseInt(tagName.replace('h', ''), 10);
      const text = $(el).text().trim();
      if (text) {
        headings.push({ level, text });
      }
    });

    // Validation hiérarchie (pas de saut de niveau supérieur à 1)
    let headingHierarchyValid = true;
    const headingHierarchyErrors: string[] = [];
    for (let i = 0; i < headings.length - 1; i++) {
      const curr = headings[i].level;
      const next = headings[i + 1].level;
      if (next > curr + 1) {
        headingHierarchyValid = false;
        headingHierarchyErrors.push(`Saut de H${curr} vers H${next}`);
      }
    }

    // 4. Balise Canonique & Indexabilité
    const canonicalUrl = $('link[rel="canonical" i]').attr('href')?.trim() || undefined;
    const robotsMeta = $('meta[name="robots" i]').attr('content')?.toLowerCase() || '';
    const isNoIndex = robotsMeta.includes('noindex');
    const isIndexable = !isNoIndex && httpStatus < 400;

    // 5. Images et Attributs Alt
    const images: { src: string; alt?: string; hasAlt: boolean }[] = [];
    let imagesWithAlt = 0;
    $('img').each((_, el) => {
      const src = $(el).attr('src') || '';
      const alt = $(el).attr('alt');
      const hasAlt = typeof alt === 'string' && alt.trim().length > 0;
      if (hasAlt) imagesWithAlt++;
      images.push({ src, alt, hasAlt });
    });

    // 6. Liens et Maillage
    let outlinksCount = 0;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')?.trim();
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        outlinksCount++;
      }
    });

    // 7. Contenu textuel principal & Mots
    $('script, style, noscript, svg, nav, footer, header').remove();
    const bodyText = $('main').length > 0 ? $('main').text() : $('article').length > 0 ? $('article').text() : $('body').text();
    const cleanedText = bodyText.replace(/\s+/g, ' ').trim();
    const words = cleanedText.length > 0 ? cleanedText.split(' ') : [];
    const wordCount = words.length;
    const first100Words = words.slice(0, 100).join(' ');

    // 8. Signaux E-E-A-T
    const hasAuthor =
      $('[rel="author"]').length > 0 ||
      $('[class*="author" i]').length > 0 ||
      $('[itemprop="author" i]').length > 0;

    const hasPublicationDate =
      $('time').length > 0 ||
      $('[itemprop="datePublished" i]').length > 0 ||
      $('[itemprop="dateModified" i]').length > 0;

    // 9. Données Structurées Schéma.org JSON-LD
    const schemaTypes: string[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const jsonContent = JSON.parse($(el).html() || '{}');
        const extractType = (obj: any) => {
          if (!obj) return;
          if (obj['@type']) {
            if (Array.isArray(obj['@type'])) {
              schemaTypes.push(...obj['@type']);
            } else {
              schemaTypes.push(String(obj['@type']));
            }
          }
          if (Array.isArray(obj['@graph'])) {
            obj['@graph'].forEach(extractType);
          }
        };
        extractType(jsonContent);
      } catch {
        // Ignorer les erreurs de JSON malformé
      }
    });

    const hasSchemaOrg = schemaTypes.length > 0;

    // 10. Liens d'Autorité Externes
    let externalAuthoritativeLinksCount = 0;
    const authoritativeDomains = ['.gov', '.edu', 'wikipedia.org', 'w3.org', 'iso.org', 'arxiv.org', 'lemonde.fr', 'nytimes.com'];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (authoritativeDomains.some((domain) => href.toLowerCase().includes(domain))) {
        externalAuthoritativeLinksCount++;
      }
    });

    return {
      url,
      path,
      httpStatus,
      depth,
      isPillar: false,
      isIndexable,
      isBlockedByRobotsTxt,
      inSitemap,
      canonicalUrl,
      title,
      metaDescription,
      h1,
      h1Count,
      headings,
      headingHierarchyValid,
      headingHierarchyErrors,
      wordCount,
      inlinksCount,
      outlinksCount,
      images,
      imagesTotal: images.length,
      imagesWithAlt,
      hasSsl,
      redirectHops,
      hasSchemaOrg,
      schemaTypes: Array.from(new Set(schemaTypes)),
      first100Words,
      hasAuthor,
      hasPublicationDate,
      externalAuthoritativeLinksCount,
      bodyText: cleanedText
    };
  }
}
