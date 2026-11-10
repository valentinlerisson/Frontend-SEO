import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { DiscoveredBacklink } from '@/core/domain/types';
import { classifyAnchor, classifyLinkLocation, hostOf, isSameSite, mentionsBrand, windowAround, type LinkAncestor } from '@/core/domain/backlink-discovery';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
};

/** Taille de page lue au plus (octets de texte) et nombre de liens relevés par page */
const MAX_HTML_CHARS = 3_000_000;
const MAX_LINKS_PER_PAGE = 5;
const MAX_ANCHOR_CHARS = 200;

export type LinkFromPage = Omit<DiscoveredBacklink, 'inCommonCrawl' | 'foundBy' | 'sourceDomain'>;

export type PageRead =
  | { status: 'UNREACHABLE'; reason: string }
  | {
      status: 'OK';
      finalUrl: string;
      title: string;
      links: LinkFromPage[];
      /** La page écrit le nom de domaine ou la marque du site audité dans son texte (avec ou sans lien) */
      mentionsTarget: boolean;
    };

/** Adresse publique seulement : http ou https, jamais un nom d'hôte local ou une adresse IP */
export function isPublicHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
    return true;
  } catch {
    return false;
  }
}

const rootOf = ($: cheerio.CheerioAPI) => {
  const main = $('main, article, [role="main"]').first();
  return main.length ? main : $('body');
};

/**
 * Lit une page et relève ses liens vers le site audité : adresse, texte, rel (nofollow, sponsored, ugc), emplacement
 * d'après les balises parentes, nature de l'ancre, nombre de liens vers d'autres sites dans le contenu, paragraphe
 * autour du lien. Tout est mesuré par le code. Un lien ajouté par JavaScript n'est pas vu (lecture sans navigateur).
 */
export async function readBacklinkPage(url: string, target: string, brands: string[]): Promise<PageRead> {
  if (!isPublicHttpUrl(url)) return { status: 'UNREACHABLE', reason: 'adresse non publique' };
  let finalUrl = url;
  let html: string;
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12_000) });
    finalUrl = response.url || url;
    if (!isPublicHttpUrl(finalUrl)) return { status: 'UNREACHABLE', reason: 'redirection vers une adresse non publique' };
    if (!response.ok) return { status: 'UNREACHABLE', reason: `HTTP ${response.status}` };
    const type = response.headers.get('content-type') ?? '';
    if (type && !/html|xml/i.test(type)) return { status: 'UNREACHABLE', reason: 'ce n’est pas une page web' };
    html = (await response.text()).slice(0, MAX_HTML_CHARS);
  } catch (err: any) {
    return { status: 'UNREACHABLE', reason: err?.name === 'TimeoutError' ? 'délai dépassé' : 'injoignable' };
  }
  return parseBacklinkPage(html, finalUrl, target, brands);
}

/**
 * Analyse du texte HTML d'une page déjà téléchargée : liens vers `target` et leurs mesures (voir `readBacklinkPage`).
 * Séparée de la lecture réseau pour pouvoir être testée sur du HTML écrit à la main.
 */
export function parseBacklinkPage(html: string, finalUrl: string, target: string, brands: string[]): Extract<PageRead, { status: 'OK' }> {
  const $ = cheerio.load(html);
  const title = $('title').first().text().replace(/\s+/g, ' ').trim() || $('h1').first().text().replace(/\s+/g, ' ').trim();
  const sourceHost = hostOf(finalUrl);
  const bareTarget = target.toLowerCase().replace(/^www\./, '');
  const mentionsTarget = mentionsBrand($('body').text(), bareTarget, brands);

  // Liens du site audité : repérés d'un numéro avant toute modification de la page
  const mine: { node: AnyNode; href: string }[] = [];
  $('a[href]').each((_, node) => {
    let href: string;
    try {
      href = new URL($(node).attr('href') ?? '', finalUrl).href;
    } catch {
      return;
    }
    if (!/^https?:/i.test(href) || !isSameSite(hostOf(href), bareTarget)) return;
    // Un lien du site audité vers lui-même (sur une page du site) n'est pas un backlink
    if (isSameSite(sourceHost, bareTarget)) return;
    $(node).attr('data-bl-idx', String(mine.length));
    mine.push({ node, href });
  });
  if (mine.length === 0) return { status: 'OK', finalUrl, title, links: [], mentionsTarget };

  // Liens vers d'autres sites dans le contenu principal (sans menu, pied de page ni colonne latérale)
  const contentRoot = rootOf($);
  let externalLinksInContent = 0;
  contentRoot.find('a[href]').each((_, node) => {
    const el = $(node);
    if (el.closest('nav, footer, aside, header, [role="navigation"], [role="contentinfo"]').length) return;
    try {
      const host = hostOf(new URL(el.attr('href') ?? '', finalUrl).href);
      if (host && !isSameSite(host, sourceHost) && !isSameSite(host, bareTarget)) externalLinksInContent++;
    } catch {
      // adresse illisible : ignorée
    }
  });

  const links: LinkFromPage[] = [];
  for (const [index, { node, href }] of mine.slice(0, MAX_LINKS_PER_PAGE).entries()) {
    const el = $(node);
    const text = el.text().replace(/\s+/g, ' ').trim();
    const anchor = (text || el.find('img[alt]').first().attr('alt') || el.attr('aria-label') || el.attr('title') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_ANCHOR_CHARS);
    // Une image sans texte reste classée « image » même si son alt donne une ancre lisible
    const anchorType = text ? classifyAnchor(text, brands) : 'image';

    const ancestors: LinkAncestor[] = el
      .parents()
      .toArray()
      .map((parent) => ({
        tag: ((parent as { tagName?: string }).tagName ?? '').toLowerCase(),
        role: $(parent).attr('role')?.toLowerCase(),
        id: $(parent).attr('id'),
        className: $(parent).attr('class')
      }));
    const rel = (el.attr('rel') ?? '').toLowerCase().split(/\s+/);

    // Paragraphe autour du lien, le lien remplacé par un repère dans une copie
    const marker = `[[LIEN : ${anchor || 'image'}]]`;
    const block = el.closest('p, li, td, dd, blockquote, figcaption').first();
    const copy = (block.length ? block : el.parent()).clone();
    copy.find(`[data-bl-idx="${index}"]`).first().replaceWith(marker);
    const context = windowAround(copy.text(), marker);

    links.push({
      sourceUrl: finalUrl,
      sourceTitle: title || undefined,
      targetUrl: href,
      anchor,
      anchorType,
      nofollow: rel.includes('nofollow'),
      sponsored: rel.includes('sponsored'),
      ugc: rel.includes('ugc'),
      location: classifyLinkLocation(ancestors),
      externalLinksInContent,
      context
    });
  }
  return { status: 'OK', finalUrl, title, links, mentionsTarget };
}
