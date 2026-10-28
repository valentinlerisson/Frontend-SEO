#!/usr/bin/env node
/**
 * Résultats organiques Google en JSON, via un Chrome local visible et un profil persistant (patchright).
 *
 *   node scripts/serp/google-serp.mjs "requête" --pages 1 --profile ./.serp-profile --out results.json [--domain site.fr]
 *
 * --domain : pour les résultats de ce domaine, les liens annexes (sitelinks) sont aussi extraits.
 *
 * Sortie : JSON sur la sortie standard (ou dans --out) ; journaux sur la sortie d'erreur.
 * Codes de sortie : 0 succès ; 2 captcha ou blocage (résolution manuelle requise) ; 1 autre erreur.
 *
 * Usage limité : quelques requêtes espacées. Aucun contournement automatique de captcha : en cas de captcha,
 * il se résout à la main dans la fenêtre. Utiliser un profil dédié, jamais connecté à un compte personnel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'patchright';
import { parseGoogleResults, resolveRedirects, parseSerpFeatures } from './parse.mjs';

class GoogleBlockedError extends Error {}

function parseArgs(argv) {
  const args = { query: '', pages: 1, start: 0, profile: './.serp-profile', timeout: 180, out: '', debugDir: 'debug', domain: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pages') args.pages = Number(argv[++i]) || 1;
    else if (arg === '--start') args.start = Math.max(0, Number(argv[++i]) || 0);
    else if (arg === '--profile') args.profile = argv[++i];
    else if (arg === '--timeout') args.timeout = Number(argv[++i]) || 180;
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--debug-dir') args.debugDir = argv[++i];
    else if (arg === '--domain') args.domain = (argv[++i] ?? '').toLowerCase().replace(/^www\./, '');
    else rest.push(arg);
  }
  args.query = rest.join(' ').trim();
  return args;
}

const log = (...parts) => console.error('[google-serp]', ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForResults(page, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    for (const label of ['Tout accepter', 'Accept all']) {
      const button = page.getByRole('button', { name: label });
      if (await button.count()) {
        await button.first().click();
        await page.waitForLoadState();
      }
    }
    if (await page.locator('#search a h3').count()) return true;
    await sleep(2000); // captcha ou chargement : résolution manuelle possible dans la fenêtre
  }
  return false;
}

async function saveDebug(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shot = path.join(dir, `google-${stamp}.png`);
  try {
    await page.screenshot({ path: shot, fullPage: true });
    fs.writeFileSync(path.join(dir, `google-${stamp}.html`), await page.content());
    log(`capture de debug : ${shot}`);
  } catch (err) {
    log(`capture impossible : ${err.message}`);
  }
}

export async function searchGoogle({ query, pages, start = 0, profile, timeout, debugDir, domain }) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    locale: 'fr-FR',
    noViewport: true,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const results = [];
    let features = { localPack: false, peopleAlsoAsk: [] };

    // `start` : première page lue (0 = première page de Google) ; les positions tiennent compte des pages sautées
    for (let index = start; index < start + pages; index++) {
      if (index > start) await sleep(3000 + Math.random() * 5000); // pause de 3 à 8 s entre deux pages
      const url = `https://www.google.fr/search?hl=fr&gl=fr&pws=0&q=${encodeURIComponent(query)}&start=${10 * index}`;
      await page.goto(url);

      if (!(await waitForResults(page, timeout))) {
        await saveDebug(page, debugDir);
        throw new GoogleBlockedError('captcha ou blocage: résolution manuelle requise');
      }
      const html = await page.content();
      // Pack local et questions : relevés sur la première page seulement
      if (index === 0) features = parseSerpFeatures(html);
      const parsed = parseGoogleResults(html, 10 * start + results.length + 1, { ownDomain: domain });
      if (parsed.length === 0) {
        // Des titres sont présents à l'écran mais le parseur n'en extrait aucun : sélecteurs à ajuster
        await saveDebug(page, debugDir);
        throw new Error('résultats détectés à l’écran mais non extraits (voir debug/)');
      }
      await resolveRedirects(context, parsed);
      results.push(...parsed);
    }
    return { results, features };
  } finally {
    await context.close();
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('google-serp.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    log('requête manquante');
    process.exit(1);
  }

  searchGoogle(args)
    .then(({ results, features }) => {
      const payload = JSON.stringify({ query: args.query, fetchedAt: new Date().toISOString(), results, features }, null, 1);
      if (args.out) fs.writeFileSync(args.out, payload);
      else process.stdout.write(payload);
      process.exit(0);
    })
    .catch((err) => {
      log(err.message);
      process.exit(err instanceof GoogleBlockedError ? 2 : 1);
    });
}
