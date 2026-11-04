import type { SynthesisAdvice } from '@/lib/audit-data';
import type { EditorialCriterion, EditorialEvaluation } from '@/core/domain/types';

export interface AnalyzedPillar {
  path: string;
  editorialScore: number;
  engine: 'LLM' | 'HEURISTIC';
  evaluation: EditorialEvaluation;
}

type Criterion = {
  label: string;
  key: EditorialCriterion;
  /** Ancien palier, pour une analyse enregistrée avant le barème actuel */
  legacy: (e: EditorialEvaluation) => { score: number; max: number } | null;
  advice: (e: EditorialEvaluation) => string;
};

/** Critères du score éditorial (voir docs/tableau-metriques.md) */
const CRITERIA: Criterion[] = [
  {
    label: 'la correspondance avec l’intention de recherche',
    key: 'intent',
    legacy: (e) => ({ score: e.intentMatch.score, max: 20 }),
    advice: (e) => e.intentMatch.actionableAdvice,
  },
  {
    label: 'l’unicité du ciblage entre vos pages',
    key: 'cannibal',
    legacy: (e) => ({ score: e.cannibalizationRisk.score, max: 20 }),
    advice: (e) => e.cannibalizationRisk.actionableAdvice,
  },
  {
    label: 'la couverture des recherches (requête principale aux bons endroits, recherches secondaires reprises)',
    key: 'hotZones',
    legacy: (e) => ({ score: e.hotZonesOptimization.score, max: 15 }),
    advice: (e) => e.hotZonesOptimization.actionableAdvice,
  },
  {
    label: 'la réponse donnée dès le début de la page',
    key: 'opening',
    legacy: (e) => ({ score: e.primaryContentTldr.score, max: 15 }),
    advice: (e) => e.primaryContentTldr.actionableAdvice,
  },
  {
    label: 'ce que la page doit faire (couvrir le sujet, convaincre, faire agir, rassurer, raconter)',
    key: 'goal',
    legacy: (e) => ({ score: e.semanticDepth.score, max: 20 }),
    advice: (e) => e.semanticDepth.actionableAdvice,
  },
  {
    label: 'les signaux de confiance et d’expertise',
    key: 'eeat',
    // Ancienne note : E-E-A-T noté seulement pour un article, sinon sans objet
    legacy: (e) => (e.eeatSignals.score > 0 ? { score: e.eeatSignals.score, max: 10 } : null),
    advice: (e) => e.eeatSignals.actionableAdvice,
  },
  {
    label: 'la qualité du contenu (vécu, données et cas propres)',
    key: 'quality',
    legacy: () => null,
    advice: (e) => [e.quality?.firstHandExperience.advice, e.quality?.informationGain.advice].filter(Boolean).join(' '),
  },
  {
    label: 'la lisibilité du texte',
    key: 'readability',
    legacy: () => null,
    advice: () => 'Découper les paragraphes longs et ajouter des listes là où le contenu s’y prête.',
  },
];

/** Part des points obtenus sur un critère pour une page ; null si le critère n'est pas retenu pour elle */
function ratioOf(criterion: Criterion, evaluation: EditorialEvaluation): number | null {
  const points = evaluation.points;
  if (points) {
    const item = points[criterion.key];
    return item && item.max > 0 ? item.earned / item.max : null;
  }
  const legacy = criterion.legacy(evaluation);
  return legacy ? legacy.score / legacy.max : null;
}

/**
 * Conseil de synthèse, déterministe (aucun appel IA supplémentaire) : il s'appuie sur les analyses
 * déjà produites pour les pages piliers (point faible, point fort, action rapide).
 */
export function buildSynthesisAdvice(pillars: AnalyzedPillar[]): SynthesisAdvice | null {
  if (pillars.length === 0) return null;

  // Seules les pages pour lesquelles le critère est retenu comptent dans sa moyenne
  const stats = CRITERIA.flatMap((criterion) => {
    const rows = pillars
      .map((pillar) => ({ pillar, ratio: ratioOf(criterion, pillar.evaluation) }))
      .filter((row): row is { pillar: AnalyzedPillar; ratio: number } => row.ratio !== null);
    if (rows.length === 0) return [];
    const average = rows.reduce((sum, row) => sum + row.ratio, 0) / rows.length;
    const worst = rows.reduce((min, row) => (row.ratio < min.ratio ? row : min));
    return [{ criterion, average, worst }];
  });
  if (stats.length === 0) return null;

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
