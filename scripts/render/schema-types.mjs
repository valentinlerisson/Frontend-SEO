#!/usr/bin/env node
/**
 * Types Schema.org d'une page après exécution de son JavaScript (Chrome sans fenêtre, patchright).
 * Sert à voir un JSON-LD injecté par un script (gestionnaire de balises, framework), invisible dans le HTML initial.
 *
 *   node scripts/render/schema-types.mjs https://site.fr/page
 *
 * Sortie : JSON {"url": "...", "types": ["Organization", ...]} sur la sortie standard ; journaux sur la sortie d'erreur.
 * Code de sortie : 0 succès ; 1 erreur. On ne rend que les pages du site audité, jamais Google.
 */
import { chromium } from 'patchright';

const url = process.argv[2];
const log = (...parts) => console.error('[schema-types]', ...parts);

if (!url) {
  log('URL manquante');
  process.exit(1);
}

/** Types déclarés dans la page rendue : JSON-LD (racine, tableaux, @graph) et microdonnées / RDFa */
function collectTypes() {
  const types = new Set();
  const add = (value) => {
    for (const type of Array.isArray(value) ? value : [value]) {
      if (typeof type === 'string' && type.trim()) types.add(type.trim().replace(/^https?:\/\/schema\.org\//, ''));
    }
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node['@type']) add(node['@type']);
    if (node['@graph']) walk(node['@graph']);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      walk(JSON.parse(script.textContent ?? ''));
    } catch {
      // JSON-LD illisible : ignoré
    }
  });
  document.querySelectorAll('[itemtype]').forEach((el) => add((el.getAttribute('itemtype') ?? '').split(/\s+/)));
  document.querySelectorAll('[typeof]').forEach((el) => add((el.getAttribute('typeof') ?? '').split(/\s+/)));
  return Array.from(types);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ locale: 'fr-FR' });
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  // Laisse aux scripts différés (gestionnaire de balises) le temps d'injecter leur balisage
  await page.waitForTimeout(2500);
  const types = await page.evaluate(collectTypes);
  process.stdout.write(JSON.stringify({ url, types }));
  await browser.close();
  process.exit(0);
} catch (err) {
  log(err.message);
  await browser.close();
  process.exit(1);
}
