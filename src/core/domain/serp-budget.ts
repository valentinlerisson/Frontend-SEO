/**
 * Budget de recherches Google (mesure en Chrome local, contraire aux conditions d'utilisation de Google : chaque
 * recherche augmente le risque de captcha). Chaque page de résultats demandée compte ; une réponse du cache (moins
 * de 24 h) ne compte pas. Le plafond par jour vaut pour tous les projets : toutes les recherches partent de la même
 * machine. Valeurs par défaut prudentes, sans seuil de captcha connu : à ajuster dans les paramètres.
 */
export const DEFAULT_SERP_PER_RUN = 20;
export const MIN_SERP_PER_RUN = 5;
export const MAX_SERP_PER_RUN = 60;
export const DEFAULT_SERP_PER_DAY = 60;
export const MIN_SERP_PER_DAY = 10;
export const MAX_SERP_PER_DAY = 300;

export interface SerpBudget {
  perRun: number;
  perDay: number;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

export function resolveSerpBudget(input?: Partial<SerpBudget> | null): SerpBudget {
  return {
    perRun: clamp(input?.perRun, MIN_SERP_PER_RUN, MAX_SERP_PER_RUN, DEFAULT_SERP_PER_RUN),
    perDay: clamp(input?.perDay, MIN_SERP_PER_DAY, MAX_SERP_PER_DAY, DEFAULT_SERP_PER_DAY)
  };
}

/** Jour du compteur, à l'heure locale de la machine (AAAA-MM-JJ) */
export function usageDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Recherches encore possibles dans ce lancement et aujourd'hui */
export function remainingSearches(budget: SerpBudget, usedInRun: number, usedToday: number): number {
  return Math.max(0, Math.min(budget.perRun - usedInRun, budget.perDay - usedToday));
}

/**
 * Ordre des recherches d'un lancement (requête × zone), pages stratégiques d'abord à chaque palier :
 * 1. requête visée de chaque page dans sa zone principale, puis dans ses autres zones ;
 * 2. autres requêtes de chaque page dans sa zone principale ;
 * 3. autres requêtes dans les autres zones.
 * Ainsi un budget court mesure la cible du plus de pages possible. Sans zone : une seule colonne (`zoneCount` 1).
 */
export function prioritizeSearches<T extends { isPillar: boolean; queries: string[]; zoneCount?: number }>(
  pages: T[]
): { page: T; queryIndex: number; zoneIndex: number }[] {
  const ordered = [...pages].sort((a, b) => Number(b.isPillar) - Number(a.isPillar));
  const tier = (queryIndex: number, zoneIndex: number) => (queryIndex === 0 ? 0 : zoneIndex === 0 ? 1 : 2);
  const tasks: { page: T; queryIndex: number; zoneIndex: number; tier: number; rank: number }[] = [];
  ordered.forEach((page, pageRank) => {
    const zones = Math.max(1, page.zoneCount ?? 1);
    page.queries.forEach((_, queryIndex) => {
      for (let zoneIndex = 0; zoneIndex < zones; zoneIndex++) {
        // Dans un palier : par position (zone puis requête), puis par page
        const rank = queryIndex === 0 ? zoneIndex : zoneIndex * 10 + queryIndex;
        tasks.push({ page, queryIndex, zoneIndex, tier: tier(queryIndex, zoneIndex), rank: rank * 1000 + pageRank });
      }
    });
  });
  return tasks
    .sort((a, b) => a.tier - b.tier || a.rank - b.rank)
    .map(({ page, queryIndex, zoneIndex }) => ({ page, queryIndex, zoneIndex }));
}
