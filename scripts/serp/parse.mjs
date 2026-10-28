import * as cheerio from 'cheerio';

const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/i;
const SNIPPET_SELECTORS = ['.VwiC3b', '[data-sncf]', 'div[style*="line-clamp"]', '.zz3gNc', '[class*="snippet" i]'];

/** Domaine d'une URL, sans « www. » */
export function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Nature d'un lien de résultat :
 *  - { url }      : destination lisible (lien direct, ou `/url?q=https://…`) ;
 *  - { redirect } : redirection Google opaque (`/goto?url=CAES…`, jeton chiffré) à suivre dans le navigateur ;
 *  - null         : lien interne à Google ou illisible.
 */
export function classifyHref(href, base = 'https://www.google.fr') {
  if (!href) return null;
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (!GOOGLE_HOST.test(url.hostname)) return { url: url.href };

  if (!['/url', '/goto'].includes(url.pathname)) return null;
  const target = url.searchParams.get('q') ?? url.searchParams.get('url');
  if (!target) return null;
  try {
    const resolved = new URL(target);
    return GOOGLE_HOST.test(resolved.hostname) ? null : { url: resolved.href };
  } catch {
    // Le paramètre n'est pas une URL : jeton opaque, à résoudre en suivant la redirection
    return { redirect: url.href };
  }
}

/** Destination lisible d'un lien, ou null (compatibilité : ignore les jetons opaques) */
export function resolveGoogleHref(href, base = 'https://www.google.fr') {
  return classifyHref(href, base)?.url ?? null;
}

/**
 * URL affichée sous le titre (« https://site.fr › blog › article ») reconstituée en adresse.
 * Approximative dès qu'il y a un chemin : Google tronque et reformate les segments.
 * Retourne null quand la ligne n'est pas une URL (ex. « Plus de 1,4 k abonnés »).
 */
export function parseCite(text) {
  const clean = (text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (!/^https?:\/\//i.test(clean)) return null;
  const [origin, ...segments] = clean.split(/\s*›\s*/);
  const path = segments.map((s) => s.trim()).filter((s) => s && s !== '…');
  return { url: path.length > 0 ? `${origin.trim()}/${path.join('/')}` : origin.trim(), approximate: segments.length > 0 };
}

function findSnippet($, anchor) {
  // On remonte depuis le lien tant que le bloc ne contient qu'un seul titre de résultat
  let block = $(anchor).parent();
  for (let level = 0; level < 7 && block.length; level++) {
    if (block.find('a h3').length > 1) break;
    for (const selector of SNIPPET_SELECTORS) {
      const text = block.find(selector).first().text().replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    block = block.parent();
  }
  return '';
}

/** Liens annexes (« À propos », « Data & IA »…) affichés sous un résultat, lus dans le bloc du résultat */
function findSitelinks($, anchor) {
  let block = $(anchor).parent();
  for (let level = 0; level < 8 && block.length; level++) {
    if (block.find('a h3').length > 1) break;
    const nodes = block.find('h3[role="heading"] a, h3.D33W6b a');
    if (nodes.length > 0) {
      const links = [];
      nodes.each((_, node) => {
        const link = classifyHref($(node).attr('href'));
        const title = $(node).text().replace(/\s+/g, ' ').trim();
        if (link && title) links.push({ title, url: link.url ?? '', ...(link.redirect ? { redirect: link.redirect } : {}) });
      });
      return links.slice(0, 8);
    }
    block = block.parent();
  }
  return [];
}

/**
 * Résultats organiques d'une page de résultats Google, depuis son HTML.
 * `options.ownDomain` : pour les résultats de ce domaine, les liens annexes sont aussi extraits.
 * Un résultat = un lien contenant un <h3> dans #search. Les doublons d'URL sont ignorés.
 * Les liens à jeton opaque ont `url` vide et un champ `redirect` : le script les résout dans le navigateur
 * (`resolveRedirects`), avec l'adresse affichée (`displayUrl`) comme repli.
 */
export function parseGoogleResults(html, startPosition = 1, options = {}) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $('#search a h3').each((_, h3) => {
    const anchor = $(h3).closest('a');
    const link = classifyHref(anchor.attr('href'));
    const title = $(h3).text().replace(/\s+/g, ' ').trim();
    if (!link || !title) return;

    const cite = parseCite(anchor.find('cite').first().text());
    const key = link.url ?? link.redirect;
    if (seen.has(key)) return;
    seen.add(key);

    const domain = domainOf(link.url ?? cite?.url ?? '');
    const own = options.ownDomain ? domain === options.ownDomain || domain.endsWith(`.${options.ownDomain}`) : false;
    const sitelinks = own ? findSitelinks($, anchor) : [];

    results.push({
      position: startPosition + results.length,
      title,
      url: link.url ?? '',
      snippet: findSnippet($, anchor),
      domain,
      ...(sitelinks.length > 0 ? { sitelinks } : {}),
      ...(link.redirect ? { redirect: link.redirect, displayUrl: cite?.url ?? '', displayApproximate: cite?.approximate ?? false } : {}),
    });
  });

  return results;
}

/**
 * Éléments de la page de résultats hors liens organiques, relevés pour information (hors score) :
 *  - localPack : bloc de fiches d'établissements (carte « Lieux ») ;
 *  - peopleAlsoAsk : questions du bloc « Autres questions posées ».
 * Repérage par attributs et libellés de Google : fragile, à revoir si Google change sa page.
 */
export function parseSerpFeatures(html) {
  const $ = cheerio.load(html);
  const text = $('#search, #rso, body').first().text();
  const localPack =
    $('[data-cid]').length > 0 ||
    $('a[href*="tbm=lcl"], a[href*="udm=1"]').length > 0 ||
    /Plus de lieux|Plus d.entreprises|Afficher plus de lieux/i.test(text);
  const questions = new Set();
  $('[data-q]').each((_, el) => {
    const question = ($(el).attr('data-q') ?? '').replace(/\s+/g, ' ').trim();
    if (question.length > 5) questions.add(question);
  });
  return { localPack, peopleAlsoAsk: Array.from(questions).slice(0, 8) };
}

/**
 * Suit chaque redirection Google opaque avec le contexte du navigateur (mêmes cookies, sans suivre le saut) pour lire
 * la destination dans l'en-tête `location`. En cas d'échec, l'adresse affichée sous le titre sert de repli.
 * `pause` : attente entre deux requêtes (ms).
 */
export async function resolveRedirects(context, results, pause = () => 300 + Math.random() * 600) {
  for (const result of results) {
    if (!result.redirect) continue;
    let resolved = '';
    try {
      const response = await context.request.fetch(result.redirect, { maxRedirects: 0, failOnStatusCode: false });
      const location = response.headers()['location'];
      if (location) resolved = classifyHref(location)?.url ?? '';
    } catch {
      // Redirection non suivie : repli sur l'adresse affichée
    }
    if (!resolved && result.displayUrl) {
      resolved = result.displayUrl;
      result.urlApproximate = result.displayApproximate;
    }
    result.url = resolved;
    result.domain = domainOf(resolved);
    delete result.redirect;
    delete result.displayUrl;
    delete result.displayApproximate;
    await new Promise((resolve) => setTimeout(resolve, pause()));
  }

  // Liens annexes du domaine audité : destination lue de la même façon, sans repli approximatif
  for (const result of results) {
    for (const sitelink of result.sitelinks ?? []) {
      if (!sitelink.redirect) continue;
      try {
        const response = await context.request.fetch(sitelink.redirect, { maxRedirects: 0, failOnStatusCode: false });
        const location = response.headers()['location'];
        if (location) sitelink.url = classifyHref(location)?.url ?? '';
      } catch {
        // Lien annexe non résolu : ignoré
      }
      delete sitelink.redirect;
      await new Promise((resolve) => setTimeout(resolve, pause()));
    }
    if (result.sitelinks) result.sitelinks = result.sitelinks.filter((sitelink) => sitelink.url);
  }
  return results;
}
