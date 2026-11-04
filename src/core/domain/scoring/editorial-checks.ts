import type { PageGoal, PageRole, SearchInsights } from '../types';
import { normalizeQuote } from './citability';

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
  { id: 'lead', label: 'Réponse ou résumé dans l’introduction (phrase vérifiée)', question: 'La réponse ou le résumé est-il donné dans l’introduction ? Copie cette phrase dans openingQuote.', points: 4 },
  { id: 'complete', label: 'Réponse qui se suffit', question: 'Cette réponse se suffit-elle : comprend-on l’essentiel sans lire la suite ?', points: 3 },
  { id: 'precise', label: 'Réponse précise (chiffre, nom, étape, condition)', question: 'Contient-elle un élément précis (chiffre, nom, étape, condition) plutôt qu’une généralité ?', points: 3 }
];

/** Début de page (10 pts) : proposition de valeur pour les autres pages */
export const OPENING_OFFER_CHECKS: Check[] = [
  { id: 'lead', label: 'Ce qui est proposé et pour qui, dès l’introduction (phrase vérifiée)', question: 'Ce qui est proposé et pour qui est-il dit dès l’introduction ? Copie cette phrase dans openingQuote.', points: 4 },
  { id: 'distinct', label: 'Ce qui distingue l’organisation, dès le début', question: 'Ce qui distingue l’organisation est-il dit dès le début de la page ?', points: 3 },
  { id: 'action', label: 'Action visible dès l’arrivée', question: 'Une action est-elle visible dès l’arrivée (bouton, lien, téléphone) ?', points: 3 }
];

/** Critère de l'objectif de la page (20 pts) */
export const GOAL_CHECKS: Record<Exclude<PageGoal, 'direct'>, Check[]> = {
  cover: [
    { id: 'core', label: 'Notions centrales du sujet traitées', question: 'Les notions centrales du sujet sont-elles traitées ?', points: 6 },
    { id: 'questions', label: 'Questions des internautes traitées', question: 'Les questions que se posent les internautes (voir les suggestions Google fournies) trouvent-elles une réponse ?', points: 5 },
    { id: 'depth', label: 'Notions expliquées et mises en contexte', question: 'Les notions sont-elles expliquées et mises en contexte, pas seulement citées ?', points: 5 },
    { id: 'examples', label: 'Exemples ou cas d’application', question: 'Des exemples ou cas d’application illustrent-ils le propos ?', points: 4 }
  ],
  convince: [
    { id: 'offer', label: 'Ce qui est proposé et à qui', question: 'Ce qui est proposé et à qui est-il clair ?', points: 5 },
    { id: 'proof', label: 'Au moins une preuve concrète', question: 'Y a-t-il au moins une preuve concrète (chiffre, référence nommée, réalisation, agrément) ?', points: 6 },
    { id: 'distinct', label: 'Ce qui distingue de la concurrence', question: 'Ce qui distingue l’organisation de la concurrence est-il dit ?', points: 4 },
    { id: 'action', label: 'Façon de passer à l’action', question: 'La façon de passer à l’action est-elle claire ?', points: 5 }
  ],
  convert: [
    { id: 'visible', label: 'Action visible dès l’arrivée', question: 'L’action attendue (demande, achat, inscription, don, rendez-vous) est-elle visible dès l’arrivée ?', points: 5 },
    { id: 'repeated', label: 'Action reprise plus bas', question: 'L’action est-elle reprise plus bas dans la page ?', points: 4 },
    { id: 'next', label: 'Étape suivante annoncée', question: 'La page dit-elle ce qui se passe ensuite (délai, étape suivante) ?', points: 4 },
    { id: 'friction', label: 'Freins levés', question: 'Les freins sont-ils levés (prix ou fourchette, garanties, questions fréquentes, engagement demandé) ?', points: 4 },
    { id: 'single', label: 'Un seul chemin principal', question: 'Y a-t-il un seul chemin principal, sans actions concurrentes ?', points: 3 }
  ],
  reassure: [
    { id: 'identity', label: 'Structure identifiée', question: 'La structure derrière la page est-elle identifiée (nom, statut, ancienneté) ?', points: 5 },
    { id: 'people', label: 'Personnes nommées', question: 'Des personnes sont-elles nommées (direction, équipe) ?', points: 4 },
    { id: 'proofs', label: 'Preuves vérifiables', question: 'Y a-t-il des preuves vérifiables (agréments, labels, autorités de tutelle, chiffres datés, références nommées) ?', points: 6 },
    { id: 'commitments', label: 'Engagements concrets', question: 'Des engagements concrets sont-ils pris ?', points: 3 },
    { id: 'contact', label: 'Coordonnées pour joindre la structure', question: 'Des coordonnées permettent-elles de joindre la structure ?', points: 2 }
  ],
  showcase: [
    { id: 'context', label: 'Contexte posé (qui, quel besoin)', question: 'Le contexte est-il posé (qui, quel besoin) ?', points: 5 },
    { id: 'work', label: 'Ce qui a été fait est décrit', question: 'Ce qui a été fait est-il décrit (méthode, moyens) ?', points: 5 },
    { id: 'result', label: 'Résultat concret', question: 'Un résultat concret est-il donné (chiffre ou constat observable) ?', points: 6 },
    { id: 'follow', label: 'Une suite proposée', question: 'Une suite est-elle proposée (témoignage, enseignement, lien vers un cas proche) ?', points: 4 }
  ]
};

/** Contenu qui répond à une question : le début de page est jugé comme une réponse directe */
export function answersQuestion(role: PageRole): boolean {
  return role === 'article' || role === 'informational';
}

export function openingChecks(role: PageRole): Check[] {
  return answersQuestion(role) ? OPENING_ANSWER_CHECKS : OPENING_OFFER_CHECKS;
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
export function scoreChecks(checks: Check[], answers: Record<string, boolean>): CheckResult {
  const answer = (id: string) => answerOf(answers, id);
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

/** La phrase citée par l'IA figure-t-elle mot pour mot dans les 150 premiers mots du contenu ? */
export function openingQuoteVerified(content: string, quote: string | undefined): boolean {
  const clean = quote?.trim() ?? '';
  if (clean.length < 20) return false;
  const start = normalizeQuote(content.split(/\s+/).slice(0, OPENING_WORDS + 40).join(' '));
  return start.includes(normalizeQuote(clean));
}

/** Questions envoyées à l'IA pour une page, sous forme d'identifiants à renseigner à vrai ou faux */
export function checksPrompt(role: PageRole, goal: PageGoal): string {
  const lines = (group: string, checks: Check[]) => checks.map((check) => `- ${group}.${check.id} : ${check.question}`).join('\n');
  return [
    lines('intent', INTENT_CHECKS),
    lines('opening', openingChecks(role)),
    goal === 'direct' ? '' : lines('goal', GOAL_CHECKS[goal])
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
