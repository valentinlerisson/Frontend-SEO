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

    const totalTech = pages.reduce((acc, p) => acc + p.techScore, 0);
    const techAvg = Math.round(totalTech / pages.length);

    const pillarPages = pages.filter((p) => p.isPillar);
    const evaluatedEdito = pillarPages.filter((p) => p.editorialScore !== undefined);
    const evaluatedGeo = pillarPages.filter((p) => p.geoScore !== undefined);

    const editorialAvg =
      evaluatedEdito.length > 0
        ? Math.round(evaluatedEdito.reduce((acc, p) => acc + (p.editorialScore ?? 0), 0) / evaluatedEdito.length)
        : techAvg;

    const geoAvg =
      evaluatedGeo.length > 0
        ? Math.round(evaluatedGeo.reduce((acc, p) => acc + (p.geoScore ?? 0), 0) / evaluatedGeo.length)
        : techAvg;

    const overallScore = Math.round(0.4 * techAvg + 0.35 * editorialAvg + 0.25 * geoAvg);

    return {
      overallScore,
      techAvg,
      editorialAvg,
      geoAvg
    };
  }
}
