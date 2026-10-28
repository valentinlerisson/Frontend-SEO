import type { SerpFeatures, SerpResult } from '../domain/types';

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
   * `start` : première page lue (0 = première page) ; `fresh` : ignorer le cache (re-test)
   */
  search(
    query: string,
    options?: { pages?: number; start?: number; domain?: string; fresh?: boolean }
  ): Promise<{ results: SerpResult[]; features?: SerpFeatures }>;
}
