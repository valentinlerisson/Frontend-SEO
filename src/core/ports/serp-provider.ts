import type { SerpFeatures, SerpResult } from '../domain/types';

/** Endroit simulé de l'internaute (zone ciblée) : ville, paramètre uule de Google, nom de lieu pour une API */
export interface SerpLocation {
  city: string;
  uule: string;
  name: string;
}

/** Captcha ou blocage : une résolution manuelle est nécessaire */
export class SerpBlockedError extends Error {
  constructor(message = 'captcha ou blocage: résolution manuelle requise') {
    super(message);
    this.name = 'SerpBlockedError';
  }
}

/**
 * Source des résultats de recherche. Aujourd'hui un navigateur local (voir scripts/serp) ;
 * remplaçable par une API SERP (Serper.dev, DataForSEO) sans toucher au reste de l'application.
 */
export interface SerpProviderPort {
  /** Identifiant enregistré avec chaque relevé (browser, serper) */
  readonly id: string;
  /**
   * `domain` : domaine audité, dont les liens annexes (sitelinks) sont aussi extraits ;
   * `start` : première page lue (0 = première page, 9 au plus = la dixième) ; `fresh` : ignorer le cache (re-test) ;
   * `location` : endroit simulé de l'internaute (paramètre uule pour Google, nom de lieu pour une API)
   */
  search(
    query: string,
    options?: { pages?: number; start?: number; domain?: string; fresh?: boolean; location?: SerpLocation }
  ): Promise<{
    results: SerpResult[];
    features?: SerpFeatures;
    /** Pages de résultats réellement demandées à Google (0 : réponse du cache) ; comptées dans le budget */
    requests: number;
  }>;
}
