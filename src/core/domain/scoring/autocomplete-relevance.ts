/**
 * Choix des requêtes envoyées à Google Autocomplete et tri des suggestions reçues.
 * Une graine trop courte (« stratégie »), générique (« à propos ») ou réduite à la marque (« big happy »)
 * fait remonter des recherches sans rapport avec la page : elle est écartée, et seules les suggestions qui
 * reprennent les mots de la graine sont gardées.
 */

const STOPWORDS = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'de', 'du', 'd', 'et', 'ou', 'en', 'a', 'au', 'aux', 'pour', 'par',
  'sur', 'avec', 'dans', 'sans', 'vos', 'nos', 'votre', 'notre', 'vous', 'nous', 'son', 'sa', 'ses', 'leur',
  'leurs', 'ce', 'cet', 'cette', 'ces', 'qui', 'que', 'quoi', 'est', 'sont', 'plus', 'tout', 'tous', 'the', 'and',
  'of', 'for', 'comment', 'pourquoi', 'quel', 'quelle', 'quels', 'quelles'
]);

/** Libellés de rubriques sans sujet propre : jamais envoyés seuls à Google */
const GENERIC_SEEDS = new Set([
  'a propos', 'accueil', 'home', 'contact', 'contactez nous', 'nous contacter', 'actualites', 'actualite', 'blog',
  'news', 'mentions legales', 'plan du site', 'nos services', 'services', 'qui sommes nous', 'notre agence',
  'nos clients', 'clients', 'references', 'realisations', 'equipe', 'notre equipe', 'bienvenue', 'page'
]);

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Mots porteurs de sens (3 lettres ou plus, hors mots outils), sans accents */
export function contentTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/**
 * Variantes de la marque tirées du domaine : « big-happy.fr » donne « big happy » et « bighappy ». Le nom est le label
 * placé avant l'extension : « fr.yamaha.com » donne « yamaha », pas « fr ».
 */
export function brandVariants(domain: string): string[] {
  const parts = domain.replace(/^www\./, '').toLowerCase().split('.');
  const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  const spaced = normalizeText(label);
  return Array.from(new Set([spaced, spaced.replace(/ /g, '')])).filter((variant) => variant.length >= 3);
}

/** Retire la marque (avec ou sans espace, tiret ou accent) d'un libellé ; les accents des autres mots sont gardés */
export function stripBrand(value: string, brands: string[]): string {
  const words = value.toLowerCase().split(/[\s|–—:,.!?«»"()/-]+/).filter(Boolean);
  const keys = words.map(normalizeText);
  const brandTokens = brands.map((brand) => brand.split(' '));
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const match = brandTokens.find((tokens) => tokens.every((token, offset) => keys[i + offset] === token));
    if (match) {
      i += match.length - 1;
      continue;
    }
    kept.push(words[i]);
  }
  return kept.join(' ').trim();
}

/** Graine exploitable : au moins deux mots porteurs de sens, et pas un simple nom de rubrique */
export function isUsableSeed(seed: string): boolean {
  const normalized = normalizeText(seed);
  return !GENERIC_SEEDS.has(normalized) && contentTokens(normalized).length >= 2;
}

/**
 * Deux requêtes quasi identiques : mêmes mots porteurs de sens (pluriels confondus), à un mot ajouté près
 * (ex. « agence communication toulouse » et « agence de communication toulouse 31 »).
 */
export function isSameQuery(query: string, candidate: string): boolean {
  const stem = (token: string) => token.replace(/s$/, '');
  const target = contentTokens(query).map(stem);
  const tokens = contentTokens(candidate).map(stem);
  if (target.length === 0) return false;
  const all = target.every((token) => tokens.includes(token));
  const extra = tokens.filter((token) => !target.includes(token)).length;
  return all && extra <= 1;
}

/** Recherches d'emploi ou de dictionnaire : hors sujet pour une page, sauf si la graine les contient */
const NOISE_TOKENS = new Set([
  'recrute', 'recrutement', 'stage', 'stagiaire', 'alternance', 'emploi', 'job', 'jobs', 'salaire', 'cdi', 'cdd',
  'synonyme', 'traduction', 'anglais', 'lettres', 'croises', 'def'
]);

/**
 * Suggestions qui reprennent les mots de la graine : tous jusqu'à trois mots,
 * au moins 75 % au-delà (Google peut reformuler une partie de la requête).
 */
export function filterRelevantSuggestions(seed: string, suggestions: string[]): string[] {
  const seedTokens = contentTokens(seed);
  if (seedTokens.length === 0) return [];
  const needed = seedTokens.length <= 3 ? seedTokens.length : Math.ceil(seedTokens.length * 0.75);
  return suggestions.filter((suggestion) => {
    const tokens = new Set(contentTokens(suggestion));
    if ([...tokens].some((token) => NOISE_TOKENS.has(token) && !seedTokens.includes(token))) return false;
    // Un mot de la graine compte s'il est présent tel quel ou au pluriel / singulier
    const matched = seedTokens.filter(
      (token) => tokens.has(token) || tokens.has(`${token}s`) || (token.endsWith('s') && tokens.has(token.slice(0, -1)))
    ).length;
    return matched >= needed;
  });
}

/**
 * Graines à essayer pour une requête qui n'obtient pas de suggestion : la requête, puis sans les lieux (ville ou zone
 * ciblée), puis ses 3 puis 2 premiers mots porteurs de sens (« accompagnement des familles ehpad » donne
 * « accompagnement familles ehpad », puis « accompagnement familles »). Les accents des mots gardés sont conservés.
 */
export function suggestionSeeds(query: string, places: string[] = []): string[] {
  const placeTokens = new Set(places.flatMap((place) => normalizeText(place).split(' ')).filter(Boolean));
  const words = query.trim().split(/\s+/).filter(Boolean);
  const withoutPlaces = words.filter((word) => !placeTokens.has(normalizeText(word)));
  const meaningful = withoutPlaces.filter((word) => contentTokens(word).length > 0);
  const seeds = [words.join(' '), withoutPlaces.join(' '), meaningful.slice(0, 3).join(' '), meaningful.slice(0, 2).join(' ')];
  const unique: string[] = [];
  for (const seed of seeds) {
    if (seed && isUsableSeed(seed) && !unique.some((item) => normalizeText(item) === normalizeText(seed))) unique.push(seed);
  }
  return unique;
}

/** Mots de liaison laissés en fin de recherche après le retrait d'un lieu (« agence web à ») */
const TRAILING_LINK = /^(a|à|en|sur|dans|de|du|des|pres|près|autour|vers)$/i;

/**
 * Recherche sans lieu : retire les noms donnés (zones ciblées, ville de la page, y compris composés comme
 * « Eure-et-Loir »), les codes postaux et les numéros de département entre parenthèses (« (60) »).
 * « agence web chartres » donne « agence web ». Les recherches proposées sont mesurées sans lieu ; la zone choisie
 * est ajoutée au moment de la mesure.
 */
export function stripPlaces(query: string, places: string[]): string {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const sequences = places
    .map((place) => normalizeText(place).split(' ').filter(Boolean))
    .filter((sequence) => sequence.length > 0)
    .sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (let i = 0; i < words.length; ) {
    const word = normalizeText(words[i]);
    // Lieu écrit d'un seul tenant (« eure-et-loir ») ou mot à mot (« eure et loir »)
    const whole = sequences.find((sequence) => sequence.join(' ') === word);
    const spread = whole ? undefined : sequences.find((sequence) => sequence.every((token, k) => normalizeText(words[i + k] ?? '') === token));
    if (whole) i += 1;
    else if (spread) i += spread.length;
    else if (/^\d{5}$|^\(\d{2,3}\)$/.test(words[i])) i += 1;
    else kept.push(words[i++]);
  }
  while (kept.length > 0 && TRAILING_LINK.test(kept[kept.length - 1])) kept.pop();
  return kept.join(' ');
}

