# Guide des fonctionnalités par page — Auditly (BigApp SEO)

Mis à jour le 04/11/2026, d'après le code. Ce guide décrit ce que l'utilisateur voit et peut faire sur chaque écran.
Le détail des calculs (barèmes, règles, cas limites) est dans `docs/tableau-metriques.md` (fonctionnel) et
`docs/Fichier.md` (technique). Les routes en anglais (`/dashboard`, `/projects/...`) redirigent vers les routes
françaises ci-dessous.

---

## 0. Parcours en bref

1. **Lancer un audit** (tableau de bord) : domaine + périmètre.
2. **Exploration automatique** : technique de chaque page, robots.txt, sitemap, PageSpeed, backlinks (Common Crawl).
3. **Choisir les pages piliers** (Sous-pages) : 1 à 20 pages (réglable), rôle de chacune (la famille en découle). Aucune requête à
   saisir.
4. **Analyse IA** des piliers : l'IA lit la page, en tire sa problématique et ses mots-clés de départ ; Google Ads
   Keyword Planner donne les volumes ; l'IA trie les mots-clés (visé, plus large, hors sujet) ; le code forme les
   **requêtes notées** (4 au plus, pondérées par le volume) ; l'IA remplit les grilles de notation ; le code calcule
   les notes.
5. **Lire** : Synthèse, Anomalies, SEO éditorial, GEO, Backlinks, tiroir de chaque page.
6. **Affiner** : rôle, requêtes notées (6 au plus à la main), mesure Google dans Positionnement.
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

- Barre latérale **flottante** (carte détachée des bords, coins arrondis, ombre ; repliable en icônes) : projets avec
  leur note, rubriques du projet ouvert (Synthèse, Anomalies, Plan d'action,
  Sous-pages, SEO éditorial, Positionnement, Backlinks ; GEO masqué), Paramètres, mode clair / sombre.
- En-tête (`audit-header.tsx`) : **pilule flottante et discrète** collée en haut au défilement (fondu du fond derrière
  elle), fil d'ariane, **Nouvel audit** (fenêtre de lancement), **Exporter le rapport** :
  « Rapport client » (notes, résumé, 5 priorités, pages stratégiques, visibilité Google, popularité, peu de jargon)
  ou « Rapport complet ».
- **Limite connue** : la case « Outrepasser robots.txt » de la fenêtre de lancement **n'est reliée à rien** (état
  local seulement, jamais envoyé au serveur).

---

## 5. Synthèse (`/projets/[id]/synthese`)

Lisible par le client comme par le consultant, en trois étages (refonte du 08/11/2026 : environ 1 700 px au lieu de
2 300) ; chaque titre dit la conclusion, une seule forme de carte, la couleur réservée aux états (toujours avec leur
mot) et aux positions, texte de 13 px au moins.
1. **En-tête « État du site »** : note globale dans un anneau (le seul chiffre vedette), sa mention (à corriger, à
   consolider, solide), son écart depuis l'audit terminé précédent et sa mini-courbe (dès deux audits) ; **« À
   retenir »** : la phrase du conseil de l'analyse, son détail (point faible, point fort, action rapide) dépliable sous
   « Conseil de l'analyse » ; les piliers en jauges (technique 53 %, contenu 47 % de la note ; GEO mis de côté, voir
   §12), chacun avec sa mention et son écart, clic → sa liste ; trois **chiffres clés** cliquables : demande dans le
   top 10 (ou recherches à mesurer), pages à corriger (note technique sous 60), domaines référents (hors score).
2. **Par où commencer** : les 5 critères qui rapporteraient le plus de points sur la note globale s'ils étaient
   parfaits partout (estimation), avec le pilier, le nombre de pages et une barre ; clic → liste du pilier. Message
   bleu si le détail technique manque sur une partie des pages (audit antérieur au 04/11/2026). En pied : les
   anomalies par gravité (pastilles cliquables) et « Toutes les anomalies ». Remplace « Vos priorités pour monter dans
   Google » (5 anomalies en grandes cartes) et l'encadré « Conseil de l'analyse ».
3. **Trois cartes de contexte** : **Google** (barre fine des recherches notées des pages stratégiques par position :
   top 3, 4 à 10, 11 à 30, absente, non mesurée ; les 3 plus demandées hors du top 10), **Pages** (pages par tranche
   de note pour chaque pilier, barres fines), **Popularité et local** (hors score : domaines référents, liens vérifiés,
   pages liées, puis la meilleure position de chaque zone).
- « Sources et limites » repliable en pied de page.

## 6. Anomalies (`/projets/[id]/global-issues` et `/global-issues/[issueId]`)

- Liste filtrable : pilier (technique, éditorial), gravité (critique, avertissement, info), recherche ; répartition
  par impact ; chaque anomalie montre son effet sur la note.
- Fiche d'une anomalie : pages concernées (ouvrir le tiroir ou visiter), étapes de correction.
- **Ajouter au plan d'action** : dans la liste (toutes les pages de l'anomalie pas encore dans le plan), et sur la
  fiche (bouton « Ajouter les N pages au plan », colonne « Plan d'action » : statut de chaque page dans le plan, ou
  bouton « Ajouter » pour cette page seule).

## 6 bis. Plan d'action (`/projets/[id]/plan`, depuis le 08/11/2026)

- Une **tâche = une anomalie sur une page** (ou sur tout le site) : corriger le H1 de /contact/ ne corrige pas celui
  de /a-propos/. Trois colonnes : **À corriger**, **En cours**, **Terminée** ; avancement (« 1 sur 47 terminées »).
- Les anomalies à **fort et moyen impact** du dernier audit arrivent seules dans « À corriger » (impact fort d'abord,
  puis la gravité) ; les autres s'ajoutent depuis Anomalies. Une tâche retirée ne revient pas seule.
- Carte : anomalie, page (ouvre le tiroir sur la bonne rubrique), pilier, gravité, impact, « Comment corriger »,
  note libre (ce qui a été fait, par qui, où), date de fin. Déplacer : glisser la carte (trait jaune à l'endroit du
  dépôt) ou ses boutons (Commencer, Terminer, ←), aussi au clavier ; retirer du plan.
- **Vérification par le dernier audit** : tâche terminée **avant** un audit qui relève encore l'anomalie → « Encore
  relevée par l'audit du … » (orange) avec « Rouvrir » ; tâche ouverte que l'audit ne relève plus → « Plus relevée
  par l'audit du … » (vert) avec « Passer en Terminée » ; page absente de l'audit → mention grise. Rien ne bouge seul.
- Filtres : recherche, pilier (Tout, Technique, Contenu, **Libres**), page, « À vérifier selon le dernier audit ». 30
  cartes par colonne, puis « Afficher les N autres ». Plan gardé dans la base du projet : le même pour tous et d'un audit
  à l'autre.
- **Par page / Par anomalie** (depuis le 09/11/2026, choix gardé dans le navigateur) : en « Par anomalie », les tâches
  d'une même anomalie présentes dans une colonne se regroupent en **une carte** (« H1 manquant · 12 pages »). Elle donne
  la gravité, l'impact, « Comment corriger » et le constat du dernier audit (« 3 pages encore relevées » → Rouvrir ;
  « 2 pages plus relevées » → Passer en Terminée, ces pages seulement). **Commencer / Terminer les N pages** et le glisser
  déplacent tout le groupe (avec « Annuler ») ; « Voir les N pages » déplie la liste pour traiter une page seule (ouvrir
  son tiroir, avancer, reculer, retirer). La case du groupe coche toutes ses pages (état partiel possible) pour la barre
  d'actions (Note commune, Retirer…). Une anomalie sur une seule page, ou une tâche libre, reste une carte ordinaire.
- **Nouvelle tâche** (tâche libre) : titre, détails et pages facultatives (une adresse par ligne : une tâche par page).
  Elle arrive **en haut** de « À corriger », sans gravité ni impact, et l'audit ne la vérifie pas (elle se déplace et se
  termine à la main). Détails dans « Détails », note, retrait et sélection comme les autres cartes.
- **Sélection de cartes** (case sur chaque carte, glisser, Maj + clic) et **barre d'actions** : Commencer, Rouvrir,
  **Note commune** (remplace leurs notes), Retirer (confirmation), **Terminer** (principale) ; déplacements avec
  « Annuler » (chaque tâche revient dans sa colonne d'avant).

## 7. Sous-pages (`/projets/[id]/subpages`)

- Toutes les pages explorées : URL, **rôle et famille** (rôle modifiable, recalcul de la note sans IA ; un changement
  de famille, informer ou présenter, relance l'IA de la page), statut HTTP, note technique, nombre de mots,
  maillage (profondeur, liens entrants), **requêtes notées** (lecture seule ; modifiables dans le tiroir).
- **Sélection** : clic sur une case, **glisser** sur les cases pour en cocher (ou décocher) plusieurs, **Maj + clic**
  pour une plage ; « Tout sélectionner » prend toutes les pages filtrées. Pas de plafond à la sélection.
- **Barre d'actions flottante** (en bas de l'écran dès qu'une page est sélectionnée, depuis le 08/11/2026 ; même barre
  dans Positionnement, SEO éditorial et Plan d'action) : bulle compacte, actions en icônes dont le nom se déplie au
  survol ou au focus clavier, action principale toujours nommée, précision dépliée au survol du nombre ; jamais de
  défilement horizontal. Effacer la sélection, nombre de pages, puis **Fiches PDF** (une fiche par page, toutes dans un seul PDF, chacune sur une
  nouvelle page), **Ajouter au plan** (toutes les anomalies de ces pages, une tâche par anomalie et par page ; message
  avec **Annuler** et « Ouvrir le plan »), **Lancer l'analyse IA** (les pages deviennent les pages stratégiques, 20 au
  plus par défaut : au-delà, le bouton est indisponible et dit combien en retirer). Plus aucune requête à saisir.
  Le compteur « N / 20 sélectionnées », la jauge et le bouton d'analyse du haut de l'écran sont remplacés par la barre.
- Message bleu si une analyse IA a été interrompue (à relancer, les pages déjà analysées ne sont pas refaites).
- **Tableau personnalisable** (08/11/2026, aussi dans Positionnement et SEO éditorial), propre à chaque
  utilisateur et gardé dans son navigateur (une disposition par tableau) :
  - **Colonnes** (menu « Colonnes 8/61 », avec recherche) : colonnes du tableau, puis **toutes les métriques d'une
    page**, ajoutables sur n'importe quel tableau et masquées par défaut, par groupe : Page (Title, méta et leurs
    longueurs, H1, rôle, famille, page stratégique, nombre de mots), Indexation (statut HTTP, indexable, liens
    suivis, balise robots, canonical, redirection), Technique (score, écart depuis l'audit précédent, points mesurés,
    temps de réponse, LCP, INP, CLS, images sans alt, plus gros point perdu), Maillage (profondeur, liens entrants),
    Contenu (score éditorial et son écart, intention de la page et de Google, Intent Match, couverture des recherches,
    cannibalisation, réécriture), Recherches (requête principale, nombre et volume des requêtes notées, mots-clés
    avec volume, mot-clé le plus recherché, recherches hors page intégrables), Google (position, meilleure position,
    requêtes mesurées, dernière mesure, évolution de la position, pack local, zone), Anomalies (critiques,
    avertissements, mineures), Critères éditoriaux (« Contenu · Lisibilité »… en % des points). Une donnée absente
    s'affiche « — ». Pour chaque colonne : afficher ou masquer, épingler à gauche, voir sa largeur ; « Tout
    afficher ». La case de sélection reste toujours en premier.
  - **Déplacer** une colonne en glissant son en-tête : la colonne se soulève, un trait jaune montre où elle tombera,
    les autres glissent pour lui faire place. Une colonne épinglée se déplace parmi les épinglées.
  - **Largeur** : tirer le bord droit d'un en-tête ; double clic pour l'ajuster au contenu.
  - **Épinglée** : collée à gauche quand le tableau défile, avec une ombre.
  - **Réinitialiser** revient à la disposition par défaut.
  - **Clavier** depuis un en-tête : ← → parcourir, Alt + ← → déplacer, Maj + ← → largeur, E épingler, M masquer,
    Entrée ajuster ; chaque changement est annoncé aux lecteurs d'écran. Pied du tableau : « 7 sur 8 colonnes ·
    1 épinglée ».

## 8. SEO éditorial (`/projets/[id]/seo-editorial`)

- KPI : note éditoriale moyenne, conflits de cannibalisation, adéquation à l'intention.
- Pages de contact, légales et utilitaires : « Non notée » à la place de la note éditoriale (exclues de la moyenne ; leurs constats restent dans le tiroir).
- Tableau des piliers : **requêtes notées** (la plus lourde, « +N », volume total), note éditoriale, intention,
  **couverture des recherches** (/15), cannibalisation, ouverture du tiroir. Tableau personnalisable comme Sous-pages
  (toutes les métriques d'une page ajoutables, dont les critères éditoriaux en %).
- **Barre d'actions** sur les pages cochées : **Ré-analyser** et **Proposer une réécriture** (confirmation qui annonce le
  nombre d'appels à l'IA ; réécritures à jour non refaites ; avancement « 2/5 »), **Mesurer dans Google** (ouvre
  Positionnement avec ces pages cochées), **Fiches PDF**, **Ajouter au plan**, **Retirer des piliers** (confirmation :
  notes recalculées, une relecture IA de la cohérence du site).

## 9. Tiroir d'une page (fiche, depuis toutes les listes)

**Fiche côte à côte avec la liste** (depuis le 08/11/2026, écran large) : panneau flottant collé à droite, sans voile ;
la liste reste lisible et cliquable, le contenu lui laisse la place et le menu de gauche passe en icônes (il revient à la
fermeture s'il était déplié). Dans Sous-pages, Positionnement et SEO éditorial, **un clic sur une ligne** ouvre sa fiche
(hors bouton, lien, champ ou case ; onglet Positionnement ou Contenu selon l'écran) et la **ligne active** est surlignée
(fond jaune léger, trait à gauche). **En-tête compact** (09/11/2026, 142 px au lieu d'environ 245 ; titre sur deux lignes au plus) : titre de la
page ; chemin (lien vers la page), état HTTP, indexable ou non, **position dans la liste** (« 2 / 25 ») ; icônes
**Copier le lien** (« Lien copié »), Exporter en PDF, **↑ ↓** pour la page précédente ou suivante (même onglet),
fermer ; onglets sur une seule ligne. Plus de pied de fiche : les touches sont rappelées dans les infobulles. Clavier :
**J / K** parcourent la liste (fiche fermée : déplacent la ligne active, **Entrée** l'ouvre), **Échap** ferme. Bord
gauche à tirer pour la largeur (560 px par défaut, 420 au moins, 70 % de l'écran au plus). Petit écran : la fiche
couvre la page, sur un voile.
Onglets : **L'essentiel**, **Contenu**, **Technique**, **Positionnement** (**Moteurs IA** masqué, GEO mis de côté) ; export PDF de la fiche.

### Onglet Contenu (éditorial)
Trois vues (09/11/2026), choisies en haut de l'onglet (barre collée en haut au défilement) et gardées d'une page à
l'autre : **Notes** (note du contenu, points 1, 6 et 7), **Mots-clés** (points 2 à 5), **Réécriture** (point 8). Un
renvoi vers un critère (L'essentiel, « À corriger ») ouvre la vue Notes.

1. **En-tête** : problématique de la page (IA), requêtes notées (la plus lourde puis les autres avec leur volume),
   **rôle** (modifiable) et **famille** (informer, présenter, non notée ; déduite du rôle), position Google mesurée, intention de la page comparée à Google.
2. **Requêtes notées** (`query-set-panel.tsx`) : requête, volume, poids, placement dans la page (couverture /15 et
   zones manquantes), intention /15 (« À juger » si pas encore jugée), position Google. Seules les requêtes notées
   sont listées (les autres se cochent dans « Mots-clés et volumes » ou « Recherches hors page ») : décocher, ajouter
   (6 au plus), **Enregistrer**, « Choix automatique ».
3. **Ré-analyser la page** (un appel IA complet : mots-clés, tri, notation ; garde les mots-clés de départ, les choix
   cochés, les recherches hors page et la réécriture). **Repartir de zéro** : fenêtre de confirmation, puis efface
   problématique et mots-clés de départ, volumes et tri, requêtes notées choisies à la main, recherches hors page et
   réécriture, et relance l'analyse ; rôle et mesures Google gardés.
4. **Mots-clés et volumes de recherche** (`keyword-research-panel.tsx`) : chaque mot-clé avec origine (requête cible,
   mot-clé de l'IA, titres de la page, version courte, idée voisine), avis de l'IA (visée, plus large, hors sujet),
   volume mensuel, tendance 12 mois, concurrence publicitaire, présence (Title, H1, H2/H3, texte), case **Notée**
   pour l'ajouter ou le retirer des requêtes notées. Bouton Actualiser (sans IA de notation ; un petit appel pour le
   tri). Bandeaux bleus : volumes simulés, source absente, actualisation impossible (anciens volumes gardés).
5. **Recherches hors page** (`keyword-opportunities-panel.tsx`) : bouton « Chercher des recherches hors page » (un
   appel IA, environ 15 s). L'IA propose des recherches absentes du contenu, Keyword Planner donne leur volume, le code
   donne le statut : Intégrable, À confirmer (mots absents affichés), Autre page (lien), Hors offre ; les écartées
   (moins de 20/mois, sans volume, marque d'un tiers) sont repliées. Type de recherche selon l'IA, phrase de la page
   retrouvée mot pour mot, signal « Plus large », pic saisonnier et « nouvelle ». Tout en bleu (information). Case
   **Notée** sur les intégrables et à confirmer seulement : la note ne change que si on coche. Bouton Relancer.
6. **Ré-analyser la page** et **Repartir de zéro** (vue Notes, sous le résumé).
7. **Critères du score** (points obtenus / en jeu, constat, « À faire »), **Ce que montre Google**,
   **Indications hors note** (en texte, sans carte ni pastille : cannibalisation estimée, Title et méta, fraîcheur,
   maillage, expérience vécue… ; état écrit en clair, piste, « Voir le détail » ; ligne « Rien à signaler »).
   Critère « sujet » nommé selon le rôle : « Couverture du sujet » (article, guide), « Crédibilité » (page
   institutionnelle), « Savoir-faire » (accueil, offre, liste, réalisation).
   « Réponse aux recherches notées » et « Couverture des recherches » : **tableau par requête** (volume, part de la
   note, cases de l'IA oui / non ou points de chaque zone avec mots absents, note sur 15, note du critère en pied).
8. **Réécriture** (`page-rewrite-panel.tsx`, vue Réécriture) : Title, méta, H1, sous-titres H2 + phrase d'ouverture,
   sections à ajouter, selon le rôle de la page et **rédigés avec les requêtes notées (cochées)**. Disposition :
   - **En haut, deux colonnes** : à gauche la **capture PageSpeed** de la page actuelle (cadre de téléphone, Entière /
     1er écran, ouvrir, reprendre) ; à droite « Dans Google » (Title et méta comme dans un résultat, longueurs, boutons
     Title / Méta pour copier), avertissements et « Requêtes reprises ».
   - **En dessous, « Page réécrite »** : plan complet dans l'ordre de la page, une ligne par titre séparée par un
     filet, pastille de niveau **H1, H2, H3** à gauche, titre à sa taille et décalé selon son niveau, ouverture de
     section en paragraphe lisible (62 caractères au plus de large) ; pastille bleue pleine = réécrit, pointillée et
     « à ajouter » = section proposée (placée en fin de plan : l'IA ne dit pas où), grise et ligne basse = titre gardé.
     **Requêtes reprises** en pastilles : survol d'une pastille → ses mots s'allument dans toute la proposition ;
     survol d'un bloc → les requêtes qu'il reprend s'allument. « [À COMPLÉTER : …] » encadré en bleu. Case **Comparer
     avec l'actuel** : texte actuel barré sous chaque élément changé et raison du changement. **Copier en Markdown**
     (Title, méta, plan et ouvertures), copie d'un bloc au survol.
   - **Capture** : PageSpeed Insights, vue mobile, **page entière** (défile dans le cadre) ou **premier écran**. Prise
     pendant l'audit pour les pages mesurées (accueil et pages les plus liées) ; sinon bouton **Capturer la page**
     (20 à 60 s, sans effet sur la note).
   Noms et chiffres absents de la page signalés en jaune ; longueur du Title et de la méta en orange hors plage ;
   proposition périmée si contenu, famille ou requêtes notées changent. Seul endroit des Title et méta prêts à copier,
   rédigés seulement au clic sur « Proposer une réécriture » : rien n'est affiché avant.

### Autres onglets
- **L'essentiel** : verdict en une phrase ; trois notes avec leur mention et leur écart depuis l'audit précédent (même
  adresse) ; **où la page perd ses points** (barres classées, 5 critères au plus, en points de la note de chaque pilier,
  clic → rubrique) ; **recherches visées et place dans Google** (volume en barre, placement Title / Intro / H2, position,
  mini-courbe de la position sur la requête principale ; page non stratégique : sa position mesurée) ; **vitesse**
  (LCP, INP, CLS sur une jauge à seuils Google) ; les 3 actions qui comptent le plus.
- **Technique** : critères techniques mesurés de la page, détails (code HTTP, redirections, canonique, images sans
  alt, liens).
- **Moteurs IA** : critères GEO (accès des robots IA, citabilité, Schema.org avec JSON-LD suggéré, NAP,
  sources d'autorité, llms.txt).
- **Positionnement** : relevés Google de la page (Top 10 classé, concurrents, questions des internautes, avis de
  l'IA sur les résultats, historique).

## 10. Positionnement (`/projets/[id]/positionnement`)

- En-tête : titre, une phrase d'explication ; **Analyser la sélection**, **Reprendre**, et dessous le **budget** de
  recherches (utilisées aujourd'hui, par lancement, coût de la sélection, lien vers les paramètres).
- **Zones et visibilité locale** (un seul bloc, `local-zones-section.tsx`, depuis le 08/11/2026) :
  - **Zones ciblées** (3 par projet : ville, code postal, département, région via l'API Géo officielle, pays, ou autre
    lieu saisi tel quel ; zone propre à une page possible, ville proposée à confirmer). Le nom de la zone est ajouté à
    la fin des recherches mesurées.
  - **Carte** (`zones-map.tsx`, Leaflet, fond OpenStreetMap assombri en mode sombre, contours IGN) : zones colorées
    selon leur meilleure position mesurée (Top 3, 4 à 10, 11 à 30, absente, pas mesurée en pointillés, couleurs des
    graphiques), siège et établissements en pastilles jaunes (centre de leur commune), info-bulles. Pays et autres lieux
    listés sous la carte (pas de contour). Molette active après un clic dans la carte.
  - **Rayon** (1 à 100 km, 20 par défaut, gardé dans le navigateur) autour du siège, sinon de la ville de la première
    zone ; un clic sur la carte déplace le centre, « Recentrer sur le siège ». Communes du rayon : nombre total et les
    8 plus peuplées (habitants, distance), bouton **+ Zone** (ou clic sur leur pastille dans la carte). Aide au choix :
    Google n'est pas mesuré par distance.
  - **Visibilité par zone** (pages dédiées, recherches où le site sort, meilleure position, pack local) et
    établissements repérés.
- Avertissement : recherches automatisées contraires aux conditions de Google (profil Chrome dédié, captcha à
  résoudre soi-même).
- **Barre d'actions** sur les pages cochées (glisser, Maj + clic) : **Changer la zone** (menu, zone choisie ou retour aux
  zones du projet pour toutes ces pages), **Fiches PDF**, **Ajouter au plan**, **Mesurer dans Google** (principale ;
  coût et budget restant au survol du nombre : « 7 à 21 recherches · 60 restantes aujourd'hui » ; indisponible au-delà
  de 20 pages). Remplace le bouton « Analyser la sélection » et le coût de la sélection en haut de l'écran. Pages
  arrivées de SEO éditorial (`?pages=`) déjà cochées.
- Tableau personnalisable comme Sous-pages (colonnes Page, Requêtes à mesurer, Position, État, Actions, plus toutes
  les métriques d'une page ; résultats Google dépliés sous la ligne, dans la largeur visible).
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
- **Liens précis** (bouton « Chercher les liens précis », depuis le 09/11/2026, **à part de l'audit**) : cherche dans
  Google les pages qui parlent de la **marque** du site (le nom sans le site, avec et sans espace, hors du site audité,
  **défilé sur 9 pages de résultats**), lit chacune en direct et relève le lien exact. Pour chaque lien : page source, texte et nature de l'ancre (marque,
  adresse, formule générique, image, texte libre), suivi ou nofollow / sponsored / ugc, **emplacement** (contenu,
  en-tête, menu, pied de page, colonne latérale, commentaires), nombre de liens externes du contenu, paragraphe autour
  du lien, page du site liée, et « Absent de Common Crawl » pour un site nouveau. Les pages qui citent le site sans lien
  sont listées à part (pistes de prospection, à confirmer : le nom de marque peut désigner une autre entreprise).
  Avancement affiché en direct ; budget de recherches Google des Paramètres (20 pages de résultats par lancement, 60 par
  jour par défaut), lues trois par trois et espacées de quelques secondes ; raison des pages injoignables indiquée ; arrêt sur captcha, les pages déjà trouvées
  sont lues. **Limite** : Google ne remonte pas tout (un lien sans le nom de marque dans son texte est absent) ; un lien ajouté par JavaScript n'est pas vu.

## 12. GEO (`/projets/[id]/geo`)

**Mis de côté depuis le 05/11/2026** (`GEO_ENABLED = false`, `src/core/domain/features.ts`) : l'adresse renvoie vers la
Synthèse ; entrée du menu, onglet « Moteurs IA » de la fiche, anomalies GEO, jauges et colonnes GEO des PDF et de la
liste des projets masqués. L'analyse GEO tourne toujours et l'écran reste dans le code. Description quand il est actif :

- KPI globaux et statut racine (robots.txt pour les robots IA, llms.txt).
- Tableau des piliers avec leur note GEO et accès au diagnostic de la page (onglet Moteurs IA du tiroir).

---

## 13. Exports PDF

- **Rapport du site** (`report-print-sheet.tsx`) : version client ou complète (résumé, priorités, pages
  stratégiques, visibilité Google et par zone, popularité, toutes les anomalies, méthode et limites).
- **Fiche d'une page** (`page-print-sheet.tsx`) : à traiter en priorité, recherche Google, textes prêts à copier,
  détails techniques.
- **Présentation** (depuis le 09/11/2026) : accent jaune `#eab308`, notes en anneaux avec verdict écrit (Solide,
  À consolider, À corriger), pastilles pour la gravité, l'impact et le nombre de pages, encadré « À faire », notes des
  pages stratégiques en barres, tableaux zébrés, titres numérotés, numéro de page en pied (Chrome récent). Couverture
  du rapport : note globale en grand, légende des seuils et chiffres clés.
