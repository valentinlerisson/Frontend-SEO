import { promises as fs } from 'fs';
import path from 'path';
import { simplifyGeometry, type CommunePoint, type GeoPoint, type ShapeGeometry } from '@/core/domain/geo-radius';
import { normalizeText } from '@/core/domain/scoring/autocomplete-relevance';

/**
 * Données de la carte des zones, toutes publiques et gratuites, gardées en cache dans `.data/geo/` :
 * - contours des communes, départements et régions : IGN Géoplateforme (ADMIN EXPRESS COG CARTO, service WFS) ;
 * - centres et populations de toutes les communes : API Géo (geo.api.gouv.fr), relus tous les 30 jours ;
 * - centre de la commune d'une adresse (code postal et ville) : API Géo.
 */
const CACHE_DIR = path.join(process.cwd(), '.data', 'geo');
const COMMUNES_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const WFS = 'https://data.geopf.fr/wfs/ows';
const GEO_API = 'https://geo.api.gouv.fr';

/** Types IGN et finesse du contour affiché (en degrés : environ 50 m, 300 m, 1 km) */
const SHAPES = {
  commune: { typeName: 'ADMINEXPRESS-COG-CARTO.LATEST:commune', tolerance: 0.0005 },
  departement: { typeName: 'ADMINEXPRESS-COG-CARTO.LATEST:departement', tolerance: 0.003 },
  region: { typeName: 'ADMINEXPRESS-COG-CARTO.LATEST:region', tolerance: 0.01 }
} as const;

export type ShapeKind = keyof typeof SHAPES;

async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

async function readCache<T>(file: string, maxAgeMs?: number): Promise<T | null> {
  try {
    const full = path.join(CACHE_DIR, file);
    if (maxAgeMs !== undefined && Date.now() - (await fs.stat(full)).mtimeMs > maxAgeMs) return null;
    return JSON.parse(await fs.readFile(full, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeCache(file: string, value: unknown): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, file), JSON.stringify(value));
  } catch {
    // Cache facultatif : la donnée est relue au prochain appel
  }
}

/** Liste compacte : [code, nom, département, latitude, longitude, population] */
type CompactCommune = [string, string, string, number, number, number];
let communesInMemory: Promise<CommunePoint[]> | null = null;

export class GeoShapes {
  /** Contour allégé d'une commune, d'un département ou d'une région (code INSEE), ou null s'il est introuvable */
  static async contour(kind: ShapeKind, code: string): Promise<ShapeGeometry | null> {
    if (!/^[0-9AB]{2,5}$/i.test(code)) return null;
    const file = `contour-${kind}-${code.toUpperCase()}.json`;
    const cached = await readCache<ShapeGeometry>(file);
    if (cached) return cached;
    const { typeName, tolerance } = SHAPES[kind];
    const params = new URLSearchParams({
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: typeName,
      outputFormat: 'application/json',
      count: '1',
      CQL_FILTER: `code_insee='${code.toUpperCase()}'`
    });
    const data = await fetchJson<{ features?: { geometry?: ShapeGeometry }[] }>(`${WFS}?${params}`, 20000);
    const geometry = data?.features?.[0]?.geometry;
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null;
    const simplified = simplifyGeometry(geometry, tolerance);
    await writeCache(file, simplified);
    return simplified;
  }

  /** Toutes les communes avec leur centre et leur population (environ 35 000), une fois par processus */
  static communes(): Promise<CommunePoint[]> {
    communesInMemory ??= this.loadCommunes().catch((error) => {
      communesInMemory = null;
      throw error;
    });
    return communesInMemory;
  }

  private static async loadCommunes(): Promise<CommunePoint[]> {
    const file = 'communes.json';
    let compact = await readCache<CompactCommune[]>(file, COMMUNES_MAX_AGE_MS);
    if (!compact) {
      const raw = await fetchJson<{ nom: string; code: string; codeDepartement?: string; population?: number; centre?: { coordinates: [number, number] } }[]>(
        `${GEO_API}/communes?fields=nom,code,codeDepartement,population,centre&format=json`,
        30000
      );
      if (!raw?.length) {
        // API indisponible : liste périmée plutôt que rien
        compact = await readCache<CompactCommune[]>(file);
        if (!compact) throw new Error('Liste des communes indisponible (API Géo)');
      } else {
        compact = raw
          .filter((item) => item.centre)
          .map((item) => [item.code, item.nom, item.codeDepartement ?? '', item.centre!.coordinates[1], item.centre!.coordinates[0], item.population ?? 0]);
        await writeCache(file, compact);
      }
    }
    return compact.map(([code, name, departement, latitude, longitude, population]) => ({ code, name, departement, latitude, longitude, population }));
  }

  /** Centre de la commune d'une adresse : code postal, puis la commune dont le nom correspond (sinon la plus peuplée) */
  static async locate(postalCode: string, city: string): Promise<(GeoPoint & { name: string; code: string }) | null> {
    if (!/^\d{5}$/.test(postalCode)) return null;
    const communes = await fetchJson<{ nom: string; code: string; population?: number; centre?: { coordinates: [number, number] } }[]>(
      `${GEO_API}/communes?codePostal=${postalCode}&fields=nom,code,population,centre&format=json`,
      8000
    );
    const withCentre = (communes ?? []).filter((item) => item.centre);
    if (withCentre.length === 0) return null;
    const wanted = normalizeText(city);
    const match =
      withCentre.find((item) => normalizeText(item.nom) === wanted) ??
      withCentre.find((item) => wanted && normalizeText(item.nom).startsWith(wanted)) ??
      [...withCentre].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
    return { name: match.nom, code: match.code, latitude: match.centre!.coordinates[1], longitude: match.centre!.coordinates[0] };
  }
}
