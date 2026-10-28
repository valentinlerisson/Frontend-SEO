import type { SearchInsights, SearchIntent } from '../types';

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const PATTERNS: { intent: SearchIntent; pattern: RegExp }[] = [
  { intent: 'TRANSACTIONAL', pattern: /\b(prix|tarifs?|devis|acheter|achat|commander|reserver|location|louer|pas cher|promo|gratuit)\b/ },
  { intent: 'COMMERCIAL', pattern: /\b(avis|meilleurs?|comparatif|comparer|vs|alternatives?|top \d+|test)\b/ },
  {
    intent: 'INFORMATIONAL',
    pattern: /\b(comment|pourquoi|quand|quel(le)?s?|qu ?est|c est quoi|definition|exemples?|guide|difference|tuto(riel)?|signification)\b/
  }
];

/**
 * Intention déduite des suggestions Google Autocomplete (vraies requêtes d'internautes) : une suggestion est classée
 * par le premier indice trouvé (transactionnel, puis commercial, puis informationnel). Sert de preuve à l'intention
 * affichée, sans appel à l'IA.
 */
export function detectIntentFromSuggestions(suggestions: string[]): NonNullable<SearchInsights['intentEvidence']> {
  const counts: Partial<Record<SearchIntent, number>> = {};
  const byIntent: Partial<Record<SearchIntent, string[]>> = {};

  for (const suggestion of suggestions) {
    const text = normalize(suggestion);
    const match = PATTERNS.find(({ pattern }) => pattern.test(text));
    if (!match) continue;
    counts[match.intent] = (counts[match.intent] ?? 0) + 1;
    byIntent[match.intent] = [...(byIntent[match.intent] ?? []), suggestion];
  }

  const classified = Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
  if (classified < 3) return { total: suggestions.length, dominant: null, counts, examples: [] };

  const [dominant] = (Object.entries(counts) as [SearchIntent, number][]).sort((a, b) => b[1] - a[1])[0];
  return { total: suggestions.length, dominant, counts, examples: (byIntent[dominant] ?? []).slice(0, 3) };
}
