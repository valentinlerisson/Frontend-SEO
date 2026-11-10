import type { CriterionPoints, EditorialCriterion, GeoEvaluation, TechScoreResult } from '../types';
import { napMeasuredPoints } from './nap';
import { PILLAR_WEIGHTS } from './GlobalScoringEngine';

/**
 * Où une page, et le site, perdent leurs points. Chaque note de pilier vaut Σ points obtenus / Σ points mesurés × 100 ;
 * un critère perd donc (points en jeu − points obtenus) / points mesurés × 100 points de la note de la page. À l'échelle
 * du site, la moyenne d'un pilier est pondérée par les points mesurés de chaque page (`GlobalScoringEngine`) : corriger
 * un critère sur toutes les pages rapporterait Σ points perdus / Σ points mesurés × 100 points au pilier, puis ce gain
 * multiplié par le poids du pilier dans la note globale. Estimation : une page en erreur, plafonnée à 20, n'est pas
 * modélisée finement.
 */

export type LossPillar = 'tech' | 'editorial' | 'geo';

/** Poids de chaque pilier dans la note globale (voir GlobalScoringEngine.computeProjectScore ; GEO à 0 s'il est mis de côté) */
export const PILLAR_WEIGHT: Record<LossPillar, number> = PILLAR_WEIGHTS;

/** Un critère d'une page : points obtenus et points en jeu (non mesurés exclus), rubrique du tiroir où il se lit */
export interface CriterionScore {
  pillar: LossPillar;
  key: string;
  label: string;
  earned: number;
  max: number;
  /** Indice de la rubrique dans l'onglet du pilier (tiroir d'inspection) */
  section: number;
}

/** Critère où la page perd des points, ramenés sur la note /100 du pilier */
export interface CriterionLoss extends CriterionScore {
  lost: number;
}

type TechKey = keyof TechScoreResult['breakdown'];

/** Catégories du score technique, leur plafond et leur rubrique dans l'onglet Technique */
export const TECH_CATEGORIES: { key: TechKey; label: string; max: number; section: number }[] = [
  { key: 'coreWebVitals', label: 'Vitesse d’affichage', max: 25, section: 3 },
  { key: 'architecture', label: 'Profondeur et liens internes', max: 20, section: 4 },
  { key: 'crawlability', label: 'Accès des robots (robots.txt, sitemap, canonique)', max: 15, section: 0 },
  { key: 'securityAndHttp', label: 'HTTPS, code de réponse et redirections', max: 15, section: 0 },
  { key: 'htmlStructure', label: 'Titre principal H1', max: 15, section: 1 },
  { key: 'metadataAndMedia', label: 'Title, méta et textes alternatifs', max: 10, section: 2 }
];

/** Critères éditoriaux, et leur rubrique dans l'onglet Contenu */
export const EDITORIAL_CRITERIA: Record<EditorialCriterion, { label: string; section: number }> = {
  intent: { label: 'Réponse à la recherche', section: 0 },
  cannibal: { label: 'Concurrence entre vos pages', section: 1 },
  hotZones: { label: 'Couverture des recherches', section: 2 },
  opening: { label: 'Début de page', section: 3 },
  goal: { label: 'Couverture du sujet, crédibilité ou savoir-faire', section: 4 },
  eeat: { label: 'Auteur, date et sources', section: 5 },
  quality: { label: 'Qualité du contenu', section: 12 },
  readability: { label: 'Lisibilité', section: 10 }
};

export function techCriteria(breakdown: TechScoreResult['breakdown'], unmeasured?: TechScoreResult['breakdown']): CriterionScore[] {
  return TECH_CATEGORIES.map(({ key, label, max, section }) => ({
    pillar: 'tech' as const,
    key,
    label,
    earned: breakdown[key],
    max: max - (unmeasured?.[key] ?? 0),
    section
  })).filter((criterion) => criterion.max > 0);
}

export function editorialCriteria(points: Partial<Record<EditorialCriterion, CriterionPoints>> | undefined): CriterionScore[] {
  if (!points) return [];
  return (Object.keys(EDITORIAL_CRITERIA) as EditorialCriterion[]).flatMap((key) => {
    const value = points[key];
    if (!value || value.max <= 0) return [];
    return [{ pillar: 'editorial' as const, key, ...EDITORIAL_CRITERIA[key], earned: value.earned, max: value.max }];
  });
}

/** Barème GEO : robots IA 15, citabilité 40 (sans objet pour contact et utilitaire), sources 5, Schema.org 25, NAP mesurable */
export function geoCriteria(geo: GeoEvaluation | undefined): CriterionScore[] {
  if (!geo) return [];
  const criteria: CriterionScore[] = [
    { pillar: 'geo', key: 'aiBots', label: 'Accès des robots IA', earned: geo.aiBotsAccessibility.score, max: 15, section: 0 },
    ...(geo.aiCitability.applicable === false
      ? []
      : [{ pillar: 'geo' as const, key: 'citability', label: 'Passages citables par une IA', earned: geo.aiCitability.score, max: 40, section: 1 }]),
    { pillar: 'geo', key: 'sources', label: 'Sources d’autorité', earned: geo.authoritySources.score, max: 5, section: 1 },
    { pillar: 'geo', key: 'schema', label: 'Données structurées Schema.org', earned: geo.schemaOrgLdJson.score, max: 25, section: 2 },
    { pillar: 'geo', key: 'nap', label: 'Coordonnées (NAP)', earned: geo.napConsistency.score, max: napMeasuredPoints(geo.napConsistency), section: 2 }
  ];
  return criteria.filter((criterion) => criterion.max > 0);
}

/** Points perdus par critère, ramenés sur la note /100 du pilier, du plus coûteux au moins coûteux */
export function pageLosses(criteria: CriterionScore[]): CriterionLoss[] {
  const measured = criteria.reduce((sum, criterion) => sum + criterion.max, 0);
  if (measured <= 0) return [];
  return criteria
    .map((criterion) => ({
      ...criterion,
      lost: (Math.max(0, criterion.max - Math.min(criterion.max, criterion.earned)) / measured) * 100
    }))
    .filter((criterion) => criterion.lost >= 0.5)
    .sort((a, b) => b.lost - a.lost);
}

export interface SiteGain {
  pillar: LossPillar;
  key: string;
  label: string;
  section: number;
  /** Points que gagnerait la note du pilier si le critère était parfait sur toutes les pages comptées */
  pillarPoints: number;
  /** Même gain, rapporté à la note globale (poids du pilier) */
  globalPoints: number;
  /** Pages qui perdent des points sur ce critère */
  pages: number;
}

/**
 * Gains possibles à l'échelle du site, du plus fort au plus faible (note globale). `pages` : critères de chaque page
 * comptée dans la moyenne du pilier (technique : pages indexables ou en erreur ; éditorial et GEO : pages piliers).
 */
export function siteGains(pages: CriterionScore[][]): SiteGain[] {
  const measured: Record<LossPillar, number> = { tech: 0, editorial: 0, geo: 0 };
  const gains = new Map<string, Omit<SiteGain, 'pillarPoints' | 'globalPoints'> & { lost: number }>();
  for (const criteria of pages) {
    for (const criterion of criteria) {
      measured[criterion.pillar] += criterion.max;
      const lost = Math.max(0, criterion.max - Math.min(criterion.max, criterion.earned));
      const id = `${criterion.pillar}:${criterion.key}`;
      const current = gains.get(id) ?? { pillar: criterion.pillar, key: criterion.key, label: criterion.label, section: criterion.section, pages: 0, lost: 0 };
      current.lost += lost;
      if (lost > 0) current.pages += 1;
      gains.set(id, current);
    }
  }
  return [...gains.values()]
    .filter((gain) => gain.lost > 0 && measured[gain.pillar] > 0)
    .map(({ lost, ...gain }) => {
      const pillarPoints = (lost / measured[gain.pillar]) * 100;
      return { ...gain, pillarPoints, globalPoints: pillarPoints * PILLAR_WEIGHT[gain.pillar] };
    })
    .sort((a, b) => b.globalPoints - a.globalPoints);
}
