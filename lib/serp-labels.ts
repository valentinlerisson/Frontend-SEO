import type { SerpAnalysis } from '@/core/domain/types'

/**
 * Où se trouve la page dans les résultats : à part entière, en lien annexe sous un résultat du même site
 * (cas fréquent d'une page « À propos » sous la page d'accueil), ou seulement via une autre page du site.
 */
export function describePagePosition(serp: SerpAnalysis): {
  /** Position retenue pour la couleur (null : absent) */
  rank: number | null
  badge: string
  detail: string
} {
  if (serp.pagePosition !== null) {
    return { rank: serp.pagePosition, badge: `n°${serp.pagePosition}`, detail: 'Cette page sort dans les résultats' }
  }
  if (serp.pageSitelinkOf !== null) {
    return {
      rank: serp.pageSitelinkOf,
      badge: `Lien annexe · n°${serp.pageSitelinkOf}`,
      detail: `Cette page s'affiche en lien annexe sous le résultat n°${serp.pageSitelinkOf}`,
    }
  }
  if (serp.ownPosition !== null) {
    return {
      rank: serp.ownPosition,
      badge: `Site n°${serp.ownPosition}`,
      detail: `Une autre page du site sort au n°${serp.ownPosition} ; cette page n'apparaît pas seule`,
    }
  }
  return { rank: null, badge: `Absent du Top ${serp.results.length}`, detail: 'Le site n’apparaît pas dans les résultats' }
}
