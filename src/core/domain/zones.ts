import { normalizeText } from './scoring/autocomplete-relevance';

/**
 * Zones ciblées d'un projet : villes, départements et régions françaises (validés par l'API Géo officielle), pays
 * (codes ISO, noms français), ou autre lieu saisi tel quel (« côte d'azur », « casablanca », « europe »).
 * Les recherches proposées par l'IA ne contiennent aucun lieu : au moment de la mesure, le nom de la zone est ajouté
 * à la fin de la recherche (« agence web » devient « agence web oise »). La position de l'internaute n'est pas
 * simulée : le paramètre de lieu de Google n'a pas montré d'effet mesurable sur les résultats.
 */
export interface GeoZone {
  /** Identifiant stable : `commune:31555`, `departement:28`, `region:76`, `pays:MA`, `lieu:cote-d-azur` */
  id: string;
  kind: GeoZoneKind;
  /** Code INSEE (commune, département ou région), code ISO à deux lettres (pays), texte saisi (autre lieu) */
  code: string;
  /** Nom officiel (« Toulouse », « Eure-et-Loir », « Occitanie », « Maroc ») ou texte saisi */
  name: string;
  /** Libellé affiché (« Dreux (28) », « Eure-et-Loir (28) », « Occitanie », « Maroc ») */
  label: string;
  departement?: { code: string; name: string };
  region?: { code: string; name: string };
  /** Codes postaux d'une commune (une adresse de la page qui en contient un couvre la zone) */
  postalCodes?: string[];
  /**
   * Ville de référence : la commune, ou le chef-lieu du département ou de la région (couverture des adresses).
   * Absente pour un pays ou un autre lieu.
   */
  city?: { code: string; name: string; region: string; latitude: number; longitude: number };
}

export type GeoZoneKind = 'commune' | 'departement' | 'region' | 'pays' | 'lieu';

/** Types de zone acceptés par les routes d'enregistrement */
export const GEO_ZONE_KINDS: readonly GeoZoneKind[] = ['commune', 'departement', 'region', 'pays', 'lieu'];

/** Autre lieu saisi tel quel : 2 à 60 caractères, lettres, chiffres, espaces, apostrophes, tirets et points */
export function cleanPlaceName(text: string): string | null {
  const name = text.replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 60 && /^[\p{L}\p{N}][\p{L}\p{N} '’.-]*$/u.test(name) ? name : null;
}

/** Zones au plus par projet : 3 zones × 3 recherches font déjà 9 recherches Google par page */
export const MAX_PROJECT_ZONES = 3;

/**
 * Zones pour lesquelles mesurer une page : sa zone propre si elle en a une (page « agence Dreux » d'un site basé à
 * Chartres), sinon celles du projet (3 au plus). Aucune zone : une mesure sans lieu (`undefined`).
 */
export function measurementZones(projectZones: GeoZone[], pageZone?: GeoZone | null): (GeoZone | undefined)[] {
  if (pageZone) return [pageZone];
  const zones = projectZones.slice(0, MAX_PROJECT_ZONES);
  return zones.length > 0 ? zones : [undefined];
}

/**
 * Zone d'une mesure (affichée à côté de la position). `city` porte le nom ajouté à la recherche (« Oise »,
 * « Attichy ») : la zone n'est plus simulée comme lieu de l'internaute, elle est écrite dans la recherche.
 */
export function zoneTag(zone: GeoZone): { id: string; label: string; city: string } {
  return { id: zone.id, label: zone.label, city: zone.name };
}

/**
 * Recherche envoyée à Google pour une zone : le nom de la zone ajouté à la fin (« agence web » devient
 * « agence web oise »), sauf s'il y figure déjà. Sans zone : la recherche telle quelle. Les recherches proposées
 * par l'IA n'ont jamais de lieu : c'est ici, au moment de la mesure, que la zone choisie est ajoutée.
 */
export function queryForZone(query: string, zone?: GeoZone): string {
  const base = query.trim();
  if (!zone) return base;
  const words = ` ${normalizeText(base)} `;
  return words.includes(` ${normalizeText(zone.name)} `) ? base : `${base} ${zone.name.toLowerCase()}`;
}
