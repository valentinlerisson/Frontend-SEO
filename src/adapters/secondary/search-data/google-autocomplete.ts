/**
 * Suggestions Google Autocomplete (vraies requêtes d'internautes), sans clé API.
 * L'endpoint n'est pas documenté officiellement : toute erreur retourne une liste vide
 * et l'analyse continue sans ces données.
 */
export class GoogleAutocomplete {
  private static readonly ENDPOINT = 'https://suggestqueries.google.com/complete/search';
  private static readonly MAX_SUGGESTIONS = 15;
  /** Préfixes interrogatifs : font remonter les questions fréquentes, proches des PAA */
  private static readonly QUESTION_PREFIXES = ['comment', 'pourquoi', 'quel'];

  public static async fetchSuggestions(
    seed: string,
    options: { lang?: string; country?: string } = {}
  ): Promise<string[]> {
    const { lang = 'fr', country = 'fr' } = options;
    const base = seed.trim();
    if (!base) return [];

    const queries = [base, ...this.QUESTION_PREFIXES.map((prefix) => `${prefix} ${base}`)];
    const results = await Promise.all(queries.map((q) => this.fetchOne(q, lang, country)));

    const seen = new Set<string>();
    const merged: string[] = [];
    for (const suggestion of results.flat()) {
      const key = suggestion.toLowerCase();
      if (seen.has(key) || key === base.toLowerCase()) continue;
      seen.add(key);
      merged.push(suggestion);
    }
    return merged.slice(0, this.MAX_SUGGESTIONS);
  }

  /** Suggestions brutes pour une requête exacte (une seule demande, sans préfixe interrogatif) */
  public static async fetchExact(query: string, options: { lang?: string; country?: string } = {}): Promise<string[]> {
    const { lang = 'fr', country = 'fr' } = options;
    return query.trim() ? this.fetchOne(query.trim(), lang, country) : [];
  }

  private static async fetchOne(query: string, lang: string, country: string): Promise<string[]> {
    try {
      const url = `${this.ENDPOINT}?client=firefox&hl=${lang}&gl=${country}&q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000)
      });
      if (!response.ok) return [];

      const data: unknown = await response.json();
      const list = Array.isArray(data) ? data[1] : null;
      if (!Array.isArray(list)) return [];
      return list.filter((item): item is string => typeof item === 'string');
    } catch {
      return [];
    }
  }
}
