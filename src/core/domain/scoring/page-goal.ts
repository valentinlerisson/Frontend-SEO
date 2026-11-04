import type { PageGoal, PageRole } from '../types';

/**
 * Objectifs d'une page, dans l'ordre d'affichage. Ils valent pour tout type de site (entreprise, association,
 * collectivité, média, site juridique ou informatif) : « action » veut dire devis, achat, inscription, don,
 * rendez-vous, adhésion ou téléchargement selon le site.
 */
export const PAGE_GOALS: PageGoal[] = ['cover', 'convince', 'convert', 'reassure', 'showcase', 'direct'];

export const GOAL_LABEL: Record<PageGoal, string> = {
  cover: 'Couvrir le sujet',
  convince: 'Présenter et convaincre',
  convert: 'Convertir',
  reassure: 'Rassurer',
  showcase: 'Raconter une réalisation',
  direct: 'Aller droit au but'
};

/** Ce que l'objectif change à la lecture de la page, en une phrase */
export const GOAL_HINT: Record<PageGoal, string> = {
  cover: 'La page doit répondre en entier au sujet : les notions et sections attendues comptent dans la note.',
  convince: 'La page présente une offre ou une organisation : on juge la clarté, les preuves et l’action possible, pas un cours sur le sujet.',
  convert: 'La page a un but unique (demande, achat, inscription, don, rendez-vous) : on juge si l’action est évidente et si les freins sont levés.',
  reassure: 'La page doit inspirer confiance (qui est derrière, preuves vérifiables, engagements) : on juge la crédibilité, pas la couverture d’un sujet.',
  showcase: 'La page raconte une réalisation, un projet ou un cas : on juge le contexte, ce qui a été fait et le résultat.',
  direct: 'La page est volontairement courte : la couverture du sujet sort de la note, seuls la promesse et l’action comptent.'
};

/** Libellés du critère « 20 pts » (couverture du sujet ou son équivalent) et de ses pistes, selon l'objectif */
export interface GoalCriterion {
  /** Titre du bloc noté */
  title: string;
  /** Éléments déjà présents : « N … présent(s) » */
  presentLabel: string;
  /** Début de chaque piste affichée : « Piste pour rassurer : agrément affiché » */
  ideaLabel: string;
  /** Constat quand le critère est bien rempli, et quand il peut progresser */
  good: string;
  weak: string;
  /** Aucune piste notable */
  nothing: string;
  /** Titre de l'anomalie d'information regroupant les pistes */
  issueTitle: string;
  /** Début de la phrase d'explication de l'anomalie */
  issueLead: string;
}

export const GOAL_CRITERION: Record<Exclude<PageGoal, 'cover' | 'direct'>, GoalCriterion> = {
  convince: {
    title: 'Preuves et conviction',
    presentLabel: 'élément(s) de conviction présent(s)',
    ideaLabel: 'Piste pour convaincre',
    good: 'La page dit clairement ce qu’elle propose et donne de quoi se décider.',
    weak: 'La page pourrait mieux aider un visiteur à se décider : voir les pistes ci-dessous.',
    nothing: 'Aucune piste notable : la page se suffit pour convaincre',
    issueTitle: 'Pistes pour convaincre davantage',
    issueLead: 'La page pourrait mieux aider un visiteur à se décider'
  },
  convert: {
    title: 'Passage à l’action',
    presentLabel: 'élément(s) qui facilitent l’action',
    ideaLabel: 'Piste pour faciliter l’action',
    good: 'L’action attendue est évidente et les freins principaux sont levés.',
    weak: 'L’action pourrait être plus évidente ou plus rassurante : voir les pistes ci-dessous.',
    nothing: 'Aucune piste notable : le chemin vers l’action est clair',
    issueTitle: 'Pistes pour faciliter l’action',
    issueLead: 'Le chemin vers l’action pourrait être plus simple'
  },
  reassure: {
    title: 'Confiance et crédibilité',
    presentLabel: 'élément(s) de confiance présent(s)',
    ideaLabel: 'Piste pour rassurer',
    good: 'La page montre qui est derrière et appuie sa crédibilité sur des preuves vérifiables.',
    weak: 'La page pourrait mieux inspirer confiance : voir les pistes ci-dessous.',
    nothing: 'Aucune piste notable : la page inspire confiance',
    issueTitle: 'Pistes pour mieux rassurer',
    issueLead: 'La page pourrait mieux inspirer confiance'
  },
  showcase: {
    title: 'Récit et résultats',
    presentLabel: 'élément(s) du récit présent(s)',
    ideaLabel: 'Piste pour mieux raconter',
    good: 'La réalisation est racontée : contexte, ce qui a été fait et résultat.',
    weak: 'Le récit pourrait mieux montrer ce qui a été fait et ce que ça a donné : voir les pistes ci-dessous.',
    nothing: 'Aucune piste notable : la réalisation est bien racontée',
    issueTitle: 'Pistes pour mieux raconter la réalisation',
    issueLead: 'La réalisation pourrait être mieux racontée'
  }
};

/** Objectif dont les 20 pts jugent autre chose que la couverture d'un sujet (preuves, action, confiance, récit) */
export function judgesProof(goal: PageGoal): goal is Exclude<PageGoal, 'cover' | 'direct'> {
  return goal !== 'cover' && goal !== 'direct';
}

/**
 * Objectif déduit du rôle quand l'utilisateur n'en a pas choisi : un contenu qui informe doit couvrir son sujet, une
 * réalisation se raconte, une page institutionnelle rassure, une page de contact ou légale va droit au but, les
 * autres présentent et convainquent.
 */
export function defaultGoal(role: PageRole): PageGoal {
  if (role === 'article' || role === 'informational') return 'cover';
  if (role === 'case') return 'showcase';
  if (role === 'brand') return 'reassure';
  if (role === 'contact' || role === 'utility') return 'direct';
  return 'convince';
}

/** Objectif retenu : choix de l'utilisateur, sinon celui du rôle */
export function resolveGoal(sources: { manual?: PageGoal; role: PageRole }): { goal: PageGoal; source: 'manual' | 'auto' } {
  if (sources.manual) return { goal: sources.manual, source: 'manual' };
  return { goal: defaultGoal(sources.role), source: 'auto' };
}
