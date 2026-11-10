/**
 * Tranches partagées par les graphiques (côté serveur et navigateur, sans dépendance lourde) : tranche de note,
 * alignée sur scoreTone (à corriger < 60, à consolider 60-79, solide >= 80), et tranche de position Google.
 */
export type HealthBand = 'weak' | 'medium' | 'strong'

export function bandOf(score: number): HealthBand {
  return score >= 80 ? 'strong' : score >= 60 ? 'medium' : 'weak'
}

export type PositionBucket = 'top3' | 'top10' | 'top30' | 'absent' | 'unmeasured'

/** undefined : pas mesurée ; null : absente des résultats lus */
export function bucketOf(position: number | null | undefined): PositionBucket {
  if (position === undefined) return 'unmeasured'
  if (position === null) return 'absent'
  if (position <= 3) return 'top3'
  if (position <= 10) return 'top10'
  return 'top30'
}
