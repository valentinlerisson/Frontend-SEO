# Guide des fonctionnalités par page — Auditly (BigApp SEO)

Mis à jour le 04/11/2026, d'après le code. Ce guide décrit ce que l'utilisateur voit et peut faire sur chaque écran.
Le détail des calculs (barèmes, règles, cas limites) est dans `docs/tableau-metriques.md` (fonctionnel) et
`docs/Fichier.md` (technique). Les routes en anglais (`/dashboard`, `/projects/...`) redirigent vers les routes
françaises ci-dessous.

---

## 0. Parcours en bref

1. **Lancer un audit** (tableau de bord) : domaine + périmètre.
2. **Exploration automatique** : technique de chaque page, robots.txt, sitemap, PageSpeed, backlinks (Common Crawl).
3. **Choisir les pages piliers** (Sous-pages) : 1 à 20 pages (réglable), rôle et objectif de chacune. Aucune requête à
   saisir.
4. **Analyse IA** des piliers : l'IA lit la page, en tire sa problématique et ses mots-clés de départ ; Google Ads
   Keyword Planner donne les volumes ; l'IA trie les mots-clés (visé, plus large, hors sujet) ; le code forme les
   **requêtes notées** (4 au plus, pondérées par le volume) ; l'IA remplit les grilles de notation ; le code calcule
   les notes.
5. **Lire** : Synthèse, Anomalies, SEO éditorial, GEO, Backlinks, tiroir de chaque page.
6. **Affiner** : rôle, objectif, requêtes notées (6 au plus à la main), mesure Google dans Positionnement.
7. **Partager et suivre** : PDF du rapport ou d'une page, nouvel audit (historique des positions et backlinks gardé).

États d'un audit : `CRAWLING_TECH` (exploration) → `AWAITING_AI_SELECTION` (pages à choisir) → `ANALYZING_AI` →
`COMPLETED` ; `FAILED` propose de réessayer. Un travail interrompu (serveur arrêté) est remis en état à la
prochaine ouverture : exploration → échec à relancer ; analyse IA → retour au choix des pages ; mesure Google →
recherches « En attente », bouton « Reprendre ».

Code couleur partout : vert = bon, orange/rouge = problème **mesuré**, **bleu = information ou estimation de l'IA**
(jamais présentée comme une erreur).

---

## 1. Tableau de bord (`/`)

- **Lancer un audit** (`AuditLauncher`, `audit-url-form.tsx`) : champ domaine ou URL, **périmètre**
  (`crawl-scope-picker.tsx`) : tout le site (liens jusqu'à 6 clics puis sitemap), pages principales (2 clics,
  50 pages) ou sitemaps choisis. Le projet est créé s'il n'existe pas ; l'exploration démarre en arrière-plan.
- **Chiffres** : projets suivis, audits, **projets à renforcer** (note < 60).
- **Derniers projets** : statut (badge), note, accès à la synthèse.

## 2. Mes projets (`/projets`)

- Liste paginée des projets : domaine, statut de l'audit (« Audit en cours… »), notes (éditorial, GEO et globale
  masquées tant que l'audit n'est pas terminé).
- **Supprimer un projet** (confirmation).

## 3. Paramètres (`/parametres`)

Enregistrés dans le navigateur (`settings-provider.tsx`) :
- Pages explorées au maximum par audit : 10 à 2 000 (150 par défaut).
- Recherches Google par lancement : jusqu'à 60 (20 par défaut) ; par jour : jusqu'à 300 (60 par défaut).
- Pages stratégiques analysables par l'IA : 1 à 100 (20 par défaut).

## 4. Barre latérale et en-tête d'audit

- Barre latérale : projets avec leur note, rubriques du projet ouvert (Synthèse, Anomalies, Sous-pages,
  SEO éditorial, Positionnement, Backlinks, GEO), Paramètres, mode clair / sombre.
- En-tête (`audit-header.tsx`) : fil d'ariane, **Nouvel audit** (fenêtre de lancement), **Exporter le rapport** :
  « Rapport client » (notes, résumé, 5 priorités, pages stratégiques, visibilité Google, popularité, peu de jargon)
  ou « Rapport complet ».
- **Limite connue** : la case « Outrepasser robots.txt » de la fenêtre de lancement **n'est reliée à rien** (état
  local seulement, jamais envoyé au serveur).

---

## 5. Synthèse (`/projets/[id]/synthese`)

- Jauges : note globale (technique 40 %, éditorial 35 %, GEO 25 %) et les trois notes.
- Nombre d'anomalies par gravité.
- **Vos priorités pour monter dans Google** et **Conseil de l'analyse** (critères les plus faibles, moyennés sur les
  piliers où ils s'appliquent).
- **Visibilité locale** (zones, pages dédiées, positions, pack local, établissements).
- **Popularité du site** : domaines référents, liens vérifiés, pages du site liées.

## 6. Anomalies (`/projets/[id]/global-issues` et `/global-issues/[issueId]`)

- Liste filtrable : pilier (technique, éditorial), gravité (critique, avertissement, info), recherche ; répartition
  par impact ; chaque anomalie montre son effet sur la note.
- Fiche d'une anomalie : pages concernées (ouvrir le tiroir ou visiter), étapes de correction.

## 7. Sous-pages (`/projets/[id]/subpages`)

- Toutes les pages explorées : URL, **rôle et objectif** (modifiables, recalcul de la note sans IA ; un changement
  d'objectif qui demande un autre jugement relance l'IA de la page), statut HTTP, note technique, nombre de mots,
  maillage (profondeur, liens entrants), **requêtes notées** (lecture seule ; modifiables dans le tiroir).
- Sélection des **pages piliers** (1 à 20 par défaut) puis **Lancer l'analyse IA**. Plus aucune requête à saisir.
- Message bleu si une analyse IA a été interrompue (à relancer, les pages déjà analysées ne sont pas refaites).

## 8. SEO éditorial (`/projets/[id]/seo-editorial`)

- KPI : note éditoriale moyenne, conflits de cannibalisation, adéquation à l'intention.
- Tableau des piliers : **requêtes notées** (la plus lourde, « +N », volume total), note éditoriale, intention,
  **couverture des recherches** (/15), cannibalisation, ouverture du tiroir.

## 9. Tiroir d'une page (fiche, depuis toutes les listes)

Onglets : **L'essentiel**, **Contenu**, **Technique**, **Moteurs IA**, **Positionnement** ; export PDF de la fiche ;
largeur réglable.

### Onglet Contenu (éditorial)
1. **En-tête** : problématique de la page (IA), requêtes notées (la plus lourde puis les autres avec leur volume),
   **rôle et objectif** (modifiables), position Google mesurée, intention de la page comparée à Google.
2. **Requêtes notées** (`query-set-panel.tsx`) : requête, volume, poids, placement dans la page (couverture /15 et
   zones manquantes), intention /15 (« À juger » si pas encore jugée), position Google. Cocher, décocher, ajouter
   (6 au plus), « Voir tous les mots-clés de la page », **Enregistrer**, « Choix automatique ».
3. **Ré-analyser la page** (un appel IA complet : mots-clés, tri, notation).
4. **Mots-clés et volumes de recherche** (`keyword-research-panel.tsx`) : chaque mot-clé avec origine (requête cible,
   mot-clé de l'IA, titres de la page, version courte, idée voisine), avis de l'IA (visée, plus large, hors sujet),
   volume mensuel, tendance 12 mois, concurrence publicitaire, présence (Title, H1, H2/H3, texte), case **Notée**
   pour l'ajouter ou le retirer des requêtes notées. Bouton Actualiser (sans IA de notation ; un petit appel pour le
   tri). Bandeaux bleus : volumes simulés, source absente, actualisation impossible (anciens volumes gardés).
5. **Réécriture proposée** (`page-rewrite-panel.tsx`) : Title, méta, H1, sous-titres H2 + phrase d'ouverture,
   sections à ajouter, selon l'objectif de la page ; avant / après, Copier ; **« Requêtes reprises »** sous chaque
   proposition, les mots s'allument au survol ; noms et chiffres absents de la page signalés en jaune ; longueur du
   Title et de la méta en orange hors plage ; proposition périmée si contenu, objectif ou requête principale
   changent.
6. **Livrables** : Title et méta suggérés par l'analyse.
7. **Critères du score** (points obtenus / en jeu, constat, « À faire »), **Ce que montre Google**,
   **Recommandations hors score** (fraîcheur, lisibilité, maillage, expérience vécue…).

### Autres onglets
- **L'essentiel** : notes des trois piliers, position Google, priorités de la page.
- **Technique** : critères techniques mesurés de la page, détails (code HTTP, redirections, canonique, images sans
  alt, liens).
- **Moteurs IA** : critères GEO (accès des robots IA, citabilité, Schema.org avec JSON-LD suggéré, NAP,
  sources d'autorité, llms.txt).
- **Positionnement** : relevés Google de la page (Top 10 classé, concurrents, questions des internautes, avis de
  l'IA sur les résultats, historique).

## 10. Positionnement (`/projets/[id]/positionnement`)

- **Zones ciblées** (3 par projet, API Géo officielle ; zone propre à une page possible, ville proposée à confirmer).
- **Visibilité par zone** (pages dédiées, recherches où le site sort, meilleure position, pack local).
- Avertissement : recherches automatisées contraires aux conditions de Google (profil Chrome dédié, captcha à
  résoudre soi-même).
- **Budget** de recherches (par lancement, par jour, utilisées aujourd'hui).
- Liste des pages (piliers ou toutes) : **Requêtes à mesurer** par page — requêtes notées cochées (« Notée », avec
  volume), mots-clés de l'IA suggérés par Google proposés non cochés, ajout libre (« + »), 6 cochées au plus ;
  **Analyser la sélection**, **Reprendre** (recherches en attente ou interrompues).
- Résultats par page : position, Top 10 (votre site, concurrents, annuaires, sites publics), autres mesures avec
  « Ajouter aux requêtes notées », avis de l'IA, historique.

## 11. Backlinks (`/projets/[id]/backlinks`)

- Résumé : domaines référents, liens vérifiés, pages du site liées.
- Évolution depuis l'audit précédent (nouveaux, plus observés).
- Liste des domaines référents (index Common Crawl) avec la vérification du lien (retrouvé, non vérifié, site
  injoignable). Hors score.

## 12. GEO (`/projets/[id]/geo`)

- KPI globaux et statut racine (robots.txt pour les robots IA, llms.txt).
- Tableau des piliers avec leur note GEO et accès au diagnostic de la page (onglet Moteurs IA du tiroir).

---

## 13. Exports PDF

- **Rapport du site** (`report-print-sheet.tsx`) : version client ou complète (résumé, priorités, pages
  stratégiques, visibilité Google et par zone, popularité, toutes les anomalies, méthode et limites).
- **Fiche d'une page** (`page-print-sheet.tsx`) : à traiter en priorité, recherche Google, textes prêts à copier,
  détails techniques.
