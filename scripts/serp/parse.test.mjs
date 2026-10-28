import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHref, domainOf, parseCite, parseGoogleResults, resolveGoogleHref, parseSerpFeatures } from './parse.mjs';

// HTML simulé d'une page de résultats (structure simplifiée)
const HTML = `
<html><body><div id="search">
  <div class="g"><div>
    <a href="/url?q=https%3A%2F%2Fwww.exemple.fr%2Fresidences&sa=U"><h3>Résidences seniors | Exemple</h3></a>
    <div class="VwiC3b">Découvrez nos résidences seniors à Toulouse.</div>
  </div></div>
  <div class="g"><div>
    <a href="https://blog.autre.com/guide?x=1"><h3>Guide complet</h3></a>
    <div data-sncf="1">Le guide pour choisir.</div>
  </div></div>
  <div class="g"><div>
    <a href="/goto?url=https%3A%2F%2Fcomparateur.fr%2Fmeilleurs"><h3>Les meilleurs</h3></a>
  </div></div>
  <div class="g"><div>
    <a href="https://www.google.fr/search?q=autre"><h3>Recherche interne Google</h3></a>
  </div></div>
  <div class="g"><div>
    <a href="https://www.exemple.fr/residences"><h3>Doublon</h3></a>
  </div></div>
</div></body></html>`;

test('résout les redirections Google vers le domaine final', () => {
  assert.equal(resolveGoogleHref('/url?q=https%3A%2F%2Fa.fr%2Fp&sa=U'), 'https://a.fr/p');
  assert.equal(resolveGoogleHref('/goto?url=https%3A%2F%2Fb.fr%2F'), 'https://b.fr/');
  assert.equal(resolveGoogleHref('https://c.fr/x'), 'https://c.fr/x');
});

test('ignore les liens internes à Google et les liens illisibles', () => {
  assert.equal(resolveGoogleHref('https://www.google.fr/search?q=x'), null);
  assert.equal(resolveGoogleHref('/search?q=x'), null);
  assert.equal(resolveGoogleHref(''), null);
  assert.equal(resolveGoogleHref('javascript:void(0)'), null);
});

test('domainOf retire www et met en minuscules', () => {
  assert.equal(domainOf('https://WWW.Exemple.fr/a'), 'exemple.fr');
  assert.equal(domainOf('pas une url'), '');
});

test('extrait position, titre, url, extrait et domaine', () => {
  const results = parseGoogleResults(HTML);
  assert.deepEqual(
    results.map((r) => [r.position, r.domain, r.url]),
    [
      [1, 'exemple.fr', 'https://www.exemple.fr/residences'],
      [2, 'blog.autre.com', 'https://blog.autre.com/guide?x=1'],
      [3, 'comparateur.fr', 'https://comparateur.fr/meilleurs'],
    ]
  );
  assert.equal(results[0].title, 'Résidences seniors | Exemple');
  assert.equal(results[0].snippet, 'Découvrez nos résidences seniors à Toulouse.');
  assert.equal(results[1].snippet, 'Le guide pour choisir.');
  assert.equal(results[2].snippet, '');
});

test('numérote à partir de la position de départ (pagination)', () => {
  const results = parseGoogleResults(HTML, 11);
  assert.equal(results[0].position, 11);
  assert.equal(results[2].position, 13);
});

test('renvoie une liste vide quand la page n’a pas de résultats', () => {
  assert.deepEqual(parseGoogleResults('<html><body>captcha</body></html>'), []);
});

// Structure actuelle : lien à jeton opaque (/goto?url=CAES…), adresse affichée dans <cite>, liens annexes dans un tableau
const OPAQUE_HTML = `
<html><body><div id="search">
  <div class="g"><div>
    <a href="/goto?url=CAESUAHrOzAVA9Mz8Ljx1tmgX-b-kLSVyWhGZg3zCaQ"><h3 class="LC20lb">Big Happy | Agence Data Driven</h3><br>
      <div class="notranslate"><cite role="text">https://big-happy.fr</cite></div></a>
    <div class="VwiC3b">Agence de communication data-driven à Toulouse.</div>
    <table role="group"><tbody>
      <tr><td><h3 class="D33W6b" role="heading"><a class="l" href="/goto?url=CAESWQHrOzAV5w_SPUTe6o">À Propos</a></h3><div class="zz3gNc">À propos. Les marques…</div></td></tr>
      <tr><td><h3 class="D33W6b" role="heading"><a class="l" href="/goto?url=CAESWAHrOzAVciHY05qU">Data &amp; IA</a></h3></td></tr>
    </tbody></table>
  </div></div>
  <div class="g"><div>
    <a href="/goto?url=CAESZAHrOzAVtYKzNIUjUITQ"><h3 class="LC20lb">BigHappy (@agencebighappy)</h3><br>
      <div class="notranslate"><cite role="text">Plus de 1,4&nbsp;k&nbsp;abonnés</cite></div></a>
  </div></div>
</div></body></html>`;

test('un jeton opaque est une redirection à suivre, pas une URL', () => {
  assert.deepEqual(classifyHref('/goto?url=CAESUAHrOzAV'), { redirect: 'https://www.google.fr/goto?url=CAESUAHrOzAV' });
  assert.equal(resolveGoogleHref('/goto?url=CAESUAHrOzAV'), null);
  assert.deepEqual(classifyHref('https://a.fr/x'), { url: 'https://a.fr/x' });
});

test('reconstitue une adresse depuis la ligne affichée sous le titre', () => {
  assert.deepEqual(parseCite('https://big-happy.fr'), { url: 'https://big-happy.fr', approximate: false });
  assert.deepEqual(parseCite('https://www.pagesjaunes.fr › pros › …'), { url: 'https://www.pagesjaunes.fr/pros', approximate: true });
  assert.equal(parseCite('Plus de 1,4 k abonnés'), null);
});

test('garde les résultats à jeton opaque, avec l’adresse affichée en repli', () => {
  const results = parseGoogleResults(OPAQUE_HTML);
  assert.equal(results.length, 2);
  assert.equal(results[0].url, '');
  assert.equal(results[0].domain, 'big-happy.fr');
  assert.equal(results[0].displayUrl, 'https://big-happy.fr');
  assert.ok(results[0].redirect.includes('/goto?url=CAES'));
  assert.equal(results[0].snippet, 'Agence de communication data-driven à Toulouse.');
  assert.equal(results[1].domain, '');
});

test('extrait les liens annexes seulement pour le domaine audité', () => {
  const own = parseGoogleResults(OPAQUE_HTML, 1, { ownDomain: 'big-happy.fr' });
  assert.deepEqual(own[0].sitelinks.map((s) => s.title), ['À Propos', 'Data & IA']);
  assert.ok(own[0].sitelinks[0].redirect.includes('/goto?url=CAES'));
  assert.equal(own[1].sitelinks, undefined);

  const other = parseGoogleResults(OPAQUE_HTML, 1, { ownDomain: 'autre.fr' });
  assert.equal(other[0].sitelinks, undefined);
});

test('parseSerpFeatures : pack local et questions « Autres questions posées »', () => {
  const html = `<div id="search">
    <div data-cid="123">Résidence A</div>
    <div data-q="Quel est le prix d'une résidence seniors ?"></div>
    <div data-q="Comment choisir une résidence seniors ?"></div>
  </div>`;
  const features = parseSerpFeatures(html);
  assert.equal(features.localPack, true);
  assert.deepEqual(features.peopleAlsoAsk, ["Quel est le prix d'une résidence seniors ?", 'Comment choisir une résidence seniors ?']);
  assert.deepEqual(parseSerpFeatures('<div id="search"><a href="https://ex.fr"><h3>Titre</h3></a></div>'), {
    localPack: false,
    peopleAlsoAsk: [],
  });
});

test('parseSerpFeatures : la requête elle-même (data-q hors du bloc de questions) n’est pas une question', () => {
  const html = `<div id="search">
    <div data-q="résidence seniors Lyon"></div>
    <div data-q="Comment choisir une résidence seniors ?"></div>
  </div>`;
  assert.deepEqual(parseSerpFeatures(html, 'résidence seniors Lyon').peopleAlsoAsk, ['Comment choisir une résidence seniors ?']);
});
