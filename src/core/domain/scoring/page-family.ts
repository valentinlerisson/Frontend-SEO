import type { PageFamily, PageRole, SubjectGrid } from '../types';

/**
 * Familles de pages (prompt v12, 09/11/2026). Elles remplacent les six objectifs choisis à la main : l'objectif
 * répétait le rôle (il en était déduit tant qu'on n'y touchait pas), et le choix « aller droit au but » sortait 20
 * points du dénominateur d'une page d'offre. La famille se déduit du rôle seul ; corriger le rôle suffit.
 */
export const PAGE_FAMILIES: PageFamily[] = ['inform', 'present', 'unscored'];

export const FAMILY_LABEL: Record<PageFamily, string> = {
  inform: 'Informer',
  present: 'Présenter',
  unscored: 'Non notée'
};

/** Ce que la famille change à la lecture de la page, en une phrase */
export const FAMILY_HINT: Record<PageFamily, string> = {
  inform: 'La page répond à une question : on juge la réponse directe, la couverture du sujet et la qualité du contenu.',
  present:
    'La page présente l’organisation, une offre ou une réalisation : on juge la clarté de la proposition et ce qu’elle montre (crédibilité pour une page institutionnelle, savoir-faire pour les autres), jamais sa capacité à vendre.',
  unscored: 'Page de contact, légale ou utilitaire : sans enjeu éditorial, elle est exclue de la note éditoriale.'
};

/**
 * Grille du critère « sujet » selon le rôle (prompt v13, 10/11/2026) : une page institutionnelle montre le sérieux
 * et le poids de l'organisation, les autres pages qui présentent montrent un savoir-faire. Aucune n'est jugée sur la
 * conversion : prix, modalités et action restent des pistes hors note.
 */
export function subjectGridOf(role: PageRole): SubjectGrid | null {
  const family = familyOf(role);
  if (family === 'unscored') return null;
  if (family === 'inform') return 'inform';
  return role === 'brand' ? 'credibility' : 'skills';
}

export const SUBJECT_GRID_LABEL: Record<SubjectGrid, string> = {
  inform: 'Couverture du sujet',
  credibility: 'Crédibilité',
  skills: 'Savoir-faire'
};

export type PresentCriterion = {
  title: string;
  presentLabel: string;
  ideaLabel: string;
  good: string;
  weak: string;
  nothing: string;
  issueTitle: string;
  issueLead: string;
};

/** Libellés du critère « sujet » (20 pts) d'une page qui présente, et de ses pistes, selon sa grille */
export const PRESENT_CRITERIA: Record<Exclude<SubjectGrid, 'inform'>, PresentCriterion> = {
  credibility: {
    title: 'Crédibilité',
    presentLabel: 'élément(s) qui montrent le sérieux de l’organisation',
    ideaLabel: 'Piste',
    good: 'La page montre qui est derrière l’organisation, sa solidité et des preuves nommées.',
    weak: 'La page pourrait mieux montrer le sérieux et le poids de l’organisation : voir les pistes ci-dessous.',
    nothing: 'Aucune piste notable : la page se suffit',
    issueTitle: 'Pistes pour renforcer la crédibilité',
    issueLead: 'La page pourrait mieux montrer le sérieux de l’organisation'
  },
  skills: {
    title: 'Savoir-faire',
    presentLabel: 'élément(s) de savoir-faire montrés',
    ideaLabel: 'Piste',
    good: 'La page montre ce que l’organisation sait faire, comment, pour quels besoins, avec des preuves.',
    weak: 'La page pourrait mieux montrer le savoir-faire : voir les pistes ci-dessous.',
    nothing: 'Aucune piste notable : la page se suffit',
    issueTitle: 'Pistes pour mieux montrer le savoir-faire',
    issueLead: 'La page pourrait mieux montrer le savoir-faire'
  }
};

/** Libellés du critère « sujet » d'une page qui présente ; undefined pour une page qui informe ou non notée */
export function presentCriterion(role: PageRole): PresentCriterion | undefined {
  const grid = subjectGridOf(role);
  return grid && grid !== 'inform' ? PRESENT_CRITERIA[grid] : undefined;
}

/** Titre du critère « sujet » (20 pts) selon le rôle */
export function subjectCriterionTitle(role: PageRole): string {
  return SUBJECT_GRID_LABEL[subjectGridOf(role) ?? 'inform'];
}

/**
 * Famille déduite du rôle : un contenu qui informe (article, guide, FAQ) doit couvrir son sujet ; une page de contact
 * ou légale n'a pas d'enjeu éditorial ; les autres (accueil, offre, liste, marque, réalisation) présentent.
 */
export function familyOf(role: PageRole): PageFamily {
  if (role === 'article' || role === 'informational') return 'inform';
  if (role === 'contact' || role === 'utility') return 'unscored';
  return 'present';
}
