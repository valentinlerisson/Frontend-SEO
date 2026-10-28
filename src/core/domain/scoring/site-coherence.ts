import type { Issue, PageRole } from '../types';
import { LOW_SEARCH_POTENTIAL_ROLES } from './page-role';

/** Codes des anomalies de cohérence calculées sans IA (régénérées à chaque analyse) */
export const DETERMINISTIC_SITE_CODES = [
  'SITE_DUPLICATE_TITLES',
  'SITE_DUPLICATE_META',
  'SITE_DUPLICATE_H1',
  'SITE_INCONSISTENT_FIGURES',
  'SITE_PILLARS_LOW_POTENTIAL'
];

export interface SiteCoherencePageInfo {
  url: string;
  path: string;
  role: PageRole;
  isPillar: boolean;
  title?: string;
  metaDescription?: string;
  h1?: string;
  counts: { label: string; value: number }[];
}

/** Libellés normalisés des chiffres-clés (voir extractCounts) vers leur forme affichée */
const LABEL_DISPLAY: Record<string, string> = {
  etablissement: 'établissements',
  residence: 'résidences',
  ehpad: 'EHPAD',
  collaborateur: 'collaborateurs',
  salarie: 'salariés',
  lit: 'lits',
  place: 'places',
  agence: 'agences',
  magasin: 'magasins'
};

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

function othersLabel(others: SiteCoherencePageInfo[]): string {
  const shown = others.slice(0, 4).map((page) => page.path || page.url);
  return `${shown.join(', ')}${others.length > 4 ? ` et ${others.length - 4} autre(s)` : ''}`;
}

/**
 * Incohérences visibles en comparant les pages du site (aucun appel IA) : balises en doublon,
 * chiffres-clés contradictoires, sélection de piliers peu utile pour le classement.
 * Une anomalie par page concernée ; les pages doivent être indexables et répondre en HTTP 200.
 */
export function buildSiteCoherenceIssues(pages: SiteCoherencePageInfo[]): Issue[] {
  const issues: Issue[] = [];

  const duplicates = (
    pick: (page: SiteCoherencePageInfo) => string | undefined,
    config: { code: string; severity: Issue['severity']; title: string; what: string; recommendation: string }
  ) => {
    const groups = new Map<string, SiteCoherencePageInfo[]>();
    for (const page of pages) {
      const value = pick(page);
      if (!value || !value.trim()) continue;
      const key = normalize(value);
      groups.set(key, [...(groups.get(key) ?? []), page]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const page of group) {
        issues.push({
          id: `${config.code.toLowerCase()}-${page.path}`,
          pillar: 'EDITORIAL',
          severity: config.severity,
          code: config.code,
          title: config.title,
          description: `${config.what} « ${(pick(page) ?? '').slice(0, 80)} » est identique sur ${group.length} pages : ${othersLabel(group)}.`,
          recommendation: config.recommendation,
          stepsToResolve: [config.recommendation],
          affectedUrl: page.url
        });
      }
    }
  };

  duplicates((page) => page.title, {
    code: 'SITE_DUPLICATE_TITLES',
    severity: 'WARNING',
    title: 'Même Title sur plusieurs pages',
    what: 'Le Title',
    recommendation: 'Donner à chaque page un Title propre, décrivant son sujet précis.'
  });
  duplicates((page) => page.metaDescription, {
    code: 'SITE_DUPLICATE_META',
    severity: 'INFO',
    title: 'Même méta description sur plusieurs pages',
    what: 'La méta description',
    recommendation: 'Rédiger une méta description distincte pour chaque page.'
  });
  duplicates((page) => page.h1, {
    code: 'SITE_DUPLICATE_H1',
    severity: 'INFO',
    title: 'Même H1 sur plusieurs pages',
    what: 'Le H1',
    recommendation: 'Différencier le H1 de chaque page selon son sujet.'
  });

  // Chiffres-clés contradictoires : « 26 établissements » ici, « 24 établissements » ailleurs
  const figures = new Map<string, Map<number, SiteCoherencePageInfo[]>>();
  for (const page of pages) {
    for (const { label, value } of page.counts) {
      if (value < 5) continue;
      const byValue = figures.get(label) ?? new Map<number, SiteCoherencePageInfo[]>();
      byValue.set(value, [...(byValue.get(value) ?? []), page]);
      figures.set(label, byValue);
    }
  }
  for (const [rawLabel, byValue] of figures) {
    if (byValue.size < 2) continue;
    const label = LABEL_DISPLAY[rawLabel] ?? rawLabel;
    const summary = Array.from(byValue.entries())
      .map(([value, group]) => `${value} (${othersLabel(group)})`)
      .join(' contre ');
    for (const [value, group] of byValue) {
      for (const page of group) {
        issues.push({
          id: `site-figures-${rawLabel}-${page.path}`,
          pillar: 'EDITORIAL',
          severity: 'INFO',
          code: 'SITE_INCONSISTENT_FIGURES',
          title: `Chiffre divergent : ${label}`,
          description: `Le site annonce des valeurs différentes pour les ${label} : ${summary}. À vérifier : un chiffre contradictoire nuit à la crédibilité.`,
          recommendation: 'Harmoniser ce chiffre sur toutes les pages, ou préciser ce qu’il compte quand les périmètres diffèrent.',
          stepsToResolve: ['Identifier la bonne valeur.', 'La reporter à l’identique sur chaque page concernée.'],
          affectedUrl: page.url
        });
      }
    }
  }

  // Sélection de piliers : surtout des pages de marque ou de contact, peu utiles pour se classer
  const pillars = pages.filter((page) => page.isPillar);
  const lowPotential = pillars.filter((page) => LOW_SEARCH_POTENTIAL_ROLES.includes(page.role));
  if (pillars.length >= 3 && lowPotential.length / pillars.length >= 0.75) {
    for (const page of lowPotential) {
      issues.push({
        id: `site-pillars-${page.path}`,
        pillar: 'EDITORIAL',
        severity: 'INFO',
        code: 'SITE_PILLARS_LOW_POTENTIAL',
        title: 'Pages piliers surtout institutionnelles',
        description: `${lowPotential.length} pages piliers sur ${pillars.length} sont des pages d’accueil, de marque ou de contact, qui visent peu de requêtes de recherche.`,
        recommendation: 'Ajouter parmi les piliers des pages d’offre, de service ou d’information qui ciblent de vraies requêtes.',
        stepsToResolve: ['Revenir à Subpages et sélectionner aussi des pages d’offre ou d’information.'],
        affectedUrl: page.url
      });
    }
  }

  return issues;
}
