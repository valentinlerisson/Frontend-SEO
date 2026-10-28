/**
 * Génération déterministe d'un balisage Schema.org (JSON-LD) adapté à la page, pour porter les signaux
 * E-E-A-T (auteur, dates, éditeur, identité). Aucune information inventée : ce que la page ne fournit pas
 * est remplacé par un champ « [À COMPLÉTER : …] » que l'utilisateur doit renseigner avant publication.
 */

export type EeatSchemaType = 'Article' | 'Organization' | 'LocalBusiness' | 'WebPage';

export interface EeatSchemaInput {
  url: string;
  path: string;
  depth: number;
  canonicalUrl?: string;
  title?: string;
  h1?: string;
  metaDescription?: string;
  hasPublicationDate: boolean;
  /** Date de dernière mise à jour déclarée par la page (ISO 8601) */
  lastUpdated?: string;
  wordCount: number;
  /** Types Schema.org déjà présents dans la page */
  existingSchemaTypes: string[];
  isLocalBusiness?: boolean;
  city?: string | null;
}

export interface EeatSchemaSuggestion {
  type: EeatSchemaType;
  /** Objet JSON-LD formaté (sans balise <script>) */
  json: string;
  /** Champs [À COMPLÉTER] restant à renseigner */
  placeholders: string[];
  /** Un balisage de ce type existe déjà dans la page : le compléter plutôt que l'ajouter en double */
  alreadyPresent: boolean;
}

const PLACEHOLDER_PREFIX = '[À COMPLÉTER';
const ARTICLE_PATH = /(blog|article|actualit|news|conseil|guide|ressource|etude|observatoire)/i;

function placeholder(label: string): string {
  return `${PLACEHOLDER_PREFIX} : ${label}]`;
}

function detectType(input: EeatSchemaInput): EeatSchemaType {
  if (input.depth === 0 || input.path === '/') return input.isLocalBusiness ? 'LocalBusiness' : 'Organization';
  if (ARTICLE_PATH.test(input.path) || (input.hasPublicationDate && input.wordCount >= 300)) return 'Article';
  return 'WebPage';
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function collectPlaceholders(value: unknown, found: string[]): void {
  if (typeof value === 'string') {
    if (value.startsWith(PLACEHOLDER_PREFIX)) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectPlaceholders(item, found));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectPlaceholders(item, found));
  }
}

export function buildEeatSchema(input: EeatSchemaInput): EeatSchemaSuggestion {
  const type = detectType(input);
  const pageUrl = input.canonicalUrl || input.url;
  const origin = originOf(input.url);
  const name = (input.h1 || input.title || '').trim().slice(0, 110);
  const description = input.metaDescription?.trim();

  const publisher = {
    '@type': 'Organization',
    name: placeholder('nom de l’entreprise'),
    url: origin,
    logo: { '@type': 'ImageObject', url: placeholder('URL du logo') }
  };

  let schema: Record<string, unknown>;

  if (type === 'Organization' || type === 'LocalBusiness') {
    schema = {
      '@context': 'https://schema.org',
      '@type': type,
      name: placeholder('nom de l’entreprise'),
      url: origin,
      logo: placeholder('URL du logo'),
      ...(description ? { description } : {}),
      sameAs: [placeholder('URL du profil LinkedIn ou autre profil officiel')],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        telephone: placeholder('téléphone'),
        email: placeholder('e-mail de contact')
      },
      ...(type === 'LocalBusiness'
        ? {
            address: {
              '@type': 'PostalAddress',
              streetAddress: placeholder('rue et numéro'),
              postalCode: placeholder('code postal'),
              addressLocality: input.city || placeholder('ville'),
              addressCountry: 'FR'
            }
          }
        : {})
    };
  } else if (type === 'Article') {
    schema = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: name,
      ...(description ? { description } : {}),
      mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
      datePublished: placeholder('date de publication, format 2026-01-31T09:00:00+01:00'),
      dateModified: input.lastUpdated || placeholder('date de dernière mise à jour, format ISO 8601'),
      author: {
        '@type': 'Person',
        name: placeholder('nom de l’auteur'),
        jobTitle: placeholder('fonction ou qualification'),
        url: placeholder('page biographique de l’auteur'),
        sameAs: [placeholder('profil LinkedIn de l’auteur')]
      },
      publisher
    };
  } else {
    schema = {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name,
      url: pageUrl,
      ...(description ? { description } : {}),
      dateModified: input.lastUpdated || placeholder('date de dernière mise à jour, format ISO 8601'),
      author: {
        '@type': 'Person',
        name: placeholder('nom de l’auteur'),
        jobTitle: placeholder('fonction ou qualification'),
        url: placeholder('page biographique de l’auteur')
      },
      publisher
    };
  }

  const placeholders: string[] = [];
  collectPlaceholders(schema, placeholders);

  return {
    type,
    json: JSON.stringify(schema, null, 2),
    placeholders,
    alreadyPresent: input.existingSchemaTypes.some((existing) => existing.toLowerCase() === type.toLowerCase())
  };
}
