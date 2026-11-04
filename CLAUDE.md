# Auditly (BigApp SEO) — guide pour Claude

Application d'audit SEO et GEO en français : elle explore un site, note chaque page sur 100 (technique 40 %,
éditorial 35 %, GEO 25 %), mesure les positions Google et propose des corrections. L'utilisateur écrit en français ;
réponds en français.

## Lire d'abord

| Besoin | Document |
| :--- | :--- |
| Ce que fait chaque écran, parcours utilisateur | `docs/fonctionnalites_par_page.md` |
| Chaque métrique : utilité, calcul, points (référence fonctionnelle) | `docs/tableau-metriques.md` |
| Détails techniques : fichiers, fonctions, règles, cas limites (référence technique) | `docs/Fichier.md` |
| Version lisible pour un humain, avec schémas (parcours, sources de données) | `docs/metriques-seo.html` |
| Graphe du code (dépendances, centres) | `graphify-out/GRAPH_REPORT.md` (`python -m graphify update .` pour le rafraîchir) |

`docs/architecture-plan.md` et `docs/structure_et_logique_frontend.md` datent du 23-26/10/2026 et sont en partie
obsolètes (voir leur avertissement) ; `docs/metriques-seo-edenis.html` n'est plus mis à jour.

## Stack et commandes

- Next.js 16 App Router (Turbopack), React, Tailwind v4, Prisma + SQLite (`prisma/dev.db`), Windows 11.
- `npm run dev` (http://localhost:3000), `npx tsc --noEmit`, `npm run test:scoring` (tests du domaine,
  `tests/scoring.test.ts`), `npm run test:serp` (analyse des pages Google, `scripts/serp/parse.test.mjs`).
- Après un changement de `prisma/schema.prisma` : arrêter le serveur, supprimer `.next`, `npx prisma generate`,
  `npm run dev`.
- Scripts ponctuels : fichier `scripts/.nom.mts` (extension `.mts` pour l'`await` de premier niveau), lancé par
  `npx --yes tsx --env-file=.env --tsconfig tsconfig.json scripts/.nom.mts`, puis supprimé. Navigateur de test :
  `patchright`, `chromium.launch({ headless: true, channel: 'chrome' })`.

## Architecture (hexagonale)

- `src/core/domain/` : règles pures, sans I/O. `scoring/` (moteurs `TechScoringEngine`, `EditorialScoringEngine`,
  `GeoScoringEngine`, `GlobalScoringEngine`), `keyword-research.ts` (mots-clés, volumes, présence),
  `scoring/query-set.ts` (requêtes notées et poids), `page-rewrite.ts` (réécriture), `types.ts`.
- `src/core/ports/` : interfaces (SERP, volumes de mots-clés, backlinks).
- `src/core/services/audit-service.ts` : orchestration (lancement, exploration, analyse IA, mesure Google, reprise
  après interruption) ; `job-registry.ts` (travaux en cours).
- `src/adapters/secondary/` : crawler maison (fetch + Cheerio, pas Crawlee), `llm/` (passerelle OpenAI-compatible
  OmniRoute, Gemini en secours), `search-data/` (Google Autocomplete, Google Ads Keyword Planner, volumes simulés),
  `serp/` (Chrome local via Patchright ou API Serper), `speed/` (PageSpeed Insights), `backlinks/` (Common Crawl),
  `geo/` (geo.api.gouv.fr).
- `src/adapters/primary/presenters/` : transformation des données pour l'interface (`audit-presenter.ts`,
  `editorial-sections.ts`, `synthesis-advice.ts`).
- `app/api/` : routes ; `components/audit/` : écrans et tiroir ; `lib/audit-data.ts` : types de l'interface.

## Pipeline éditorial actuel (prompt `v11-2026-10-30`)

L'IA lit la page → problématique + 8 à 12 mots-clés de départ (sans marque ni lieu, vérifiés dans la page) →
Keyword Planner (volumes, idées voisines ; versions courtes ajoutées) → tri par l'IA (`judgeKeywords` : visé, plus
large, hors sujet, preuve citée vérifiée) → **requêtes notées** (4 au plus en automatique, 6 à la main, poids =
part du volume plafonnée à 50 %) → analyse IA (grilles à cases, intention jugée par requête) → notes calculées par
le code. Sans volume : les 3 premiers mots-clés de l'IA à poids égal. Plus de requête visée saisie par l'utilisateur.

## Variables d'environnement (`.env`, ignoré par git)

**Ne jamais afficher ni lire les valeurs** : lister seulement les noms (`sed 's/=.*/=***/' .env`), modifier avec
sed ou un script sans afficher la valeur. Noms : `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`,
`LLM_RESPONSE_FORMAT`, `LLM_JUDGE_MODEL`, `PAGESPEED_API_KEY`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`,
`GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_API_VERSION`,
`KEYWORD_VOLUME_PROVIDER` (`google-ads`, `mock` ou `none`).

## Règles de travail (demandées par l'utilisateur)

- Chaque tâche se termine par `npx tsc --noEmit` à 0 erreur ; lancer les tests concernés.
- Après tout changement de notation ou de fonctionnalité : mettre à jour `docs/tableau-metriques.md`,
  `docs/Fichier.md` et `docs/metriques-seo.html` (et `docs/fonctionnalites_par_page.md` si l'interface change).
- Ne rien inventer : donnée inconnue = `[À COMPLÉTER : …]`. L'IA propose, le code vérifie (extraits cités retrouvés
  mot pour mot).
- Pas de fausse alerte : information et estimation de l'IA en bleu ; rouge et orange réservés aux problèmes mesurés.
- Lire Google (SERP) automatiquement est contraire à ses conditions (l'utilisateur le sait) ; pas de résolveur de
  captcha ; pas de service SERP payant pour l'instant.
- Commit ou push seulement sur demande. Exclure `tsconfig.tsbuildinfo` et `next-env.d.ts`. `.data/`, `.env` et
  `graphify-out/` sont ignorés. Commits signés `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pronoms neutres (they/them) pour l'utilisateur.

## État au 04/11/2026

- Dernier commit poussé : `8b5fdb3`. **Tout le travail depuis (requêtes notées, Keyword Planner, réécriture,
  reprise après interruption, refonte des documents…) n'est pas commité.**
- Keyword Planner actif (accès de base Google Ads, compte `906-388-8133`).
- Modèle IA : `claude/claude-sonnet-4-5` via OmniRoute pour toutes les analyses et le tri des mots-clés. L'accès
  Antigravity (`agy/gpt-oss-120b-medium`) a été refusé par Google (401). L'accès Claude d'OmniRoute repose sur un
  compte connecté : une nouvelle connexion (`/login`) peut le révoquer (`OAuth access token has been revoked`).
- Le modèle entre dans la clé de cache des analyses : la plupart des pages n'ont pas encore été ré-analysées avec
  Claude et le prompt v11 (intention « À juger » sur certaines requêtes).
- Limite connue : la case « Outrepasser robots.txt » de la fenêtre « Nouvel audit » n'est reliée à rien.
- Pages de référence de l'utilisateur pour juger la notation : ma-ko-to.fr `/`, big-happy.fr `/` et `/a-propos/`.
