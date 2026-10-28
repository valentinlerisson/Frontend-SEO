import type { SynthesisAdvice } from '@/lib/audit-data';
import type { EditorialEvaluation } from '@/core/domain/types';

export interface AnalyzedPillar {
  path: string;
  editorialScore: number;
  engine: 'LLM' | 'HEURISTIC';
  evaluation: EditorialEvaluation;
}

type Criterion = {
  label: string;
  max: number;
  score: (e: EditorialEvaluation) => number;
  advice: (e: EditorialEvaluation) => string;
};

/** Critères du score éditorial, avec leur barème (voir docs/Fichier.md §4.2) */
const CRITERIA: Criterion[] = [
  {
    label: 'la correspondance avec l’intention de recherche',
    max: 20,
    score: (e) => e.intentMatch.score,
    advice: (e) => e.intentMatch.actionableAdvice,
  },
  {
    label: 'l’unicité du ciblage entre vos pages',
    max: 20,
    score: (e) => e.cannibalizationRisk.score,
    advice: (e) => e.cannibalizationRisk.actionableAdvice,
  },
  {
    label: 'le placement de la requête dans le Title, le H1 et l’introduction',
    max: 15,
    score: (e) => e.hotZonesOptimization.score,
    advice: (e) => e.hotZonesOptimization.actionableAdvice,
  },
  {
    label: 'la réponse donnée dès le début de la page',
    max: 15,
    score: (e) => e.primaryContentTldr.score,
    advice: (e) => e.primaryContentTldr.actionableAdvice,
  },
  {
    label: 'la couverture du sujet et le vocabulaire métier',
    max: 20,
    score: (e) => e.semanticDepth.score,
    advice: (e) => e.semanticDepth.actionableAdvice,
  },
  {
    label: 'les signaux de confiance et d’expertise',
    max: 10,
    score: (e) => e.eeatSignals.score,
    advice: (e) => e.eeatSignals.actionableAdvice,
  },
];

/**
 * Conseil de synthèse, déterministe (aucun appel IA supplémentaire) : il s'appuie sur les analyses
 * déjà produites pour les pages piliers (point faible, point fort, action rapide).
 */
export function buildSynthesisAdvice(pillars: AnalyzedPillar[]): SynthesisAdvice | null {
  if (pillars.length === 0) return null;

  const stats = CRITERIA.map((criterion) => {
    const rows = pillars.map((pillar) => ({
      pillar,
      ratio: criterion.score(pillar.evaluation) / criterion.max,
    }));
    const average = rows.reduce((sum, row) => sum + row.ratio, 0) / rows.length;
    const worst = rows.reduce((min, row) => (row.ratio < min.ratio ? row : min));
    return { criterion, average, worst };
  });

  const weakest = stats.reduce((min, row) => (row.average < min.average ? row : min));
  const strongest = stats.reduce((max, row) => (row.average > max.average ? row : max));
  const weakestPercent = Math.round(weakest.average * 100);
  const strongestPercent = Math.round(strongest.average * 100);

  const points: SynthesisAdvice['points'] = [
    {
      label: 'Point faible à traiter en premier',
      text: `Sur ${pillars.length} page${pillars.length > 1 ? 's' : ''} pilier${pillars.length > 1 ? 's' : ''}, ${weakest.criterion.label} est le critère le moins bien servi (${weakestPercent} % en moyenne). Page la plus concernée : ${weakest.worst.pillar.path}. ${weakest.criterion.advice(weakest.worst.pillar.evaluation)}`.trim(),
    },
  ];

  if (strongest.criterion !== weakest.criterion) {
    points.push({
      label: 'Point fort à conserver',
      text: `${strongest.criterion.label.charAt(0).toUpperCase()}${strongest.criterion.label.slice(1)} (${strongestPercent} % en moyenne).`,
    });
  }

  const lowestPage = pillars.reduce((min, pillar) => (pillar.editorialScore < min.editorialScore ? pillar : min));
  const quickWin = lowestPage.evaluation.quickWins[0];
  if (quickWin) {
    points.push({
      label: 'Action rapide',
      text: `${lowestPage.path} (score éditorial le plus bas, ${Math.round(lowestPage.editorialScore)}/100) : ${quickWin}`,
    });
  }

  const llmCount = pillars.filter((pillar) => pillar.engine === 'LLM').length;
  return {
    headline: `Pour progresser, concentrez-vous sur ${weakest.criterion.label}.`,
    points,
    note:
      llmCount === pillars.length
        ? undefined
        : llmCount === 0
          ? 'Conseil basé sur l’analyse heuristique locale : l’IA n’a pas répondu pour ces pages.'
          : `Conseil établi à partir de ${llmCount} page${llmCount > 1 ? 's' : ''} analysée${llmCount > 1 ? 's' : ''} par l’IA sur ${pillars.length}.`,
  };
}
