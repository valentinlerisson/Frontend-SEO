/**
 * Carte des zones (onglet Positionnement) : distance entre deux points, villes dans un rayon autour d'un centre, et
 * simplification des contours administratifs pour l'affichage. Le rayon est une aide visuelle : la position Google
 * n'est pas mesurée par distance, seulement par zone (nom ajouté à la recherche).
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Commune avec son centre (API Géo) : liste compacte gardée en cache */
export interface CommunePoint extends GeoPoint {
  code: string;
  name: string;
  /** Code du département (« 31 », « 2A », « 971 ») */
  departement: string;
  population: number;
}

export interface CommuneInRadius extends CommunePoint {
  distanceKm: number;
}

/** Rayon proposé par défaut, et bornes du réglage */
export const DEFAULT_RADIUS_KM = 20;
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 100;
/** Villes listées dans le rayon (les plus peuplées) */
export const MAX_LISTED_COMMUNES = 8;

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Distance à vol d'oiseau en kilomètres (formule de haversine) */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rayon ramené dans les bornes du réglage */
export function clampRadius(radiusKm: number): number {
  if (!Number.isFinite(radiusKm)) return DEFAULT_RADIUS_KM;
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, Math.round(radiusKm)));
}

/**
 * Communes dont le centre est dans le rayon : les plus peuplées d'abord (à égalité, la plus proche), `limit` au plus,
 * avec le nombre total de communes du rayon
 */
export function communesInRadius(
  communes: CommunePoint[],
  center: GeoPoint,
  radiusKm: number,
  limit = MAX_LISTED_COMMUNES
): { communes: CommuneInRadius[]; total: number } {
  const radius = clampRadius(radiusKm);
  // Préfiltre rapide par latitude et longitude avant le calcul exact
  const latSpan = radius / 111;
  const lonSpan = radius / (111 * Math.max(0.1, Math.cos(toRadians(center.latitude))));
  const inside = communes
    .filter((commune) => Math.abs(commune.latitude - center.latitude) <= latSpan && Math.abs(commune.longitude - center.longitude) <= lonSpan)
    .map((commune) => ({ ...commune, distanceKm: Math.round(distanceKm(center, commune) * 10) / 10 }))
    .filter((commune) => commune.distanceKm <= radius);
  inside.sort((a, b) => b.population - a.population || a.distanceKm - b.distanceKm);
  return { communes: inside.slice(0, limit), total: inside.length };
}

type Ring = [number, number][];
export type ShapeGeometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };

/**
 * Anneau allégé pour l'affichage : coordonnées arrondies, points plus proches que `tolerance` (en degrés) du dernier
 * point gardé retirés ; l'anneau reste fermé et garde au moins 4 points
 */
export function simplifyRing(ring: Ring, tolerance: number, digits = 4): Ring {
  const factor = 10 ** digits;
  const round = (value: number) => Math.round(value * factor) / factor;
  const kept: Ring = [];
  for (const [lon, lat] of ring) {
    const point: [number, number] = [round(lon), round(lat)];
    const last = kept[kept.length - 1];
    if (!last || Math.abs(point[0] - last[0]) >= tolerance || Math.abs(point[1] - last[1]) >= tolerance) kept.push(point);
  }
  if (kept.length < 4) return ring.map(([lon, lat]) => [round(lon), round(lat)] as [number, number]);
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) kept.push([first[0], first[1]]);
  return kept;
}

/** Contour allégé ; les îlots trop petits pour garder 4 points sont retirés d'un multipolygone */
export function simplifyGeometry(geometry: ShapeGeometry, tolerance: number): ShapeGeometry {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map((ring) => simplifyRing(ring, tolerance)) };
  }
  const polygons = geometry.coordinates
    .map((polygon) => polygon.map((ring) => simplifyRing(ring, tolerance)))
    .filter((polygon) => polygon[0] && polygon[0].length >= 4);
  return { type: 'MultiPolygon', coordinates: polygons.length > 0 ? polygons : geometry.coordinates };
}
