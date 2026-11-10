import type { PageRole, SearchInsights, SubjectGrid } from '../types';
import { normalizeQuote } from './citability';
import { subjectGridOf } from './page-family';

/**
 * Grilles à cases des critères éditoriaux jugés par l'IA. L'IA ne donne plus une note de 0 à 20 (qui se tassait sur
 * les paliers 10 et 15) : elle répond vrai ou faux à des questions précises, et le code additionne les points des
 * cases cochées. Une réponse oui/non est plus stable qu'une note, et la note gagne des valeurs intermédiaires.
 * Dans le doute, l'IA doit répondre faux : une case n'est jamais cochée au hasard.
 */

export interface Check {
  id: string;
  /** Libellé affiché dans le tiroir */
  label: string;
  /** Question posée à l'IA */
  question: string;
  points: number;
  /**
   * Case appuyée sur un extrait copié par l'IA : cochée seulement si le code retrouve l'extrait mot pour mot
   * (`openingQuote` dans les 150 premiers mots, `proofQuote` n'importe où dans le contenu)
   */
  quote?: 'openingQuote' | 'proofQuote';
}

/** Réponse à la recherche visée (15 pts) */
export const INTENT_CHECKS: Check[] = [
  { id: 'need', label: 'Répond au besoin principal de la recherche', question: 'La page répond-elle au besoin principal de la personne qui tape la requête cible ?', points: 6 },
  { id: 'format', label: 'Format adapté à la recherche', question: 'Le format de la page convient-il à cette recherche (guide, page de service, comparatif, liste, fiche) ?', points: 4 },
  { id: 'focus', label: 'Centrée sur le sujet', question: 'La page reste-t-elle centrée sur ce sujet, sans partie hors sujet importante ?', points: 3 },
  { id: 'audience', label: 'S’adresse au bon public', question: 'Le public visé par la requête est-il celui à qui la page s’adresse ?', points: 2 }
];

/** Début de page (10 pts) : réponse directe pour un contenu qui répond à une question */
export const OPENING_ANSWER_CHECKS: Check[] = [
  { id: 'lead', label: 'Réponse ou résumé dans l’introduction (phrase vérifiée)', question: 'La réponse ou le résumé est-il donné dans l’introduction ? Copie cette phrase dans openingQuote.', points: 4, quote: 'openingQuote' },
  { id: 'complete', label: 'Réponse qui se suffit', question: 'Cette réponse se suffit-elle : comprend-on l’essentiel sans lire la suite ?', points: 3 },
  { id: 'precise', label: 'Réponse précise (chiffre, nom, étape, condition)', question: 'Contient-elle un élément précis (chiffre, nom, étape, condition) plutôt qu’une généralité ?', points: 3 }
];

/**
 * Début de page (10 pts) : proposition claire pour les pages qui présentent (prompt v12). Ce qui distingue
 * l'organisation et l'action visible ne sont plus demandés ici : la différence est jugée une seule fois, dans
 * « Crédibilité » ou « Savoir-faire », et l'action relève de la conversion (pistes hors note).
 */
export const OPENING_PITCH_CHECKS: Check[] = [
  { id: 'pitch', label: 'Ce qui est proposé et pour qui, dès l’introduction (phrase vérifiée)', question: 'Ce qui est proposé et pour qui est-il dit dès l’introduction ? Copie cette phrase dans openingQuote.', points: 6, quote: 'openingQuote' },
  { id: 'specific', label: 'Introduction précise (prestation, public, lieu ou chiffre nommés)', question: 'Cette introduction est-elle précise (prestation, public, lieu ou chiffre nommés) plutôt qu’un slogan ?', points: 4 }
];

/**
 * Critère « sujet » (20 pts), grille selon le rôle (prompt v13) : couverture du sujet pour une page qui informe,
 * crédibilité pour une page institutionnelle, savoir-faire pour les autres pages qui présentent. Une page non notée
 * n'en a pas. Aucune case ne juge la conversion (prix, modalités, action).
 */
export const SUBJECT_CHECKS: Record<SubjectGrid, Check[]> = {
  inform: [
    { id: 'core', label: 'Notions centrales du sujet traitées', question: 'Les notions centrales du sujet sont-elles traitées ?', points: 6 },
    { id: 'questions', label: 'Questions des internautes traitées', question: 'Les questions que se posent les internautes (voir les suggestions Google fournies) trouvent-elles une réponse ?', points: 5 },
    { id: 'depth', label: 'Notions expliquées et mises en contexte', question: 'Les notions sont-elles expliquées et mises en contexte, pas seulement citées ?', points: 5 },
    { id: 'examples', label: 'Exemples ou cas d’application', question: 'Des exemples ou cas d’application illustrent-ils le propos ?', points: 4 }
  ],
  credibility: [
    { id: 'proof', label: 'Preuve concrète (extrait vérifié)', question: 'Y a-t-il au moins une preuve concrète du sérieux de l’organisation : client, résultat, réalisation, distinction ou agrément nommés ? Copie-la mot pour mot dans proofQuote.', points: 7, quote: 'proofQuote' },
    { id: 'distinct', label: 'Ce qui distingue l’organisation', question: 'Ce qui distingue l’organisation de ses concurrents est-il dit ?', points: 5 },
    { id: 'people', label: 'Qui est derrière (personnes nommées)', question: 'Les dirigeants, l’équipe ou les experts sont-ils nommés, avec leur rôle ou leur parcours ?', points: 4 },
    { id: 'track', label: 'Repères de solidité (ancienneté, taille, implantations)', question: 'La page donne-t-elle des repères de solidité : date de création ou ancienneté, taille de l’équipe, implantations ?', points: 4 }
  ],
  skills: [
    { id: 'proof', label: 'Preuve concrète (extrait vérifié)', question: 'Y a-t-il au moins une preuve concrète du savoir-faire : réalisation, client ou résultat nommés, chiffre ? Copie-la mot pour mot dans proofQuote.', points: 7, quote: 'proofQuote' },
    { id: 'distinct', label: 'Ce qui distingue l’approche', question: 'Ce qui distingue l’approche ou la manière de faire de l’organisation est-il dit ?', points: 5 },
    { id: 'how', label: 'Ce qui est fait et comment', question: 'La page dit-elle ce qui est fait et comment (prestations, étapes, livrables, outils) ?', points: 4 },
    { id: 'needs', label: 'Besoins traités (à qui, quels problèmes)', question: 'La page dit-elle à qui ce savoir-faire s’adresse et à quels besoins ou problèmes il répond ?', points: 4 }
  ]
};

/**
 * Grille du critère « sujet » déjà remplie pour cette grille : la grille de couverture n'a pas changé (« cover »
 * avant le prompt v12, « inform » ensuite) ; une grille « present » (v12) ou un ancien objectif ne correspond plus.
 */
export function gridMatches(goalKey: string | undefined, grid: SubjectGrid): boolean {
  return goalKey === grid || (grid === 'inform' && goalKey === 'cover');
}

/** Contenu qui répond à une question : le début de page est jugé comme une réponse directe */
export function answersQuestion(role: PageRole): boolean {
  return role === 'article' || role === 'informational';
}

export function openingChecks(role: PageRole): Check[] {
  return answersQuestion(role) ? OPENING_ANSWER_CHECKS : OPENING_PITCH_CHECKS;
}

export interface CheckResult {
  earned: number;
  max: number;
  passed: string[];
  failed: string[];
}

/** Réponse à une case, la clé pouvant être préfixée par son groupe (« opening.lead ») */
export function answerOf(answers: Record<string, boolean>, id: string): boolean | undefined {
  return answers[id] ?? Object.entries(answers).find(([key]) => key.endsWith(`.${id}`))?.[1];
}

/**
 * Grille réellement remplie : au moins une case reconnue. Le modèle a parfois mis d'autres clés (le texte des
 * requêtes) à la place des identifiants ; la grille est alors ignorée et l'ancienne note de l'IA est gardée, plutôt
 * que de compter 0.
 */
export function answered(checks: Check[], answers: Record<string, boolean> | undefined): answers is Record<string, boolean> {
  return Boolean(answers) && checks.some((check) => answerOf(answers as Record<string, boolean>, check.id) !== undefined);
}

/**
 * Points des cases cochées ; une case absente de la réponse compte comme non cochée. Une clé préfixée par son groupe
 * (« intent.need », écrite parfois par le modèle) vaut la case « need ».
 */
export function scoreChecks(
  checks: Check[],
  answers: Record<string, boolean>,
  /** Extrait d'une case `quote` retrouvé dans la page ; sans vérificateur, la case suit la réponse de l'IA */
  quoteVerified?: (field: NonNullable<Check['quote']>) => boolean
): CheckResult {
  const answer = (id: string) => {
    const check = checks.find((item) => item.id === id);
    const value = answerOf(answers, id);
    return check?.quote && quoteVerified && value === true ? quoteVerified(check.quote) : value;
  };
  const passed = checks.filter((check) => answer(check.id) === true);
  return {
    earned: passed.reduce((sum, check) => sum + check.points, 0),
    max: checks.reduce((sum, check) => sum + check.points, 0),
    passed: passed.map((check) => check.label),
    failed: checks.filter((check) => answer(check.id) !== true).map((check) => check.label)
  };
}

/** Mots du début de page où la phrase d'introduction doit se trouver */
const OPENING_WORDS = 150;

/** Preuve concrète citée par l'IA : comptée seulement si elle figure mot pour mot dans le contenu (20 caractères au moins) */
export function proofQuoteVerified(content: string, quote: string | undefined): boolean {
  const clean = quote?.trim() ?? '';
  return clean.length >= 20 && normalizeQuote(content).includes(normalizeQuote(clean));
}

/** La phrase citée par l'IA figure-t-elle mot pour mot dans les 150 premiers mots du contenu ? */
export function openingQuoteVerified(content: string, quote: string | undefined): boolean {
  const clean = quote?.trim() ?? '';
  if (clean.length < 20) return false;
  const start = normalizeQuote(content.split(/\s+/).slice(0, OPENING_WORDS + 40).join(' '));
  return start.includes(normalizeQuote(clean));
}

/** Questions envoyées à l'IA pour une page, sous forme d'identifiants à renseigner à vrai ou faux */
export function checksPrompt(role: PageRole): string {
  const lines = (group: string, checks: Check[]) => checks.map((check) => `- ${group}.${check.id} : ${check.question}`).join('\n');
  const grid = subjectGridOf(role);
  return [
    lines('intent', INTENT_CHECKS),
    lines('opening', openingChecks(role)),
    grid ? lines('goal', SUBJECT_CHECKS[grid]) : ''
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Intention et zones chaudes sont-elles jugées ? Non pour une requête générique seulement déduite de la page (jugée
 * sur une requête taillée pour elle, la note serait biaisée). Une requête de marque (page de contact, utilitaire, ou
 * marque dans la requête) n'a pas ce biais : le site est ce qu'on cherche, elle est toujours jugée.
 */
export function queryJudged(search?: Pick<SearchInsights, 'targetQuery'>): boolean {
  return !search || search.targetQuery.confidence !== 'INFERRED' || search.targetQuery.isBrand === true;
}
