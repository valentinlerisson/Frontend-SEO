import type { SerpAnalysis, SerpResult } from './types';

/**
 * Lecture des résultats Google pour l'utilisateur : qui occupe le Top 10, et interprétation en quelques phrases,
 * construite uniquement à partir des mesures (chaque affirmation est vérifiable). Pas de cause supposée du classement.
 */

export type ResultKind = 'own' | 'competitor' | 'directory' | 'public';

/** Annuaires, réseaux sociaux, plateformes d'avis ou de mise en relation : ils occupent des places sans être des concurrents directs */
const DIRECTORIES = [
  'pagesjaunes.fr', 'facebook.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'x.com', 'twitter.com',
  'pinterest.com', 'wikipedia.org', 'tripadvisor.fr', 'tripadvisor.com', 'yelp.fr', 'yelp.com', 'trustpilot.com',
  'societe.com', 'pappers.fr', 'infogreffe.fr', 'verif.com', 'manageo.fr', 'mappy.com', 'google.com', 'google.fr',
  'sortlist.fr', 'sortlist.com', 'malt.fr', 'codeur.com', 'indeed.com', 'indeed.fr', 'leboncoin.fr', 'hellowork.com',
  'welcometothejungle.com', 'glassdoor.fr', 'avis-verifies.com', 'justacote.com', 'cylex-france.fr', 'hoodspot.fr',
  '118712.fr', '118000.fr', 'kompass.com', 'europages.fr', 'doctolib.fr', 'reddit.com', 'quora.com', 'amazon.fr',
  'sanitaire-social.com'
];

/** Sites publics et institutionnels (en plus des adresses en .gouv.fr) */
const PUBLIC_HOSTS = ['service-public.fr', 'ameli.fr', 'caf.fr', 'urssaf.fr', 'insee.fr', 'legifrance.gouv.fr', 'bpifrance.fr', 'cci.fr'];

const hostMatches = (domain: string, list: string[]) =>
  list.some((item) => domain === item || domain.endsWith(`.${item}`));

export function classifyResult(domain: string, ownDomain: string): ResultKind {
  const host = domain.toLowerCase().replace(/^www\./, '');
  const own = ownDomain.toLowerCase().replace(/^www\./, '');
  if (host === own || host.endsWith(`.${own}`)) return 'own';
  if (hostMatches(host, DIRECTORIES)) return 'directory';
  if (host.endsWith('.gouv.fr') || hostMatches(host, PUBLIC_HOSTS)) return 'public';
  return 'competitor';
}

/** Répartition des 10 premiers résultats */
export function topTenLandscape(results: SerpResult[], ownDomain: string): { position: number; domain: string; kind: ResultKind }[] {
  return results
    .filter((result) => result.position <= 10)
    .sort((a, b) => a.position - b.position)
    .map((result) => ({ position: result.position, domain: result.domain, kind: classifyResult(result.domain, ownDomain) }));
}

const keyOf = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase();
const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
/** Zone d'une mesure : son nom est ajouté à la recherche ; un relevé ancien a été simulé depuis la ville */
const where = (serp: SerpAnalysis) => (serp.zone && !serp.sentQuery ? ` depuis ${serp.zone.city}` : '');

export interface SerpReading {
  /** Phrases d'interprétation, dans l'ordre de lecture */
  sentences: string[];
  /** Priorité unique, la plus utile d'après les mesures */
  priority: string;
}

/**
 * Interprétation des mesures d'une page (toutes recherches et zones confondues), et de la mesure principale pour le
 * Top 10 et la comparaison avec les concurrents.
 */
export function interpretSerp(input: {
  measures: SerpAnalysis[];
  main?: SerpAnalysis;
  pageUrl: string;
  ownDomain: string;
  pageWords: number;
}): SerpReading {
  const done = input.measures.filter((serp) => serp.status === 'DONE');
  const rankOf = (serp: SerpAnalysis) => serp.pagePosition ?? serp.pageSitelinkOf ?? null;
  const visible = done.filter((serp) => rankOf(serp) !== null);
  const best = visible.sort((a, b) => (rankOf(a) ?? 99) - (rankOf(b) ?? 99))[0];
  const sentences: string[] = [];

  if (done.length === 0) {
    return { sentences: ['Aucune mesure Google terminée pour cette page.'], priority: 'Lancez une mesure pour savoir où la page se situe.' };
  }

  // 1. Visibilité d'ensemble
  sentences.push(
    visible.length === 0
      ? `La page n’apparaît sur aucune des ${done.length} recherche(s) mesurée(s), dans les ${Math.max(...done.map((serp) => serp.depth ?? serp.results.length))} premiers résultats lus.`
      : `La page sort sur ${visible.length} recherche(s) sur ${done.length}, au mieux n°${rankOf(best!)} sur « ${best!.query} »${where(best!)}.`
  );

  // 2. Une autre page du site prend la place
  const replaced = done.find(
    (serp) => rankOf(serp) === null && serp.ownUrls.some((own) => keyOf(own.url) !== keyOf(input.pageUrl))
  );
  const replacing = replaced?.ownUrls.find((own) => keyOf(own.url) !== keyOf(input.pageUrl));
  if (replaced && replacing) {
    sentences.push(
      `Sur « ${replaced.query} »${where(replaced)}, Google fait sortir une autre page du site à sa place : ${pathOf(replacing.url)} (n°${replacing.position}).`
    );
  }

  // 3. Qui occupe le Top 10 de la recherche principale
  const main = input.main?.status === 'DONE' ? input.main : done[0];
  const top = topTenLandscape(main.results, input.ownDomain);
  const count = (kind: ResultKind) => top.filter((item) => item.kind === kind).length;
  if (top.length > 0) {
    const parts = [
      count('competitor') > 0 ? `${count('competitor')} concurrent(s) direct(s)` : '',
      count('directory') > 0 ? `${count('directory')} annuaire(s) ou plateforme(s)` : '',
      count('public') > 0 ? `${count('public')} site(s) public(s)` : '',
      count('own') > 0 ? `${count('own')} page(s) de votre site` : ''
    ].filter(Boolean);
    let reading = '';
    if (count('directory') + count('public') >= 5) {
      reading = ' : la recherche est dominée par des plateformes, viser une recherche plus précise (lieu, spécialité) est plus réaliste.';
    } else if (count('competitor') >= 7) {
      reading = ' : ce sont surtout des concurrents directs, la place se gagne par la qualité du contenu et la popularité du site.';
    }
    sentences.push(`Dans le Top 10 de « ${main.query} »${where(main)} : ${parts.join(', ')}${reading || '.'}`);
  }

  // 4. Longueur face aux concurrents lus
  const average = main.gaps.competitorAvgWords;
  if (average && input.pageWords > 0) {
    if (average > input.pageWords * 1.5) {
      sentences.push(
        `Les concurrents lus sont plus fournis : ${average.toLocaleString('fr-FR')} mots en moyenne, contre ${input.pageWords.toLocaleString('fr-FR')} pour la page.`
      );
    } else if (average < input.pageWords * 0.7) {
      sentences.push(
        `La page est déjà plus fournie que les concurrents lus (${input.pageWords.toLocaleString('fr-FR')} mots contre ${average.toLocaleString('fr-FR')} en moyenne) : la longueur n’est pas le frein.`
      );
    }
  }
  if (main.gaps.missingSections.length > 0) {
    sentences.push(`Plusieurs concurrents traitent des sections absentes de la page : ${main.gaps.missingSections.slice(0, 3).join(', ')}.`);
  }

  // 5. Une seule priorité
  const bestRank = best ? rankOf(best) : null;
  const priority =
    replaced && replacing
      ? `Décider quelle page doit se classer sur « ${replaced.query} » : celle-ci ou ${pathOf(replacing.url)}, puis faire pointer l’autre vers elle avec un lien explicite.`
      : bestRank === null
        ? 'Recentrer la page sur la recherche visée (Title, H1, introduction, un sous-titre), ou viser une recherche plus précise.'
        : bestRank > 10
          ? 'Renforcer le contenu de la page : elle est proche de la première page, c’est là qu’un effort rapporte le plus.'
          : bestRank > 3
            ? 'Rendre le résultat plus attirant (Title et méta description) et compléter les sections manquantes pour monter dans le Top 3.'
            : 'La page est bien placée : surveiller la position et garder le contenu à jour.';
  return { sentences, priority };
}

/** Faits mesurés, en texte, transmis à l'IA pour son avis (elle ne reçoit rien d'autre) */
export function serpFacts(input: { measures: SerpAnalysis[]; pageUrl: string; ownDomain: string; pageWords: number }): string {
  const lines: string[] = [`Page : ${input.pageUrl} (${input.pageWords} mots)`];
  for (const serp of input.measures.filter((item) => item.status === 'DONE')) {
    const rank = serp.pagePosition ?? serp.pageSitelinkOf;
    const top = topTenLandscape(serp.results, input.ownDomain);
    lines.push(
      [
        `Recherche « ${serp.sentQuery ?? serp.query} »${where(serp)} :`,
        rank !== null ? `page n°${rank}` : `page absente des ${serp.depth ?? serp.results.length} premiers résultats`,
        serp.ownPosition !== null ? `meilleure page du site n°${serp.ownPosition}` : 'site absent',
        `Top 10 : ${top.map((item) => `${item.position}. ${item.domain} (${item.kind})`).join(', ')}`,
        serp.features?.localPack ? `carte d'établissements affichée${serp.localPackRank ? `, site n°${serp.localPackRank}` : serp.localPackRank === null ? ', site absent' : ''}` : 'pas de carte',
        serp.gaps.competitorAvgWords ? `concurrents lus : ${serp.gaps.competitorAvgWords} mots en moyenne` : '',
        serp.gaps.missingSections.length > 0 ? `sections des concurrents absentes de la page : ${serp.gaps.missingSections.join(', ')}` : ''
      ]
        .filter(Boolean)
        .join(' ; ')
    );
  }
  return lines.join('\n');
}
