/**
 * Recherche des liens précis : règles pures (planification des recherches, pages candidates, emplacement et nature
 * du lien) et lecture d'une page de HTML écrit à la main. Lancé par `npm run test:scoring`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidatesFromResults,
  classifyAnchor,
  classifyLinkLocation,
  mentionsBrand,
  planBacklinkSearches,
  trimToBudget,
  windowAround
} from '@/core/domain/backlink-discovery';
import { brandVariants } from '@/core/domain/scoring/autocomplete-relevance';
import { parseBacklinkPage } from '@/adapters/secondary/backlinks/backlink-page-reader';

test('liens précis : le nom de marque (avec et sans espace) défilé par lots de 3 pages, entrelacés', () => {
  const plan = planBacklinkSearches('www.big-happy.fr');
  assert.deepEqual(
    plan.map((search) => [search.query, search.start, search.pages]),
    [
      ['"big happy" -site:big-happy.fr', 0, 3],
      ['"bighappy" -site:big-happy.fr', 0, 3],
      ['"big happy" -site:big-happy.fr', 3, 3],
      ['"bighappy" -site:big-happy.fr', 3, 3],
      ['"big happy" -site:big-happy.fr', 6, 3],
      ['"bighappy" -site:big-happy.fr', 6, 3]
    ]
  );
  // Jamais de recherche par nom de domaine : les liens portent la marque dans leur texte
  assert.ok(plan.every((search) => !search.query.includes('big-happy.fr"') && !search.query.startsWith('site:')));
  // Une marque d'un seul mot : une seule requête
  assert.equal(planBacklinkSearches('edenis.fr').length, 3);
});

test('liens précis : le budget garde les lots qui tiennent en entier, dans l’ordre', () => {
  const plan = planBacklinkSearches('big-happy.fr');
  assert.equal(trimToBudget(plan, 100).length, 6);
  assert.equal(trimToBudget(plan, 20).length, 6);
  assert.deepEqual(trimToBudget(plan, 7).map((search) => [search.start, search.query.startsWith('"big happy"')]), [
    [0, true],
    [0, false]
  ]);
  assert.equal(trimToBudget(plan, 2).length, 0);
});

test('liens précis : la marque nommée dans le texte, en mots entiers, ou le nom de domaine', () => {
  const brands = brandVariants('big-happy.fr');
  assert.equal(mentionsBrand('Merci à Big Happy pour le logo.', 'big-happy.fr', brands), true);
  assert.equal(mentionsBrand('Réalisé par BIGHAPPY, agence.', 'big-happy.fr', brands), true);
  assert.equal(mentionsBrand('Visitez big-happy.fr', 'big-happy.fr', brands), true);
  assert.equal(mentionsBrand('Une famille big happy family', 'big-happy.fr', brands), true);
  assert.equal(mentionsBrand('Un très bighappyland', 'big-happy.fr', brands), false);
  assert.equal(mentionsBrand('Rien à voir ici', 'big-happy.fr', brands), false);
});

test('liens précis : pages candidates sans le site audité, sans doublon, par domaine limité', () => {
  const result = (url: string) => ({ position: 1, title: url, url, snippet: '', domain: '' });
  const candidates = candidatesFromResults(
    [
      {
        foundBy: 'general-search',
        results: [
          result('https://www.big-happy.fr/a-propos/'),
          result('https://blog.big-happy.fr/'),
          result('https://partenaire.com/a'),
          result('https://www.partenaire.com/a/'),
          result('https://partenaire.com/b'),
          result('https://partenaire.com/c'),
          result('https://autre.org/page'),
          result('https://fr.linkedin.com/posts/agence-happy'),
          result('ftp://autre.org/fichier')
        ]
      }
    ],
    { target: 'big-happy.fr', referring: new Set(['partenaire.com']), maxPerDomain: 2 }
  );
  assert.deepEqual(candidates.map((item) => item.url), ['https://partenaire.com/a', 'https://partenaire.com/b', 'https://autre.org/page']);
  assert.deepEqual(candidates.map((item) => item.inCommonCrawl), [true, true, false]);
});

test('liens précis : emplacement d’après les balises parentes, la plus proche l’emporte', () => {
  assert.equal(classifyLinkLocation([{ tag: 'p' }, { tag: 'article' }, { tag: 'main' }]), 'content');
  assert.equal(classifyLinkLocation([{ tag: 'li' }, { tag: 'ul' }, { tag: 'footer' }]), 'footer');
  assert.equal(classifyLinkLocation([{ tag: 'li' }, { tag: 'nav' }]), 'nav');
  assert.equal(classifyLinkLocation([{ tag: 'div', className: 'widget-area' }, { tag: 'aside' }]), 'aside');
  assert.equal(classifyLinkLocation([{ tag: 'div', id: 'comments' }, { tag: 'article' }]), 'comment');
  assert.equal(classifyLinkLocation([{ tag: 'div', role: 'contentinfo' }]), 'footer');
  assert.equal(classifyLinkLocation([{ tag: 'p' }, { tag: 'div' }]), 'content');
  assert.equal(classifyLinkLocation([{ tag: 'div' }, { tag: 'body' }]), 'unknown');
  // Mesuré sur big-happy.fr : des blocs de contenu Elementor ou Bootstrap pris à tort pour une colonne latérale ou un menu
  assert.equal(
    classifyLinkLocation([{ tag: 'p' }, { tag: 'div', className: 'elementor-widget-container' }, { tag: 'div', className: 'elementor-element elementor-widget' }]),
    'content'
  );
  assert.equal(classifyLinkLocation([{ tag: 'p' }, { tag: 'div', className: 'tab-pane' }, { tag: 'ul', className: 'nav nav-tabs' }]), 'content');
  assert.equal(classifyLinkLocation([{ tag: 'h6' }, { tag: 'div', className: 'col-8' }]), 'content');
  assert.equal(classifyLinkLocation([{ tag: 'li' }, { tag: 'ul', className: 'main-navigation' }]), 'nav');
});

test('liens précis : nature de l’ancre (image, adresse, marque, formule générique, texte libre)', () => {
  const brands = brandVariants('big-happy.fr');
  assert.equal(classifyAnchor('', brands), 'image');
  assert.equal(classifyAnchor('https://big-happy.fr/', brands), 'url');
  assert.equal(classifyAnchor('www.big-happy.fr', brands), 'url');
  assert.equal(classifyAnchor('Big Happy', brands), 'brand');
  assert.equal(classifyAnchor('By BigHappy', brands), 'brand');
  assert.equal(classifyAnchor('Cliquez ici', brands), 'generic');
  assert.equal(classifyAnchor('agence de communication à Toulouse', brands), 'other');
});

test('liens précis : le paragraphe est recentré sur le lien quand il dépasse la limite', () => {
  const marker = '[[LIEN : Big Happy]]';
  const text = `${'a '.repeat(600)} ${marker} ${'b '.repeat(600)}`;
  const out = windowAround(text, marker, 200);
  assert.ok(out.includes(marker));
  assert.ok(out.length <= 210);
  assert.equal(windowAround('court texte', marker, 200), 'court texte');
});

test('liens précis : lecture d’une page (lien, rel, emplacement, ancre, contexte, mention sans lien)', () => {
  const html = `<html><head><title>Nos partenaires</title></head><body>
    <header><a href="https://big-happy.fr/menu">Menu</a></header>
    <main><article>
      <p>Pour le design, nous travaillons avec <a href="https://www.big-happy.fr/creation/" rel="nofollow sponsored">Big Happy</a>,
      une agence de Toulouse. Voir aussi <a href="https://exemple.org/x">exemple</a> et <a href="/interne">interne</a>.</p>
    </article></main>
    <footer><a href="https://big-happy.fr/">cliquez ici</a></footer></body></html>`;
  const page = parseBacklinkPage(html, 'https://partenaire.com/partenaires/', 'big-happy.fr', brandVariants('big-happy.fr'));
  assert.equal(page.title, 'Nos partenaires');
  assert.equal(page.links.length, 3);
  const [first, second, third] = page.links;
  assert.equal(first.location, 'header');
  assert.equal(second.location, 'content');
  assert.equal(second.anchorType, 'brand');
  assert.equal(second.nofollow, true);
  assert.equal(second.sponsored, true);
  assert.equal(second.ugc, false);
  assert.equal(second.targetUrl, 'https://www.big-happy.fr/creation/');
  assert.ok(second.context.includes('[[LIEN : Big Happy]]'));
  assert.ok(second.context.includes('nous travaillons avec'));
  assert.equal(second.externalLinksInContent, 1);
  assert.equal(third.location, 'footer');
  assert.equal(third.anchorType, 'generic');
  // La page nomme la marque (dans le texte du lien) : mention vraie, même quand elle a aussi des liens
  assert.equal(page.mentionsTarget, true);

  const mention = parseBacklinkPage('<body><p>Merci à big-happy.fr pour le logo.</p></body>', 'https://blog.fr/post', 'big-happy.fr', []);
  assert.equal(mention.links.length, 0);
  assert.equal(mention.mentionsTarget, true);

  // Marque seule, sans nom de domaine ni lien : une mention à confirmer
  const brandOnly = parseBacklinkPage('<body><p>Logo réalisé par Big Happy.</p></body>', 'https://blog.fr/post', 'big-happy.fr', brandVariants('big-happy.fr'));
  assert.equal(brandOnly.links.length, 0);
  assert.equal(brandOnly.mentionsTarget, true);
  const unrelated = parseBacklinkPage('<body><p>Un blog de cuisine.</p></body>', 'https://blog.fr/post', 'big-happy.fr', brandVariants('big-happy.fr'));
  assert.equal(unrelated.mentionsTarget, false);

  // Une page du site audité lui-même n'est pas une source de backlink
  const own = parseBacklinkPage('<body><a href="https://big-happy.fr/contact">Contact</a></body>', 'https://www.big-happy.fr/', 'big-happy.fr', []);
  assert.equal(own.links.length, 0);
});
