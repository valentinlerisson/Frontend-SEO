import type { SearchIntent, SerpAnalysis, SerpCompetitorPage, SerpResult } from '../types';

const STOP_WORDS = new Set([
  'dans', 'pour', 'avec', 'votre', 'vous', 'nous', 'notre', 'nos', 'vos', 'plus', 'comme', 'mais', 'sont', 'etre',
  'cette', 'entre', 'tout', 'tous', 'tres', 'aussi', 'sans', 'chez', 'leur', 'leurs', 'quel', 'quelle', 'quels',
  'quelles', 'comment', 'pourquoi', 'quand', 'quoi', 'faire', 'avoir', 'fait', 'ainsi', 'alors', 'apres', 'avant',
  'donc', 'encore', 'depuis', 'selon', 'sous', 'vers', 'que', 'qui', 'les', 'des', 'une', 'est'
]);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function tokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Positions du domaine dans les résultats (plusieurs pages du site = cannibalisation avérée) */
export function findOwnResults(results: SerpResult[], domain: string): { position: number; url: string }[] {
  const own = domain.toLowerCase().replace(/^www\./, '');
  return results
    .filter((result) => result.domain === own || result.domain.endsWith(`.${own}`))
    .map(({ position, url }) => ({ position, url }));
}

const urlKey = (url: string) => {
  try {
    const u = new URL(url);
    const pathname = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${pathname}${u.search}`;
  } catch {
    return url;
  }
};

/** Place d'une page précise : résultat à part entière, ou lien annexe sous un résultat du même site */
export function locatePage(
  results: SerpResult[],
  pageUrl: string
): { pagePosition: number | null; pageSitelinkOf: number | null } {
  const key = urlKey(pageUrl);
  const direct = results.find((result) => urlKey(result.url) === key);
  if (direct) return { pagePosition: direct.position, pageSitelinkOf: null };
  const parent = results.find((result) => (result.sitelinks ?? []).some((link) => urlKey(link.url) === key));
  return { pagePosition: null, pageSitelinkOf: parent ? parent.position : null };
}

/**
 * Sections (H2/H3) qui reviennent chez au moins deux concurrents du Top et dont les mots manquent à la page.
 * Avec un seul concurrent lisible, ses titres servent d'indication plus faible (6 au plus).
 */
export function findHeadingGaps(ourText: string, competitors: SerpCompetitorPage[]): string[] {
  const ours = tokens(ourText);
  const entries = competitors.flatMap((competitor, owner) =>
    competitor.headings.map((text) => ({ text, owner, words: tokens(text) })).filter((entry) => entry.words.size >= 1)
  );
  const ownerCount = new Set(entries.map((entry) => entry.owner)).size;
  if (ownerCount === 0) return [];

  const gaps: { text: string; words: Set<string> }[] = [];
  for (const entry of entries) {
    const support = new Set(entries.filter((other) => jaccard(entry.words, other.words) >= 0.5).map((o) => o.owner));
    if (ownerCount >= 2 && support.size < 2) continue;

    const covered = Array.from(entry.words).filter((word) => ours.has(word)).length / entry.words.size;
    if (covered >= 0.6) continue;
    // Une même section reformulée chez plusieurs concurrents n'est signalée qu'une fois
    if (gaps.some((gap) => jaccard(gap.words, entry.words) >= 0.5)) continue;
    gaps.push({ text: entry.text.replace(/\s+/g, ' ').trim().slice(0, 90), words: entry.words });
  }
  return gaps.slice(0, ownerCount >= 2 ? 8 : 6).map((gap) => gap.text);
}

/**
 * Intention dominante des résultats, d'après leurs titres et extraits. « Conseil » est exclu : c'est aussi un métier
 * (agence de conseil). Une intention n'est retenue que si elle concerne au moins 40 % des résultats (3 au minimum).
 */
export function detectSerpIntent(results: SerpResult[]): SerpAnalysis['intent'] {
  const counts: Partial<Record<SearchIntent, number>> = {};
  for (const result of results) {
    const text = normalize(`${result.title} ${result.snippet}`);
    let intent: SearchIntent | null = null;
    if (/\b(prix|tarifs?|devis|acheter|achat|commander|reserver|location|louer|pas cher|promo)\b/.test(text)) {
      intent = 'TRANSACTIONAL';
    } else if (/\b(meilleurs?|comparatif|avis|top \d+|test|vs)\b/.test(text)) {
      intent = 'COMMERCIAL';
    } else if (/\b(comment|pourquoi|qu['’ ]est[- ]ce|guide|definition|tutoriel|astuces?|exemples?)\b/.test(text)) {
      intent = 'INFORMATIONAL';
    }
    if (intent) counts[intent] = (counts[intent] ?? 0) + 1;
  }

  const ranked = (Object.entries(counts) as [SearchIntent, number][]).sort((a, b) => b[1] - a[1]);
  const needed = Math.max(3, Math.ceil(results.length * 0.4));
  if (ranked.length === 0 || ranked[0][1] < needed) return { dominant: null, counts };
  return { dominant: ranked[0][0], counts };
}

/** Longueur moyenne des titres et des extraits affichés par Google pour ces résultats */
export function benchmarkSnippets(results: SerpResult[]): SerpAnalysis['snippetBenchmark'] {
  const average = (values: number[]) =>
    values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    avgTitleLength: average(results.map((result) => result.title.length).filter((length) => length > 0)),
    avgSnippetLength: average(results.map((result) => result.snippet.length).filter((length) => length > 0))
  };
}

export function buildSerpAnalysis(params: {
  query: string;
  fetchedAt: string;
  results: SerpResult[];
  domain: string;
  pageUrl: string;
  competitors: SerpCompetitorPage[];
  ourText: string;
  features?: SerpAnalysis['features'];
}): SerpAnalysis {
  const own = findOwnResults(params.results, params.domain);
  const wordCounts = params.competitors.map((c) => c.wordCount).filter((count) => count > 0);
  return {
    status: 'DONE',
    query: params.query,
    fetchedAt: params.fetchedAt,
    results: params.results,
    features: params.features,
    depth: params.results.length,
    ownPosition: own.length > 0 ? Math.min(...own.map((o) => o.position)) : null,
    ...locatePage(params.results, params.pageUrl),
    ownUrls: own,
    competitors: params.competitors,
    gaps: {
      missingSections: findHeadingGaps(params.ourText, params.competitors),
      competitorAvgWords:
        wordCounts.length === 0 ? null : Math.round(wordCounts.reduce((sum, count) => sum + count, 0) / wordCounts.length)
    },
    intent: detectSerpIntent(params.results),
    snippetBenchmark: benchmarkSnippets(params.results)
  };
}
