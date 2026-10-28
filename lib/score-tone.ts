/**
 * Couleur et mention d'un score : la couleur raconte l'état, pas le pilier.
 * color : arc des jauges (rouge, jaune, vert identiques dans les deux thèmes) ;
 * textColor : libellés, assombris en mode clair pour rester lisibles sur fond blanc.
 */
export function scoreTone(score: number) {
  if (score >= 80) return { color: '#12b10f', textColor: 'var(--green-ink)', label: 'Solide' }
  if (score >= 60) return { color: '#f5e400', textColor: 'var(--primary-ink)', label: 'À consolider' }
  return { color: '#ef4444', textColor: '#ef4444', label: 'À corriger' }
}
