/** Volume de recherche d'un mot-clé, tel que donné par l'outil de planification (Google Ads Keyword Planner) */
export interface KeywordVolume {
  keyword: string;
  /** Recherches mensuelles moyennes ; null quand l'outil ne donne pas de chiffre */
  avgMonthlySearches: number | null;
  /** Fourchette quand l'outil ne donne pas de chiffre exact (compte sans dépense active) */
  range?: { low: number; high: number };
  /** Concurrence publicitaire (pas la difficulté SEO) */
  competition?: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Recherches des 12 derniers mois, du plus ancien au plus récent */
  monthly?: number[];
  /** Mots-clés demandés que l'outil a regroupés sous celui-ci (variantes proches) */
  closeVariants?: string[];
}

export interface KeywordIdeasResult {
  /** Volumes des mots-clés demandés */
  seeds: KeywordVolume[];
  /** Idées voisines proposées par l'outil, classées par volume décroissant */
  ideas: KeywordVolume[];
}

/** Source des volumes de recherche ; aucune source configurée : l'analyse continue sans volumes */
export interface KeywordVolumePort {
  readonly id: string;
  ideas(seeds: string[], options?: { url?: string; limit?: number }): Promise<KeywordIdeasResult>;
}

/** Accès refusé ou non configuré : le message dit quoi faire */
export class KeywordVolumeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordVolumeUnavailableError';
  }
}
