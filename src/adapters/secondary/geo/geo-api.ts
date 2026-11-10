import { cleanPlaceName, type GeoZone } from '@/core/domain/zones';
import { normalizeText } from '@/core/domain/scoring/autocomplete-relevance';

/**
 * API Géo officielle (geo.api.gouv.fr, gratuite, sans clé) : recherche et validation des zones ciblées.
 * Communes par nom ou code postal, départements par nom ou numéro, régions par nom ; chef-lieu et coordonnées
 * de la ville de référence. Pays : liste locale (codes ISO à deux lettres, noms français donnés par `Intl`).
 * Autre lieu : le texte saisi, ajouté tel quel aux recherches.
 */
const BASE = 'https://geo.api.gouv.fr';

type Commune = {
  nom: string;
  code: string;
  codesPostaux?: string[];
  population?: number;
  centre?: { coordinates: [number, number] };
  departement?: { code: string; nom: string };
  region?: { code: string; nom: string };
};

/** Un nouvel essai après une courte pause : l'API limite les appels rapprochés et renvoie parfois une erreur */
async function get<T>(path: string, attempt = 0): Promise<T | null> {
  try {
    const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000) });
    if (response.ok) return (await response.json()) as T;
    if (response.status === 404 || attempt > 0) return null;
  } catch {
    if (attempt > 0) return null;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  return get<T>(path, attempt + 1);
}

const COMMUNE_FIELDS = 'fields=nom,code,codesPostaux,population,centre,departement,region';

/** Codes à deux lettres qui ne sont pas des pays ou territoires (Union européenne, zone euro, région inconnue…) */
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB']);
let countries: { code: string; name: string }[] | null = null;

/** Pays et territoires connus de `Intl` (noms français), calculés une fois */
function countryList(): { code: string; name: string }[] {
  if (countries) return countries;
  const names = new Intl.DisplayNames(['fr'], { type: 'region', fallback: 'none' });
  const list: { code: string; name: string }[] = [];
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      const name = NOT_COUNTRIES.has(code) ? undefined : names.of(code);
      // Un nom par pays : FX (France métropolitaine) porte aussi le nom « France », FR passe avant
      if (name && name !== code && !list.some((item) => item.name === name)) list.push({ code, name });
    }
  }
  countries = list;
  return list;
}

function countryZone(country: { code: string; name: string }): GeoZone {
  return { id: `pays:${country.code}`, kind: 'pays', code: country.code, name: country.name, label: country.name };
}

/**
 * Pays dont le nom, ou un mot du nom, commence par la saisie (« maroc », « unis » pour États-Unis) : nom identique,
 * puis nom qui commence par la saisie, puis le plus court
 */
function searchCountries(query: string): GeoZone[] {
  const wanted = normalizeText(query);
  if (wanted.length < 2) return [];
  const rank = (name: string) => (name === wanted ? 0 : name.startsWith(wanted) ? 1 : 2);
  return countryList()
    .map((country) => ({ country, name: normalizeText(country.name) }))
    .filter(({ name }) => ` ${name}`.includes(` ${wanted}`))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.length - b.name.length)
    .slice(0, 3)
    .map(({ country }) => countryZone(country));
}

/** Autre lieu saisi tel quel (« Côte d'Azur », « Casablanca », « Europe ») */
function placeZone(text: string): GeoZone | null {
  const name = cleanPlaceName(text);
  if (!name) return null;
  return { id: `lieu:${normalizeText(name).replace(/\s+/g, '-')}`, kind: 'lieu', code: name, name, label: name };
}

function cityOf(commune: Commune): GeoZone['city'] | null {
  if (!commune.centre) return null;
  return {
    code: commune.code,
    name: commune.nom,
    region: commune.region?.nom ?? '',
    longitude: commune.centre.coordinates[0],
    latitude: commune.centre.coordinates[1]
  };
}

function communeZone(commune: Commune): GeoZone | null {
  const city = cityOf(commune);
  if (!city) return null;
  return {
    id: `commune:${commune.code}`,
    kind: 'commune',
    code: commune.code,
    name: commune.nom,
    label: commune.departement ? `${commune.nom} (${commune.departement.code})` : commune.nom,
    departement: commune.departement ? { code: commune.departement.code, name: commune.departement.nom } : undefined,
    region: commune.region ? { code: commune.region.code, name: commune.region.nom } : undefined,
    postalCodes: commune.codesPostaux,
    city
  };
}

export class GeoApi {
  /** Zone complète à partir de son type et de son code (validation côté serveur de ce que l'interface envoie) */
  static async resolve(kind: GeoZone['kind'], code: string): Promise<GeoZone | null> {
    if (kind === 'pays') {
      const country = countryList().find((item) => item.code === code.toUpperCase());
      return country ? countryZone(country) : null;
    }
    if (kind === 'lieu') return placeZone(code);
    if (!/^[0-9A-B]{2,5}$/i.test(code)) return null;
    if (kind === 'commune') {
      const commune = await get<Commune>(`/communes/${code}?${COMMUNE_FIELDS}`);
      return commune ? communeZone(commune) : null;
    }
    if (kind === 'departement') {
      const departement = await get<{ nom: string; code: string; chefLieu: string; region?: { code: string; nom: string } }>(
        `/departements/${code}?fields=nom,code,chefLieu,region`
      );
      const chief = departement && (await get<Commune>(`/communes/${departement.chefLieu}?${COMMUNE_FIELDS}`));
      const city = chief && cityOf(chief);
      if (!departement || !city) return null;
      return {
        id: `departement:${departement.code}`,
        kind,
        code: departement.code,
        name: departement.nom,
        label: `${departement.nom} (${departement.code})`,
        departement: { code: departement.code, name: departement.nom },
        region: departement.region ? { code: departement.region.code, name: departement.region.nom } : undefined,
        city
      };
    }
    const region = await get<{ nom: string; code: string; chefLieu: string }>(`/regions/${code}?fields=nom,code,chefLieu`);
    const chief = region && (await get<Commune>(`/communes/${region.chefLieu}?${COMMUNE_FIELDS}`));
    const city = chief && cityOf(chief);
    if (!region || !city) return null;
    return {
      id: `region:${region.code}`,
      kind: 'region',
      code: region.code,
      name: region.nom,
      label: region.nom,
      region: { code: region.code, name: region.nom },
      city
    };
  }

  /**
   * Propositions pour une saisie libre : code postal, numéro de département, nom de ville, de département, de région
   * ou de pays ; en dernier, la saisie elle-même comme autre lieu (sauf si une proposition porte déjà ce nom)
   */
  static async search(input: string): Promise<GeoZone[]> {
    const query = input.trim();
    if (query.length < 2) return [];
    const zones: (GeoZone | null)[] = [];

    if (/^\d{5}$/.test(query)) {
      const communes = (await get<Commune[]>(`/communes?codePostal=${query}&${COMMUNE_FIELDS}`)) ?? [];
      zones.push(...communes.map(communeZone));
    } else if (/^(\d{2,3}|2[AB])$/i.test(query)) {
      zones.push(await this.resolve('departement', query.toUpperCase()));
    } else {
      const name = encodeURIComponent(query);
      const [regions, departements, communes] = await Promise.all([
        get<{ code: string }[]>(`/regions?nom=${name}&fields=code&limit=2`),
        get<{ code: string }[]>(`/departements?nom=${name}&fields=code&limit=2`),
        get<Commune[]>(`/communes?nom=${name}&${COMMUNE_FIELDS}&boost=population&limit=5`)
      ]);
      zones.push(...searchCountries(query));
      for (const region of regions ?? []) zones.push(await this.resolve('region', region.code));
      for (const departement of departements ?? []) zones.push(await this.resolve('departement', departement.code));
      zones.push(...(communes ?? []).map(communeZone));
    }
    const unique = new Map<string, GeoZone>();
    for (const zone of zones) if (zone && !unique.has(zone.id)) unique.set(zone.id, zone);
    // Nom identique à la saisie d'abord (« France » le pays avant « Île-de-France »)
    const wanted = normalizeText(query);
    const found = Array.from(unique.values())
      .sort((a, b) => Number(normalizeText(b.name) === wanted) - Number(normalizeText(a.name) === wanted))
      .slice(0, 7);
    const place = /^\d/.test(query) || found.some((zone) => normalizeText(zone.name) === wanted) ? null : placeZone(query);
    return place ? [...found, place] : found;
  }
}
