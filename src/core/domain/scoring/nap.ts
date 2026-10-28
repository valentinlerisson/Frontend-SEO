import type { NapSignals } from '../types';

export interface NapPageResult {
  /** false : aucune coordonnée trouvée sur tout le site, le critère sort du score */
  measured: boolean;
  /** 0 - 15 : téléphone présent sur le site (5) + adresse présente sur le site (5) + cohérence de la page (5) */
  score: number;
  /** false : la page n'a pas de JSON-LD de coordonnées à comparer, les 5 pts de cohérence sortent du dénominateur */
  consistencyMeasured?: boolean;
  detectedPhone: string | null;
  detectedAddress: string | null;
  detectedName: string | null;
  isConsistent: boolean;
  /** Manque de coordonnées à signaler sur cette page : page d'accueil seulement, le manque concerne le site */
  reportMissing: boolean;
  critique: string;
  advice: string;
}

/** Points NAP réellement mesurés pour une page : 0 (aucune coordonnée), 10 (rien à comparer) ou 15 */
export function napMeasuredPoints(nap: { measured?: boolean; consistencyMeasured?: boolean }): number {
  if (nap.measured === false) return 0;
  return nap.consistencyMeasured === false ? 10 : 15;
}

const key = (postalCode: string, city: string) => `${postalCode} ${city.toLowerCase()}`;

function mostFrequent(counts: Map<string, number>): { value: string; count: number } | null {
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/**
 * Cohérence nom, adresse, téléphone (NAP) jugée à l'échelle du site : Google n'exige pas les coordonnées sur chaque
 * page. Téléphone et adresse comptent s'ils figurent quelque part sur le site (accueil, contact, pied de page) ;
 * chaque page perd seulement les 5 pts de cohérence si ses coordonnées visibles contredisent son propre JSON-LD
 * (un groupe à plusieurs établissements a légitimement un numéro et une adresse par fiche).
 * Le numéro et l'adresse de référence sont ceux qui reviennent sur le plus de pages. Un manque de coordonnées n'est
 * signalé qu'une fois, sur la page d'accueil (première page de la liste).
 */
export function analyzeNap(pages: { url: string; nap?: NapSignals }[]): Map<string, NapPageResult> {
  const phoneCounts = new Map<string, number>();
  const addressCounts = new Map<string, number>();
  const addressText = new Map<string, string>();
  for (const { nap } of pages) {
    if (!nap) continue;
    for (const phone of new Set(nap.phones)) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);
    for (const address of nap.addresses) {
      const k = key(address.postalCode, address.city);
      if (!addressText.has(k)) addressText.set(k, address.text);
    }
    for (const address of new Set(nap.addresses.map((a) => key(a.postalCode, a.city)))) {
      addressCounts.set(address, (addressCounts.get(address) ?? 0) + 1);
    }
  }

  const measured = phoneCounts.size > 0 || addressCounts.size > 0;
  const dominantPhone = mostFrequent(phoneCounts);
  const dominantAddress = mostFrequent(addressCounts);
  const sitePhone = dominantPhone?.value ?? null;
  const siteAddress = dominantAddress ? addressText.get(dominantAddress.value) ?? dominantAddress.value : null;
  const results = new Map<string, NapPageResult>();

  pages.forEach(({ url, nap }, index) => {
    const isHome = index === 0;
    if (!measured) {
      results.set(url, {
        measured: false,
        score: 0,
        detectedPhone: null,
        detectedAddress: null,
        detectedName: null,
        isConsistent: false,
        reportMissing: isHome,
        critique: 'Aucun numéro de téléphone ni adresse postale détectés sur le site : critère exclu du score.',
        advice: 'Afficher l’adresse et le téléphone de l’entreprise (pied de page, page de contact) et les déclarer en JSON-LD.'
      });
      return;
    }

    const phones = nap?.phones ?? [];
    const addresses = nap?.addresses ?? [];
    const schema = nap?.schema;
    const phoneMismatch = Boolean(schema?.phone && phones.length > 0 && !phones.includes(schema.phone));
    const addressMismatch = Boolean(
      schema?.postalCode && addresses.length > 0 && !addresses.some((a) => a.postalCode === schema.postalCode)
    );
    // Un groupe multi-établissements affiche légitimement un numéro et une adresse par fiche : la cohérence se juge
    // contre le JSON-LD de la même page seulement, jamais contre le numéro le plus fréquent du site
    // Sans téléphone ou code postal en JSON-LD face à des coordonnées visibles, il n'y a rien à contredire : la
    // cohérence n'est pas mesurable et ses 5 pts sortent du dénominateur (ni accordés d'office, ni refusés)
    const consistencyMeasured = Boolean(
      (schema?.phone && phones.length > 0) || (schema?.postalCode && addresses.length > 0)
    );
    const isConsistent = !phoneMismatch && !addressMismatch;
    const score = (sitePhone ? 5 : 0) + (siteAddress ? 5 : 0) + (consistencyMeasured && isConsistent ? 5 : 0);

    const problems: string[] = [];
    if (!sitePhone) problems.push('aucun téléphone sur le site');
    if (!siteAddress) problems.push('aucune adresse sur le site');
    if (phoneMismatch) problems.push('le téléphone affiché diffère de celui du JSON-LD');
    if (addressMismatch) problems.push('l’adresse affichée diffère de celle du JSON-LD');

    results.set(url, {
      measured: true,
      score,
      consistencyMeasured,
      detectedPhone: phones[0] ?? sitePhone,
      detectedAddress: addresses[0]?.text ?? siteAddress,
      detectedName: schema?.name ?? null,
      isConsistent,
      reportMissing: isHome && (!sitePhone || !siteAddress),
      critique:
        problems.length === 0
          ? consistencyMeasured
            ? 'Coordonnées présentes sur le site et cohérentes sur cette page.'
            : 'Coordonnées présentes sur le site ; cette page n’a pas de JSON-LD de coordonnées à comparer, la cohérence n’est pas notée.'
          : `Coordonnées : ${problems.join(' ; ')}.`,
      advice: 'Utiliser exactement le même nom, la même adresse et le même numéro partout, et les reprendre dans le JSON-LD LocalBusiness ou Organization.'
    });
  });

  return results;
}
