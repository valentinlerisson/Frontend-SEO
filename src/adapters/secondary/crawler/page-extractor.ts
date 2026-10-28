import * as cheerio from 'cheerio';
import { RawPageData, RoleSignals } from '@/core/domain/types';
import { extractEditorialSignals, extractLastUpdated } from './editorial-signals';
import { extractNap } from './nap-extractor';

const NON_HTML_EXTENSIONS =
  /\.(jpe?g|png|gif|svg|webp|avif|ico|pdf|zip|css|js|json|xml|txt|mp4|mp3|woff2?|ttf|docx?|xlsx?|pptx?)$/i;

// Tout schéma explicite autre que http(s) : mailto:, tel:, javascript:, data:, sms:…
const NON_HTTP_SCHEME = /^(?!https?:)[a-z][a-z0-9+.-]*:/i;

const NOFOLLOW_REL = /(^|\s)nofollow(\s|$)/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export class PageExtractor {
  /**
   * Liens internes uniques d'une page, normalisés sur l'origine racine du crawl
   * (hash retiré, slash final retiré hors racine, ressources non-HTML ignorées).
   */
  public static extractInternalLinks(html: string, pageUrl: string, rootOrigin: string): string[] {
    const links = new Set<string>();

    try {
      const $ = cheerio.load(html);
      const rootHost = new URL(rootOrigin).hostname.replace(/^www\./, '');

      // Une balise <base href> modifie la résolution des liens relatifs
      let baseUrl = pageUrl;
      const baseHref = $('base[href]').first().attr('href')?.trim();
      if (baseHref) {
        try {
          baseUrl = new URL(baseHref, pageUrl).href;
        } catch {
          // <base> malformée : ignorée
        }
      }

      $('a[href]').each((_, el) => {
        try {
          const href = $(el).attr('href')?.trim();
          // Ancres, protocoles non-HTTP (mailto:, tel:, javascript:, data:…) et valeurs vides
          if (!href || href.startsWith('#') || NON_HTTP_SCHEME.test(href)) return;

          const resolved = new URL(href, baseUrl);
          if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
          if (resolved.hostname.replace(/^www\./, '') !== rootHost) return;
          if (NON_HTML_EXTENSIONS.test(resolved.pathname)) return;

          // Chemin tel que le site le lie (slash final compris) : le retirer ferait passer chaque lien par une
          // redirection qui n'existe pas pour Google. Le dédoublonnage se fait par `SiteCrawler.urlKey`.
          links.add(`${rootOrigin}${resolved.pathname || '/'}${resolved.search}`);
        } catch {
          // href malformé : ignoré sans interrompre le crawl
        }
      });
    } catch {
      // HTML illisible : aucun lien extrait
    }

    return Array.from(links);
  }

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
      isBlockedByRobotsTxt,
      inSitemap,
      hasSsl = url.startsWith('https://'),
      redirectHops = 0
    } = params;

    const $ = cheerio.load(html);

    // Sépare les mots que le balisage colle ("en<span>EHPAD</span>", "<p>…</p><p>…</p>") avant toute extraction de texte
    $('br').replaceWith(' ');
    $('p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, section, article, td, th, tr, blockquote, button, label, figcaption').each(
      (_, el) => {
        $(el).append(' ');
      }
    );
    $('span, a, strong, em, b, i, small, mark, sup, sub, time, abbr, cite').each((_, el) => {
      $(el).before(' ').after(' ');
    });

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
      // Les images en chargement différé exposent leur vraie source dans data-src
      const rawSrc = $(el).attr('src') || '';
      const src = rawSrc.startsWith('data:')
        ? $(el).attr('data-src') || $(el).attr('data-lazy-src') || rawSrc
        : rawSrc || $(el).attr('data-src') || '';
      const alt = $(el).attr('alt');
      const hasAlt = typeof alt === 'string' && alt.trim().length > 0;
      if (hasAlt) imagesWithAlt++;
      images.push({ src, alt, hasAlt });
    });

    // 6. Liens et Maillage
    let outlinksCount = 0;
    const links: RawPageData['links'] = [];
    const pageHost = hostOf(url);
    const baseHref = $('base[href]').first().attr('href')?.trim();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')?.trim();
      if (href && !href.startsWith('#') && !NON_HTTP_SCHEME.test(href)) {
        outlinksCount++;
        try {
          const resolved = new URL(href, baseHref ? new URL(baseHref, url).href : url);
          if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
          const text = (
            $(el).text() ||
            $(el).find('img[alt]').first().attr('alt') ||
            $(el).attr('aria-label') ||
            $(el).attr('title') ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          links.push({
            href: resolved.href,
            text: text.slice(0, 120),
            internal: hostOf(resolved.href) === pageHost,
            nofollow: NOFOLLOW_REL.test($(el).attr('rel') ?? '')
          });
        } catch {
          // href malformé : compté mais non listé
        }
      }
    });

    // 7. Contenu textuel principal & Mots
    // La date de mise à jour est lue avant le retrait des <script> (JSON-LD)
    const lastUpdated = extractLastUpdated($);
    // Signaux E-E-A-T, données structurées et liens d'autorité : lus AVANT le retrait de nav, header, footer et script
    // (un auteur ou une date placés dans l'en-tête d'un article, ou un JSON-LD, seraient sinon perdus)
    // 8. Signaux E-E-A-T
    const hasAuthor =
      $('[rel="author"]').length > 0 ||
      $('[class*="author" i]').length > 0 ||
      $('[itemprop="author" i]').length > 0;

    const hasPublicationDate =
      $('time').length > 0 ||
      $('[itemprop="datePublished" i]').length > 0 ||
      $('[itemprop="dateModified" i]').length > 0;

    // Indices du rôle de la page (type de contenu, plusieurs cartes <article>, date de publication)
    const roleSignals: RoleSignals = {
      ogType: $('meta[property="og:type" i]').attr('content')?.trim().toLowerCase() || undefined,
      articleElements: $('article').length,
      hasPublishedMeta:
        $('meta[property="article:published_time" i], meta[itemprop="datePublished" i], [itemprop="datePublished" i]')
          .length > 0
    };

    // Coordonnées (téléphone, adresse) : lues sur toute la page, pied de page compris
    const nap = extractNap($);

    // 9. Données Structurées Schéma.org : JSON-LD, microdonnées (itemtype) et RDFa (typeof)
    const schemaTypes: string[] = [];
    const collectTypes = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(collectTypes);
        return;
      }
      const record = node as Record<string, unknown>;
      const type = record['@type'];
      if (Array.isArray(type)) schemaTypes.push(...type.map(String));
      else if (type) schemaTypes.push(String(type));
      if (record['@graph']) collectTypes(record['@graph']);
    };
    $('script[type="application/ld+json" i]').each((_, el) => {
      try {
        collectTypes(JSON.parse($(el).html() || '{}'));
      } catch {
        // JSON-LD malformé : ignoré
      }
    });
    $('[itemtype]').each((_, el) => {
      for (const value of ($(el).attr('itemtype') ?? '').split(/\s+/)) {
        const name = value.split('/').pop();
        if (name) schemaTypes.push(name);
      }
    });
    $('[typeof]').each((_, el) => {
      for (const value of ($(el).attr('typeof') ?? '').split(/\s+/)) {
        const name = value.split(':').pop();
        if (name) schemaTypes.push(name);
      }
    });

    const hasSchemaOrg = schemaTypes.length > 0;

    // 10. Liens d'Autorité Externes
    let externalAuthoritativeLinksCount = 0;
    const authoritativeHosts = [
      '.gov',
      '.gouv.fr',
      '.edu',
      'wikipedia.org',
      'w3.org',
      'iso.org',
      'arxiv.org',
      'insee.fr',
      'service-public.fr',
      'sante.fr',
      'who.int',
      'lemonde.fr',
      'nytimes.com'
    ];
    $('a[href]').each((_, el) => {
      try {
        const host = new URL($(el).attr('href') ?? '', url).hostname.toLowerCase();
        if (authoritativeHosts.some((suffix) => host === suffix.replace(/^\./, '') || host.endsWith(suffix))) {
          externalAuthoritativeLinksCount++;
        }
      } catch {
        // href malformé : ignoré
      }
    });

    $('script, style, noscript, svg, nav, footer, header').remove();
    const bodyText = $('main').length > 0 ? $('main').text() : $('article').length > 0 ? $('article').text() : $('body').text();
    const cleanedText = bodyText.replace(/\s+/g, ' ').trim();
    const words = cleanedText.length > 0 ? cleanedText.split(' ') : [];
    const wordCount = words.length;
    const first100Words = words.slice(0, 100).join(' ');
    const editorialSignals = extractEditorialSignals($, { url, title, h1, text: cleanedText, lastUpdated });

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
      robotsMeta: robotsMeta || undefined,
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
      links,
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
      nap,
      roleSignals,
      bodyText: cleanedText,
      editorialSignals
    };
  }
}
