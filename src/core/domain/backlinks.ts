import type { BacklinkReport, ReferringDomain } from './types';

/**
 * Domaines référents gagnés et perdus depuis l'audit précédent. Comparaison faite seulement si les deux relevés
 * ont abouti ; deux versions différentes du graphe Common Crawl peuvent aussi expliquer un écart (exploration partielle).
 */
export function compareReferringDomains(
  previous: BacklinkReport | null | undefined,
  current: ReferringDomain[]
): BacklinkReport['changes'] {
  if (!previous || previous.status !== 'DONE') return undefined;
  const before = new Set(previous.referringDomains.map((item) => item.domain));
  const now = new Set(current.map((item) => item.domain));
  return {
    previousRelease: previous.release,
    previousDate: previous.fetchedAt,
    added: [...now].filter((domain) => !before.has(domain)),
    lost: [...before].filter((domain) => !now.has(domain))
  };
}
