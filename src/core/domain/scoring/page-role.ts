import type { PageRole } from '../types';

export const PAGE_ROLES: PageRole[] = ['home', 'brand', 'contact', 'offer', 'case', 'article', 'hub', 'utility'];

export const ROLE_LABEL: Record<PageRole, string> = {
  home: 'Accueil',
  brand: 'Marque / institutionnelle',
  contact: 'Contact',
  offer: 'Offre / service',
  case: 'Réalisation / étude de cas',
  article: 'Article / contenu informatif',
  hub: 'Liste / hub',
  utility: 'Utilitaire (légal, plan du site)'
};

/** Rôles dont l'enjeu de classement sur des requêtes de recherche est faible */
export const LOW_SEARCH_POTENTIAL_ROLES: PageRole[] = ['home', 'brand', 'contact', 'utility'];

export interface RoleInput {
  path: string;
  depth: number;
  wordCount: number;
  hasPublicationDate?: boolean;
  /** Types Schema.org déclarés par la page (JSON-LD, microdonnées, RDFa) */
  schemaTypes?: string[];
  /** Contenu de `og:type` (ex. « article », « website ») */
  ogType?: string;
  /** Nombre d'éléments `<article>` : un seul = un contenu, plusieurs = une liste de cartes */
  articleElements?: number;
  /** Date de publication déclarée dans les balises meta */
  hasPublishedMeta?: boolean;
  /** Page liée depuis le contenu d'une liste de réalisations ou d'articles */
  hubChild?: 'case' | 'article';
}

const UTILITY_PATH = /(mentions?-?legales?|mentions|cgv|cgu|conditions|confidentialite|politique|cookies?|plan-du-site|sitemap|accessibilite|rgpd|legal)/;
const CONTACT_PATH = /(contact|nous-joindre|devis|rendez-vous|rdv)/;
const HUB_SLUG =
  /^(actualites?|blog|news|journal|realisations?|references?|clients?|portfolio|projets?|etudes?(-observatoires?)?|ressources?|publications?|articles?|nos-articles|nos-realisations|temoignages?)$/;
const CASE_HUB = /^(clients?|realisations?|references?|portfolio|projets?|temoignages?|nos-realisations)$/;
const ARTICLE_HUB = /^(actualites?|blog|news|journal|articles?|nos-articles|magazine|etudes?(-observatoires?)?|publications?|ressources?)$/;
const ARTICLE_PATH = /(blog|article|actualit|news|conseil|guide|ressource|etude|observatoire|magazine)/;
const CASE_PATH = /(etude-de-cas|cas-client|realisation|temoignage|reference)/;
const BRAND_PATH =
  /(a-propos|about|qui-sommes|mission|groupe|equipe|histoire|valeurs|engagement|gouvernance|carriere|recrut|rejoindre|partenaire)/;

/**
 * Rôle d'une page, du plus fiable au moins fiable : chemin des pages utilitaires et de contact, type Schema.org,
 * `og:type`, éléments `<article>`, date de publication, puis mots du chemin. À défaut : offre / service.
 * Il adapte les attentes éditoriales : auteur et date ne se demandent qu'à un article, l'expérience vécue
 * pas à une page de contact. Une correction manuelle ou celle de l'IA prime (voir `resolvePageRole`).
 */
export function classifyPageRole(page: RoleInput): PageRole {
  const path = page.path.toLowerCase();
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  const types = (page.schemaTypes ?? []).map((type) => type.toLowerCase());
  const hasType = (...names: string[]) => types.some((type) => names.includes(type));

  if (page.depth === 0 || path === '/') return 'home';
  if (UTILITY_PATH.test(path)) return 'utility';
  if (CONTACT_PATH.test(path) || hasType('contactpage')) return 'contact';

  // Liste de contenus : type de collection, plusieurs cartes <article>, ou page nommée comme une rubrique
  if (hasType('collectionpage', 'itemlist', 'blog') || (page.articleElements ?? 0) >= 3 || HUB_SLUG.test(slug)) {
    return 'hub';
  }

  if (
    types.some((type) => type.includes('article') || type === 'blogposting') ||
    page.ogType === 'article' ||
    page.hasPublishedMeta ||
    ARTICLE_PATH.test(path)
  ) {
    return 'article';
  }
  if (CASE_PATH.test(path)) return 'case';
  if (page.hubChild) return page.hubChild;
  if (BRAND_PATH.test(path) || hasType('aboutpage')) return 'brand';
  if (page.hasPublicationDate && page.wordCount >= 300) return 'article';
  return 'offer';
}

/** Nature des pages qu'une liste (hub) regroupe, d'après son nom de rubrique ; null si ce n'est pas une rubrique connue */
export function hubChildKind(slug: string): 'case' | 'article' | null {
  const clean = slug.toLowerCase();
  if (CASE_HUB.test(clean)) return 'case';
  if (ARTICLE_HUB.test(clean)) return 'article';
  return null;
}

/** Rôle retenu : correction manuelle, puis avis de l'IA, puis détection automatique */
export function resolvePageRole(sources: { manual?: PageRole; ai?: PageRole; detected: PageRole }): {
  role: PageRole;
  source: 'manual' | 'ai' | 'auto';
} {
  if (sources.manual) return { role: sources.manual, source: 'manual' };
  if (sources.ai && sources.ai !== sources.detected) return { role: sources.ai, source: 'ai' };
  return { role: sources.detected, source: 'auto' };
}
