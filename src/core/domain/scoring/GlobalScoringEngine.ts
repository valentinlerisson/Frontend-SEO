export class GlobalScoringEngine {
  /**
   * Calcule le score unitaire d'une page
   * Si la page est pilier, c'est la moyenne des 3 scores
   * Si non-pilier, son score affiché correspond au score technique seul
   */
  public static computePageScore(
    techScore: number,
    editorialScore: number | undefined,
    geoScore: number | undefined,
    isPillar: boolean
  ): number {
    if (isPillar && editorialScore !== undefined && geoScore !== undefined) {
      return Math.round((techScore + editorialScore + geoScore) / 3);
    }
    return Math.round(techScore);
  }

  /**
   * Calcule le score global consolidé du projet :
   * 40% Technique (toutes pages) + 35% Éditorial (piliers) + 25% GEO (piliers)
   */
  public static computeProjectScore(
    pages: Array<{
      techScore: number;
      editorialScore?: number;
      geoScore?: number;
      isPillar: boolean;
      /** Page volontairement non indexable (noindex, sans erreur HTTP) : exclue de la moyenne technique */
      excludedFromTechAverage?: boolean;
      /** Points réellement mesurés sur 100 pour chaque pilier (100 par défaut) : poids de la page dans la moyenne */
      techMeasured?: number;
      editorialMeasured?: number;
      geoMeasured?: number;
    }>
  ): {
    overallScore: number;
    techAvg: number;
    editorialAvg: number;
    geoAvg: number;
  } {
    if (pages.length === 0) {
      return { overallScore: 0, techAvg: 0, editorialAvg: 0, geoAvg: 0 };
    }

    // Une page en noindex volontaire (mentions légales, remerciement) ne doit pas tirer la moyenne vers le bas ;
    // les pages en erreur 4xx/5xx restent comptées
    const techPages = pages.some((p) => !p.excludedFromTechAverage) ? pages.filter((p) => !p.excludedFromTechAverage) : pages;
    // Moyenne pondérée par les points mesurés : une page notée sur 65 points pèse moins qu'une page notée sur 100
    const weighted = <T>(items: T[], score: (item: T) => number, weight: (item: T) => number | undefined) => {
      const totalWeight = items.reduce((acc, item) => acc + Math.max(1, weight(item) ?? 100), 0);
      return Math.round(items.reduce((acc, item) => acc + score(item) * Math.max(1, weight(item) ?? 100), 0) / totalWeight);
    };
    const techAvg = weighted(techPages, (p) => p.techScore, (p) => p.techMeasured);

    const pillarPages = pages.filter((p) => p.isPillar);
    const evaluatedEdito = pillarPages.filter((p) => p.editorialScore !== undefined);
    const evaluatedGeo = pillarPages.filter((p) => p.geoScore !== undefined);

    const editorialAvg =
      evaluatedEdito.length > 0
        ? weighted(evaluatedEdito, (p) => p.editorialScore ?? 0, (p) => p.editorialMeasured)
        : techAvg;

    const geoAvg =
      evaluatedGeo.length > 0 ? weighted(evaluatedGeo, (p) => p.geoScore ?? 0, (p) => p.geoMeasured) : techAvg;

    const overallScore = Math.round(0.4 * techAvg + 0.35 * editorialAvg + 0.25 * geoAvg);

    return {
      overallScore,
      techAvg,
      editorialAvg,
      geoAvg
    };
  }
}
