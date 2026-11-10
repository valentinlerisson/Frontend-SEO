import type { EditorialSignals } from '../types';

type YearMention = EditorialSignals['freshness']['outdatedMentions'][number];

/**
 * Repère devant l'année qui date un début toujours en cours ou un fait historique : « depuis 2019 », « dès 2015 »,
 * « fondée en 1998 », « créé en », « lancée en », « né en ». Une telle année ne vieillit pas : rien à mettre à jour.
 */
const HISTORICAL_CUE = /(?:\bdepuis|\bd[èe]s|\b(?:fond|cr[ée]|lanc|n)[ée]e?s?\s+en)\s+(?:l['’]ann[ée]e\s+)?$/i;

/** Année historique : introduite par un repère de début (« depuis », « fondée en »…) dans son extrait */
export function isHistoricalMention(mention: YearMention): boolean {
  const index = mention.excerpt.indexOf(String(mention.year));
  if (index < 0) return false;
  return HISTORICAL_CUE.test(mention.excerpt.slice(Math.max(0, index - 30), index));
}

/** Années révolues à relire : sans celles qui datent un début toujours en cours ou un fait historique */
export function staleMentions(mentions: YearMention[]): YearMention[] {
  return mentions.filter((mention) => !isHistoricalMention(mention));
}
