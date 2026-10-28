import * as cheerio from 'cheerio';
import type { NapSignals } from '@/core/domain/types';

const STREET_WORD = /(rue|avenue|av\.|boulevard|bd|chemin|route|place|impasse|all[ée]e|quai|cours|passage|square|si[èe]ge|adresse|zone d)/i;
const POSTAL_CITY = /\b(\d{5})\s+([A-ZÉÈÀÂÊÎÔÛÇ][\p{L}'’-]+(?:[\s-][A-ZÉÈÀÂÊÎÔÛÇ][\p{L}'’-]+){0,2})/gu;
const FR_PHONE = /(?:\+33\s?|0033\s?|\b0)[1-9](?:[\s.\-]?\d{2}){4}\b/g;

/** Numéro français ramené à 10 chiffres commençant par 0 ; null si le format n'est pas reconnu */
function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+33')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0033')) digits = `0${digits.slice(4)}`;
  return /^0[1-9]\d{8}$/.test(digits) ? digits : null;
}

function collectSchemaNap(node: unknown, found: NonNullable<NapSignals['schema']>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectSchemaNap(item, found));
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.telephone === 'string' && !found.phone) found.phone = normalizePhone(record.telephone) ?? undefined;
  if (typeof record.name === 'string' && !found.name && record['@type']) found.name = record.name;
  const address = record.address;
  if (address && typeof address === 'object' && !Array.isArray(address)) {
    const a = address as Record<string, unknown>;
    if (typeof a.postalCode === 'string' && !found.postalCode) found.postalCode = a.postalCode.trim();
    if (typeof a.addressLocality === 'string' && !found.city) found.city = a.addressLocality.trim();
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectSchemaNap(value, found);
  }
}

/**
 * Coordonnées (téléphone, adresse) lues sur TOUTE la page, pied de page compris, ainsi que dans le JSON-LD.
 * À appeler avant le retrait de nav, header, footer et script du DOM.
 */
export function extractNap($: cheerio.CheerioAPI): NapSignals {
  const phones = new Set<string>();
  $('a[href^="tel:" i]').each((_, el) => {
    const phone = normalizePhone(($(el).attr('href') ?? '').replace(/^tel:/i, ''));
    if (phone) phones.add(phone);
  });

  const text = $('body').text().replace(/\s+/g, ' ');
  for (const match of text.matchAll(FR_PHONE)) {
    const phone = normalizePhone(match[0]);
    if (phone) phones.add(phone);
  }

  // Adresse : un code postal suivi d'une ville, précédé d'un indice de voie ou d'adresse
  const addresses: NapSignals['addresses'] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(POSTAL_CITY)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 70), index);
    if (!STREET_WORD.test(before)) continue;
    const city = match[2].trim();
    const id = `${match[1]}|${city.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    addresses.push({ postalCode: match[1], city, text: `${before.trim().split(/[.;|]/).pop()?.trim() ?? ''} ${match[1]} ${city}`.trim() });
    if (addresses.length >= 5) break;
  }

  const schema: NonNullable<NapSignals['schema']> = {};
  $('script[type="application/ld+json" i]').each((_, el) => {
    try {
      collectSchemaNap(JSON.parse($(el).html() || '{}'), schema);
    } catch {
      // JSON-LD malformé : ignoré
    }
  });

  return {
    phones: Array.from(phones).slice(0, 8),
    addresses,
    schema: schema.phone || schema.postalCode || schema.city || schema.name ? schema : undefined
  };
}
