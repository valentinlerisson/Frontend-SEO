import type { SerpAnalysis } from './types';
import type { GeoZone } from './zones';
import { normalizeText } from './scoring/autocomplete-relevance';

/**
 * Visibilité locale, par zone ciblée : pages qui la couvrent, établissements repérés, et bilan des mesures Google
 * (positions, pack local). Tout est calculé à partir des données déjà relevées : aucune recherche en plus.
 */

/** Code postal et ville d'une adresse en texte libre (« … 31100 Toulouse ») */
export function parseAddress(text: string | null | undefined): { postalCode: string; city: string } | null {
  const match = (text ?? '').match(/\b(\d{5})\s+([A-ZÀ-Ýa-zà-ÿ][\p{L}'’ -]{1,60})/u);
  if (!match) return null;
  const city = match[2].split(/\s+(?:France|Tél|Tel|Téléphone|Contact|Horaires)\b/i)[0].trim().replace(/[ ,.-]+$/, '');
  return { postalCode: match[1], city };
}

/** Le texte nomme la zone (mot entier, sans casse ni accents) */
function namesZone(zone: GeoZone, text: string | null | undefined): boolean {
  const haystack = ` ${normalizeText(text ?? '')} `;
  return haystack.includes(` ${normalizeText(zone.name)} `);
}

/** L'adresse est dans la zone : code postal de la commune, du département, ou nom de la zone */
function addressInZone(zone: GeoZone, address: { postalCode: string; city: string } | null): boolean {
  if (!address) return false;
  if (zone.kind === 'commune') {
    return (zone.postalCodes ?? []).includes(address.postalCode) || normalizeText(address.city) === normalizeText(zone.name);
  }
  if (zone.kind === 'departement') {
    const department = address.postalCode.startsWith('97') ? address.postalCode.slice(0, 3) : address.postalCode.slice(0, 2);
    return department === zone.code || (zone.code.startsWith('2') && /^2[AB]$/i.test(zone.code) && department === '20');
  }
  return false;
}

export interface LocalPage {
  id: string;
  path: string;
  title?: string | null;
  h1?: string | null;
  /** Adresse visible sur la page (texte relevé par l'analyse des coordonnées) */
  address?: string | null;
  /** Zone propre de la page */
  zoneId?: string;
}

export type CoverageReason = 'zone' | 'title' | 'h1' | 'adresse';

/**
 * Pages qui couvrent une zone : rattachées à elle, ou qui la nomment dans le Title ou le H1, ou dont l'adresse y est.
 * Une simple mention dans le texte ne suffit pas (« nous intervenons aussi à Dreux »).
 */
export function zoneCoverage(zone: GeoZone, pages: LocalPage[]): { id: string; path: string; reason: CoverageReason }[] {
  const covered: { id: string; path: string; reason: CoverageReason }[] = [];
  for (const page of pages) {
    const reason: CoverageReason | null =
      page.zoneId === zone.id
        ? 'zone'
        : namesZone(zone, page.title)
          ? 'title'
          : namesZone(zone, page.h1)
            ? 'h1'
            : addressInZone(zone, parseAddress(page.address))
              ? 'adresse'
              : null;
    if (reason) covered.push({ id: page.id, path: page.path, reason });
  }
  return covered;
}

/**
 * Établissements d'un réseau : pages dont l'adresse a un autre code postal que l'adresse la plus fréquente du site
 * (le siège, souvent en pied de page). Un site sans adresse dominante n'en a pas.
 */
export function detectEstablishments<T extends LocalPage>(pages: T[]): { page: T; postalCode: string; city: string }[] {
  const parsed = pages.map((page) => ({ page, address: parseAddress(page.address) }));
  const counts = new Map<string, number>();
  for (const { address } of parsed) if (address) counts.set(address.postalCode, (counts.get(address.postalCode) ?? 0) + 1);
  const dominant = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!dominant) return [];
  return parsed
    .filter((item): item is { page: T; address: { postalCode: string; city: string } } =>
      Boolean(item.address && item.address.postalCode !== dominant)
    )
    .map(({ page, address }) => ({ page, postalCode: address.postalCode, city: address.city }));
}

export interface ZoneMeasures {
  /** Recherches mesurées depuis la zone, terminées */
  measured: number;
  /** Recherches où une page du site sort (Top 30 lu) */
  visible: number;
  /** Meilleure position de la zone : requête, page et rang */
  best?: { query: string; path: string; rank: number };
  /** Recherches qui affichent un pack local, et celles où le site y figure (fiches lues) */
  packShown: number;
  packPresent: number;
  packRead: number;
}

/** Bilan des mesures Google faites depuis une zone, toutes pages confondues */
export function zoneMeasures(zoneId: string, measures: { path: string; serp: SerpAnalysis }[]): ZoneMeasures {
  const result: ZoneMeasures = { measured: 0, visible: 0, packShown: 0, packPresent: 0, packRead: 0 };
  for (const { path, serp } of measures) {
    if (serp.status !== 'DONE' || serp.zone?.id !== zoneId) continue;
    result.measured++;
    const rank = serp.pagePosition ?? serp.pageSitelinkOf ?? serp.ownPosition;
    if (rank !== null && rank !== undefined) {
      result.visible++;
      if (!result.best || rank < result.best.rank) result.best = { query: serp.query, path, rank };
    }
    if (serp.features?.localPack) result.packShown++;
    if (serp.localPackRank !== undefined) {
      result.packRead++;
      if (serp.localPackRank !== null) result.packPresent++;
    }
  }
  return result;
}
