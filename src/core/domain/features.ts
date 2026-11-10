/**
 * Fonctions mises de côté.
 *
 * GEO_ENABLED = false depuis le 05/11/2026, à la demande de l'utilisateur : l'analyse GEO (moteurs de réponse IA) n'est
 * pas pertinente pour le moment. Elle tourne toujours et reste enregistrée (moteur GeoScoringEngine, anomalies GEO,
 * données dans l'analyse de chaque page), mais elle n'entre plus dans les notes et l'interface ne l'affiche plus.
 * Pour la réactiver : passer à true, puis recalculer les notes enregistrées (voir docs/Fichier.md, « GEO mis de côté »).
 */
export const GEO_ENABLED = false;
