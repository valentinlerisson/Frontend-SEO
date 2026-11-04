import type { EditorialSignals } from '../types';
import { normalizeQuote } from './citability';

/**
 * Deux critères éditoriaux calculés par le code, et non notés d'un bloc par l'IA :
 *
 * Qualité du contenu (15 pts) : l'IA ne fait que proposer des extraits copiés de la page, chaque extrait n'est retenu
 * que s'il figure mot pour mot dans le contenu (même principe que la citabilité GEO). Grille :
 * - expérience vécue (retour de terrain, ce qui a été fait ou observé) : 1 extrait vérifié = 3 pts, 2 ou plus = 5 pts ;
 * - données ou méthode propres (chiffre, résultat, façon de faire qui n'appartient qu'au site) : 4 pts ;
 * - cas concret (client, projet, situation précise) : 4 pts ;
 * - limites reconnues (contraintes, profils non adaptés, ce que l'offre ne fait pas) : 2 pts.
 *
 * Lisibilité (5 pts) : mesurée sur le contenu principal pendant l'exploration. Paragraphes courts 2 pts, phrases
 * courtes 2 pts, listes ou tableaux sur un texte long 1 pt. Une mesure peu fiable (moins de 3 paragraphes, moins de
 * 10 phrases) sort du calcul au lieu de compter juste ou faux.
 */

export const QUALITY_MAX = 15;
export const READABILITY_MAX = 5;
/** Longueur minimale d'un extrait retenu : en dessous, une coïncidence (« nous ») passerait pour une preuve */
const MIN_QUOTE_CHARS = 20;

export interface QualityChecks {
  /** Extraits d'expérience vécue retrouvés dans la page */
  experience: string[];
  originalData?: string;
  concreteCase?: string;
  limits?: string;
}

export function evaluateContentQuality(input: {
  content: string;
  experienceQuotes: string[];
  originalDataQuote?: string;
  concreteCaseQuote?: string;
  limitsQuote?: string;
}): { score: number; checks: QualityChecks } {
  const content = normalizeQuote(input.content);
  const verified = (quote?: string) => {
    const clean = quote?.trim() ?? '';
    return clean.length >= MIN_QUOTE_CHARS && content.includes(normalizeQuote(clean)) ? clean : undefined;
  };
  const experience = Array.from(new Set(input.experienceQuotes.map((quote) => quote.trim())))
    .filter((quote) => verified(quote))
    .slice(0, 3);
  const checks: QualityChecks = {
    experience,
    originalData: verified(input.originalDataQuote),
    concreteCase: verified(input.concreteCaseQuote),
    limits: verified(input.limitsQuote)
  };
  const score =
    (experience.length >= 2 ? 5 : experience.length === 1 ? 3 : 0) +
    (checks.originalData ? 4 : 0) +
    (checks.concreteCase ? 4 : 0) +
    (checks.limits ? 2 : 0);
  return { score, checks };
}

export interface ReadabilityPoints {
  /** Points obtenus et points réellement mesurables (0 si rien n'est fiable) */
  score: number;
  max: number;
  paragraphs?: number;
  sentences?: number;
  structure: number;
}

export function readabilityPoints(readability: EditorialSignals['readability'], wordCount: number): ReadabilityPoints {
  const r = readability;
  let score = 0;
  let max = 0;
  let paragraphs: number | undefined;
  let sentences: number | undefined;
  if (r.paragraphCount >= 3) {
    paragraphs = r.avgParagraphWords <= 80 && r.longParagraphs / r.paragraphCount <= 0.4 ? 2 : r.avgParagraphWords <= 110 ? 1 : 0;
    score += paragraphs;
    max += 2;
  }
  if (r.sentenceCount >= 10) {
    sentences = r.longSentenceRatio <= 0.35 ? 2 : r.longSentenceRatio <= 0.5 ? 1 : 0;
    score += sentences;
    max += 2;
  }
  // Listes ou tableaux attendus seulement sur un texte long ; une page courte n'en a pas besoin
  const structure = wordCount < 600 || r.listCount + r.tableCount > 0 ? 1 : 0;
  if (max > 0) {
    score += structure;
    max += 1;
  }
  return { score, max, paragraphs, sentences, structure };
}
