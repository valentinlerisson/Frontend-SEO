/**
 * Seuils du pilier technique, partagés par le moteur de scoring (génération des anomalies)
 * et par le presenter (accordéons du tiroir d'inspection) : une seule source de vérité,
 * pour qu'une anomalie listée dans la To-Do ne soit jamais contredite par le détail.
 */
export const TECH_THRESHOLDS = {
  h1: { min: 10, max: 70 },
  title: { min: 30, max: 65 },
  metaDescription: { min: 110, max: 165 },
  /** Nombre de liens entrants internes à partir duquel le maillage est jugé suffisant */
  goodInlinks: 3,
  /** Profondeur de clic maximale sans alerte */
  maxDepth: 3
} as const;
