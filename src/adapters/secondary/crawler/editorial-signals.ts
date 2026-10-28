import * as cheerio from 'cheerio';
import type { EditorialSignals } from '@/core/domain/types';

const LONG_PARAGRAPH_WORDS = 100;
const LONG_SENTENCE_WORDS = 25;
const MAX_LISTED_LINKS = 60;
/** Une année est jugée révolue à partir de deux ans d'écart */
const OUTDATED_AFTER_YEARS = 2;
const MAX_OUTDATED_MENTIONS = 8;
/** Ce qui suit un nombre à quatre chiffres et en fait un prix, une mesure ou un modèle */
const NUMBER_AFTER = /^\s*(€|euros?\b|eur\b|\$|£|%|k?g\b|kw\b|w\b|v\b|ah\b|mm\b|cm\b|m2|m²|km\b|l\b|litres?\b|tr\b|stc\b|pers|places?\b|\d)/i;
/** Ce qui précède un nombre et en fait un modèle, une référence, un identifiant ou un nombre à séparateur de milliers */
const NOT_A_YEAR_BEFORE = /(?:\b(?:mod[èe]le|r[ée]f\.?|no\.?|rcs|siret|siren|air top|type|s[ée]rie|code postal|cp|t[ée]l\.?)|n°|\+33|\d[\s  ])\s*$/;
/** Indices de date devant une année dans le texte courant */
const DATE_CUE_BEFORE = /(?:\b(?:en|depuis|d[èe]s|avant|apr[èe]s|jusqu['’]en|durant|copyright|mise? à jour|mis à jour|[ée]dition|saison|mill[ée]sime|ann[ée]e|fin|d[ée]but|printemps|[ée]t[ée]|automne|hiver|janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)|©)\s*$/i;
const EXCERPT_RADIUS = 50;

/** Ancres qui ne décrivent pas la page de destination (comparées sans accents, casse ni ponctuation) */
const GENERIC_ANCHORS = new Set([
  'en savoir plus',
  'savoir plus',
  'lire la suite',
  'lire plus',
  'lire l article',
  'lire la suite de l article',
  'cliquez ici',
  'cliquer ici',
  'clic ici',
  'ici',
  'voir plus',
  'voir la suite',
  'voir tout',
  'plus d infos',
  'plus d informations',
  'decouvrir',
  'decouvrez',
  'suite',
  'read more',
  'learn more',
  'click here',
  'here',
  'more',
  'details'
]);

function normalizeAnchor(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** « Nous contacter Nous contacter » devient « Nous contacter » (libellé doublé pour l'accessibilité ou l'animation) */
export function dedupeRepeatedLabel(text: string): string {
  const words = text.split(' ');
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    if (words.slice(0, half).join(' ') === words.slice(half).join(' ')) return words.slice(0, half).join(' ');
  }
  return text;
}

export function isGenericAnchor(text: string): boolean {
  const normalized = normalizeAnchor(text);
  return normalized === '' || GENERIC_ANCHORS.has(normalized);
}

/** Contenu conditionné à l'acceptation de cookies tiers (cartes, modules, vidéos) */
const CONSENT_GATED = [
  /(accepter|acceptez|autoriser|autorisez)\s+les\s+cookies[^.]{0,100}(acc[eè]s|afficher|voir|charger|module|contenu|carte|vid[eé]o)/i,
  /pour\s+avoir\s+acc[eè]s\s+au\s+module/i
];

const COUNT_LABELS = /(\d{1,3}(?:[\s\u00a0\u202f.]\d{3})+|\d+)\s+(établissements?|résidences?|ehpad|collaborateurs?|salariés?|lits|places|agences?|magasins?)\b/gi;

/** Chiffres-clés « N établissements », comparés d'une page à l'autre */
function extractCounts(text: string): { label: string; value: number }[] {
  const counts: { label: string; value: number }[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(COUNT_LABELS)) {
    const value = Number(match[1].replace(/[^\d]/g, ''));
    const label = match[2]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/s$/, '');
    const key = `${label}|${value}`;
    if (!Number.isFinite(value) || value < 3 || seen.has(key)) continue;
    seen.add(key);
    counts.push({ label, value });
    if (counts.length >= 12) break;
  }
  return counts;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function toIsoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Date de dernière mise à jour déclarée par la page (balises meta, microdonnées, JSON-LD).
 * À appeler AVANT le retrait des <script> du DOM.
 */
export function extractLastUpdated($: cheerio.CheerioAPI): string | undefined {
  const candidates: (string | undefined)[] = [
    $('meta[property="article:modified_time" i]').attr('content'),
    $('meta[property="og:updated_time" i]').attr('content'),
    $('meta[itemprop="dateModified" i]').attr('content'),
    $('[itemprop="dateModified" i]').attr('datetime') ?? $('[itemprop="dateModified" i]').attr('content')
  ];

  $('script[type="application/ld+json"]').each((_, el) => {
    const match = ($(el).html() ?? '').match(/"dateModified"\s*:\s*"([^"]+)"/);
    if (match) candidates.push(match[1]);
  });

  for (const candidate of candidates) {
    const iso = toIsoDate(candidate);
    if (iso) return iso;
  }
  return undefined;
}

function findOutdatedMentions(
  sources: { zone: 'TITLE' | 'H1' | 'CONTENT'; text: string }[],
  currentYear: number
): EditorialSignals['freshness']['outdatedMentions'] {
  const mentions: EditorialSignals['freshness']['outdatedMentions'] = [];
  const seen = new Set<string>();

  for (const { zone, text } of sources) {
    for (const match of text.matchAll(/\b(19[9]\d|20\d{2})\b/g)) {
      const year = Number(match[1]);
      if (year > currentYear - OUTDATED_AFTER_YEARS) continue;

      const index = match.index ?? 0;
      const before = text.slice(Math.max(0, index - 16), index).toLowerCase();
      const after = text.slice(index + match[0].length, index + match[0].length + 8);

      // Nombre, prix, modèle ou référence plutôt qu'une année : monnaie, unité, séparateur de milliers…
      if (NUMBER_AFTER.test(after) || NOT_A_YEAR_BEFORE.test(before)) continue;
      // Dans le texte courant, une année doit être introduite par un repère de date
      if (zone === 'CONTENT' && !DATE_CUE_BEFORE.test(before)) continue;
      const excerpt = text
        .slice(Math.max(0, index - EXCERPT_RADIUS), index + match[0].length + EXCERPT_RADIUS)
        .replace(/\s+/g, ' ')
        .trim();
      const key = `${year}|${excerpt}`;
      if (seen.has(key)) continue;
      seen.add(key);

      mentions.push({ year, excerpt, zone });
      if (mentions.length >= MAX_OUTDATED_MENTIONS) return mentions;
    }
  }
  return mentions;
}

/**
 * Diagnostics éditoriaux objectifs. Le contenu principal est `main`, à défaut `article`, à défaut `body`,
 * sans les zones de navigation (nav, header, footer, aside, formulaires), pour ne mesurer que le contenu.
 * À appeler APRÈS le retrait de nav/header/footer/script du DOM.
 */
export function extractEditorialSignals(
  $: cheerio.CheerioAPI,
  params: { url: string; title?: string; h1?: string; text: string; lastUpdated?: string }
): EditorialSignals {
  const currentYear = new Date().getFullYear();

  const root = $('main').first().length
    ? $('main').first()
    : $('article').first().length
      ? $('article').first()
      : $('body');
  const $content = cheerio.load(`<div id="root">${root.html() ?? ''}</div>`);
  $content('aside, form, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();
  // Le fil d'Ariane n'est pas du maillage contextuel
  $content(
    'nav[aria-label*="ariane" i], nav[aria-label*="breadcrumb" i], [class*="breadcrumb" i], [class*="ariane" i], [itemtype*="BreadcrumbList"], [typeof="BreadcrumbList"]'
  ).remove();

  // Lisibilité
  const paragraphs: number[] = [];
  let sentenceCount = 0;
  let longSentences = 0;
  $content('#root p').each((_, el) => {
    const text = $content(el).text().replace(/\s+/g, ' ').trim();
    const words = text ? text.split(' ').length : 0;
    if (words < 3) return;
    paragraphs.push(words);
    for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
      const sentenceWords = sentence.trim() ? sentence.trim().split(' ').length : 0;
      if (sentenceWords === 0) continue;
      sentenceCount++;
      if (sentenceWords > LONG_SENTENCE_WORDS) longSentences++;
    }
  });

  let listCount = 0;
  $content('#root ul, #root ol').each((_, el) => {
    if ($content(el).children('li').length >= 2) listCount++;
  });

  // Maillage dans le contenu
  const pageHost = hostOf(params.url);
  const links: EditorialSignals['inContentLinks']['links'] = [];
  let internal = 0;
  let external = 0;
  let generic = 0;
  // Texte d'ancre : texte visible s'il contient des lettres, sinon alt d'image, aria-label ou title.
  // Un libellé répété (texte visible + texte pour lecteur d'écran) n'est gardé qu'une fois.
  const anchorText = (el: Parameters<typeof $content>[0]) => {
    const visible = dedupeRepeatedLabel($content(el).text().replace(/\s+/g, ' ').trim());
    if (/\p{L}/u.test(visible)) return visible;
    return (
      $content(el).find('img[alt]').first().attr('alt') ||
      $content(el).attr('aria-label') ||
      $content(el).attr('title') ||
      visible
    )
      .replace(/\s+/g, ' ')
      .trim();
  };
  const candidates: { href: string; text: string; internal: boolean }[] = [];
  $content('#root a[href]').each((_, el) => {
    const href = $content(el).attr('href')?.trim();
    if (!href || href.startsWith('#') || /^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(href)) return;
    try {
      const resolved = new URL(href, params.url);
      candidates.push({ href: resolved.href, text: anchorText(el), internal: hostOf(resolved.href) === pageHost });
    } catch {
      // href malformé : ignoré
    }
  });
  // Une icône (« + », flèche) qui double un lien descriptif vers la même page n'est pas une ancre générique
  const describedHrefs = new Set(candidates.filter((link) => !isGenericAnchor(link.text)).map((link) => link.href));
  for (const link of candidates) {
    const isGeneric = isGenericAnchor(link.text) && !describedHrefs.has(link.href);
    if (link.internal) internal++;
    else external++;
    if (isGeneric) generic++;
    if (links.length < MAX_LISTED_LINKS) {
      links.push({ href: link.href, text: link.text.slice(0, 120), internal: link.internal, generic: isGeneric });
    }
  }

  const rootText = $content('#root').text().replace(/\s+/g, ' ');
  const consentGated = CONSENT_GATED.some((pattern) => pattern.test(rootText));

  return {
    consentGated,
    facts: { counts: extractCounts(params.text) },
    freshness: {
      currentYear,
      outdatedMentions: findOutdatedMentions(
        [
          { zone: 'TITLE', text: params.title ?? '' },
          { zone: 'H1', text: params.h1 ?? '' },
          { zone: 'CONTENT', text: params.text }
        ],
        currentYear
      ),
      lastUpdated: params.lastUpdated
    },
    readability: {
      paragraphCount: paragraphs.length,
      avgParagraphWords: paragraphs.length
        ? Math.round(paragraphs.reduce((sum, words) => sum + words, 0) / paragraphs.length)
        : 0,
      longParagraphs: paragraphs.filter((words) => words > LONG_PARAGRAPH_WORDS).length,
      sentenceCount,
      longSentenceRatio: sentenceCount ? Math.round((longSentences / sentenceCount) * 100) / 100 : 0,
      listCount,
      tableCount: $content('#root table').length
    },
    inContentLinks: { total: internal + external, internal, external, genericAnchors: generic, links }
  };
}
