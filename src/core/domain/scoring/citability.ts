/**
 * Citabilité GEO (40 pts) calculée par le code à partir d'éléments vérifiables, et non plus notée d'un bloc par l'IA
 * (une note globale variait jusqu'à 20 pts d'une analyse à l'autre sur la même page).
 *
 * L'IA ne fait que proposer des extraits copiés de la page ; chaque extrait n'est retenu que s'il figure mot pour mot
 * dans le contenu. Grille :
 * - passages citables vérifiés (80 à 400 caractères, 3 au plus) : 1 = 8 pts, 2 = 12 pts, 3 = 16 pts ;
 * - définition claire de ce que la page propose ou explique (extrait vérifié) : 8 pts ;
 * - fait précis et vérifiable (extrait vérifié contenant un chiffre) : 8 pts ;
 * - sous-titres H2/H3 formulés en questions, que les moteurs de réponse rapprochent des questions posées :
 *   2 ou plus = 8 pts, 1 = 4 pts (mesuré dans la structure Hn).
 */
export interface CitabilityChecks {
  /** Passages citables vérifiés dans le contenu */
  passages: number;
  definition: boolean;
  fact: boolean;
  /** Sous-titres H2/H3 qui se terminent par un point d'interrogation */
  questionHeadings: number;
}

export const PASSAGE_MIN_CHARS = 80;
export const PASSAGE_MAX_CHARS = 400;
const PASSAGE_POINTS = [0, 8, 12, 16];

/** Comparaison d'extraits copiés : espaces, apostrophes et guillemets normalisés */
export function normalizeQuote(value: string): string {
  return value
    .replace(/[’‘]/g, "'")
    .replace(/[«»“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function scoreCitability(checks: CitabilityChecks): number {
  return (
    PASSAGE_POINTS[Math.min(3, checks.passages)] +
    (checks.definition ? 8 : 0) +
    (checks.fact ? 8 : 0) +
    (checks.questionHeadings >= 2 ? 8 : checks.questionHeadings === 1 ? 4 : 0)
  );
}

export function evaluateCitability(input: {
  excerpt: string;
  headings: { level: number; text: string }[];
  quotablePassages: string[];
  definitionQuote: string;
  factQuote: string;
}): { score: number; checks: CitabilityChecks; quotablePassages: string[] } {
  const content = normalizeQuote(input.excerpt);
  const verified = (quote: string) => quote.trim().length > 0 && content.includes(normalizeQuote(quote));

  const quotablePassages = Array.from(new Set(input.quotablePassages.map((passage) => passage.trim())))
    .filter((passage) => passage.length >= PASSAGE_MIN_CHARS && passage.length <= PASSAGE_MAX_CHARS && verified(passage))
    .slice(0, 3);
  const checks: CitabilityChecks = {
    passages: quotablePassages.length,
    definition: verified(input.definitionQuote),
    fact: verified(input.factQuote) && /\d/.test(input.factQuote),
    questionHeadings: input.headings.filter((h) => (h.level === 2 || h.level === 3) && /\?\s*$/.test(h.text)).length
  };
  return { score: scoreCitability(checks), checks, quotablePassages };
}
