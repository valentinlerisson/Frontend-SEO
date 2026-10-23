# 📖 Guide Exhaustif des Fonctionnalités par Page — BigApp SEO (Auditly)

Ce document répertorie l'ensemble des pages de l'application front-end, leurs éléments d'interface, les fonctionnalités interactives auxquelles l'utilisateur a accès, ainsi que l'action exacte attendue ou exécutée par chacune d'elles.

---

## 1. Tableau de bord principal (`/` ou `/dashboard`)

### Rôle de la page
Point d'entrée de l'agence pour lancer un nouvel audit en 1 clic et consulter rapidement l'état d'activité global ainsi que les 3 derniers projets audités.

### Éléments et Actions disponibles
1. **Bannière d'accueil & Lancement rapide (`AuditLauncher`)**
   - **Formulaire de saisie d'URL :** Champ de saisie acceptant un domaine (ex. `bighappy.fr`) ou une URL complète.
   - **Bouton « Lancer l’audit » :** 
     - **Action :** Valide la syntaxe du domaine via `parseDomain()`. Si valide, initialise un nouveau projet avec le statut `crawling` à 0% de progression, incrémente le compteur d'audits du mois et déclenche la simulation de crawl en arrière-plan.
2. **Stat Cards KPI Agence (`StatCard`)**
   - **« Projets Actifs » :** Affiche le nombre total de projets surveillés.
   - **« Audits ce mois » :** Affiche le volume d'audits exécutés sur la période mensuelle.
3. **Bouton « Voir tout les projets » :**
   - **Action :** Redirige vers la vue liste complète des projets (`/projets`).
4. **Tableau des 3 derniers audits (`ProjectsTable`)**
   - **Ligne de projet :** Affiche le nom, le domaine, le statut (badge vert `Prêt` ou capsule jaune animée `Crawl en cours (X%)`), le score global consolidé et le temps relatif écoulé (ex. *« Il y a 2h »*).
   - **Bouton « Accéder » (icône document) :**
     - **Action :** Redirige immédiatement vers la synthèse de l'audit du projet (`/projets/[projectId]/synthese`).
     - Si le projet est en cours de crawl, le bouton est remplacé par l'indicateur textuel *« En cours... »*.

---

## 2. Mes Projets (`/projets` ou `/projects`)

### Rôle de la page
Gestionnaire de portefeuille de projets de l'agence permettant de filtrer, rechercher, relancer ou supprimer un projet.

### Éléments et Actions disponibles
1. **Barre de recherche de projets :**
   - **Action :** Filtre en temps réel la table sur le nom du projet ou son nom de domaine.
2. **Tableau de bord exhaustif (`ProjectsListTable`)**
   - **Colonnes de scoring décomposées :** Affiche individuellement les notes en % pour **Tech**, **Edito**, **GEO**, ainsi que le dernier audit.
   - **Bouton « Accéder » (jaune) :**
     - **Action :** Ouvre la synthèse de l'audit (`/projets/[projectId]/synthese`).
   - **Bouton « Relancer l’audit » (icône rotation) :**
     - **Action :** Réinitialise le projet au statut `crawling`, remet la progression à 0% et applique la règle d'écrasement total N-1.
   - **Bouton « Supprimer le projet » (icône corbeille rouge) :**
     - **Action :** Ouvre une modale de confirmation (`DeleteProjectDialog`). Si confirmée, retire le projet de la liste et décrémente les statistiques globales.
3. **Pagination dynamique :**
   - **Action :** Permet de feuilleter les projets par tranche de 10 résultats.

---

## 3. Synthèse de l’audit (`/projets/[projectId]/synthese` ou `/overview`)

### Rôle de la page
Vue stratégique à l'instant T synthétisant l'état de santé du site sous la doctrine 100% Mobile-First, avec répartition par pilier et plan d'action prioritaire.

### Éléments et Actions disponibles
1. **Barre supérieure (`AuditHeader`) :**
   - **Fil d'ariane :** Affiche `Projets / bighappy.fr / Synthèse` avec liens cliquables.
   - **Badge de statut de crawl :** Capsule sombre avec spinner rotatif jaune `Crawl en cours (26/87)`.
   - **Bouton « + Nouvel Audit » :** Ouvre la modale de configuration d'un nouvel audit avec bascule de contournement anti-bot (`robots.txt override`).
2. **Bouton « Exporter en PDF » :**
   - **Action :** Ouvre la modale d'exportation en marque blanche pour générer et télécharger le rapport client.
3. **Cadre « Score Global » :**
   - **Grande jauge circulaire (78%) :** Rendu SVG haute précision avec arc jaune.
   - **Bannière rouge « 3 erreurs critiques bloquantes » (avec flèche ↗) :**
     - **Action :** Redirige vers la page des anomalies filtrée sur les erreurs critiques (`/projets/[projectId]/global-issues?filter=critical`).
   - **Bannière jaune « 12 avertissements » (avec flèche ↗) :**
     - **Action :** Redirige vers la page des anomalies filtrée sur les alertes (`/projets/[projectId]/global-issues?filter=warning`).
   - **Bannière verte « 20 bonnes pratiques » (avec flèche ↗) :**
     - **Action :** Redirige vers la page des anomalies filtrée sur les points validés (`/projets/[projectId]/global-issues?filter=passed`).
4. **Section « Détails des Scores » (3 cartes cliquables) :**
   - **Carte « SEO Technique » (84/100, jauge violette) :**
     - **Action :** Redirige vers l'écran Subpages (`/projets/[projectId]/subpages`) pour inspecter les URLs explorées.
   - **Carte « SEO Editorial » (62/100, jauge orange) :**
     - **Action :** Redirige vers l'écran SEO Éditorial (`/projets/[projectId]/seo-editorial`).
   - **Carte « GEO » (84/100, jauge verte) :**
     - **Action :** Redirige vers l'écran GEO (`/projets/[projectId]/geo`).
5. **Carte « Conseils » (Dégradé rouge/orange) :**
   - Affiche les recommandations prioritaires générées par l'audit avec filigrane « B » de l'agence.

---

## 4. Global Issues & Tips (`/projets/[projectId]/global-issues` ou `/issues`)

### Rôle de la page
Consolidation déterministe de toutes les anomalies structurelles, techniques et éditoriales détectées lors du crawl des 500 pages.

### Éléments et Actions disponibles
1. **Filtres thématiques par catégorie :**
   - Boutons `All`, `Tech. & Meta`, `Structure`, `Content`.
   - **Action :** Filtre instantanément la liste des anomalies affichées selon le domaine technique.
2. **Cartes d'anomalies interactives :**
   - Chaque anomalie affiche son niveau de sévérité (pastille rouge, jaune ou verte), son intitulé exact et son tag technique.
3. **Accordéon dépliable « Thin content (pages contenant moins de 500 mots) » :**
   - **Action :** Au clic, se déplie pour dévoiler un aperçu rapide des URLs affectées (`accueil`, `a-propos`, `strategie`) avec le nombre de mots et leur pastille de sévérité.
   - **Lien « Voir toute les erreurs » :** Redirige vers l'écran dédié d'inspection de cette anomalie (`/projets/[projectId]/global-issues/thin-content`).

---

## 5. Détail d'une anomalie unitaire (`/projets/[projectId]/global-issues/[issueId]`)

### Rôle de la page
Vue granulaire recensant l'intégralité des URLs pénalisées par une anomalie spécifique (ex. Thin Content).

### Éléments et Actions disponibles
1. **Bouton « < Retour aux erreurs » :**
   - **Action :** Retourne à la vue globale des anomalies (`/projets/[projectId]/global-issues`).
2. **Barre de recherche URL :**
   - **Action :** Filtre en direct les URLs listées dans le tableau.
3. **Encart d'explication pédagogique :**
   - Rappelle l'impact de l'anomalie sur le positionnement Google (seuil des 500 mots, risques de dévaluation algorithmique).
4. **Tableau des URLs impactées :**
   - Affiche le chemin, le nombre de mots précis, la profondeur de clic BFS (`Niv 0`, `Niv 1`, `Niv 2`), le nombre d'inlinks entrants.
   - **Clic sur le chemin de l'URL ou sur l'icône document (`Page Details`) :**
     - **Action :** Ouvre instantanément le **Tiroir latéral d'inspection (Sheet)** sur l'onglet Technique & Meta pour cette page spécifique.
   - **Icône lien externe (↗) :** Ouvre l'URL réelle du site dans un nouvel onglet de navigateur.

---

## 6. Subpages (`/projets/[projectId]/subpages`)

### Rôle de la page
Tableau de bord de transition entre le crawl déterministe et l'analyse stratégique par IA. Permet au consultant de sélectionner les 10 à 20 pages piliers à soumettre à Claude 3.5 Sonnet.

### Éléments et Actions disponibles
1. **Compteur de sélection de pages piliers :**
   - Badge `X / 20 sélectionnées` réactif en temps réel.
2. **Filtres d'indexabilité :**
   - Boutons `All`, `Indexable`, `Not indexable`.
3. **Cases à cocher (Checkboxes) :**
   - **Case générale d'en-tête :** Sélectionne ou désélectionne les 20 premières pages de la liste.
   - **Case par ligne :** Ajoute ou retire la page de la sélection de pages piliers (plafond strict à 20 pour maîtriser les coûts API).
4. **Champ de saisie « Mot-clé cible » :**
   - Permet au consultant de forcer une requête stratégique (ex. *« agence marketing toulouse 31 »*).
   - Si laissé vide, l'IA exécutera une auto-détection de l'intention à partir du contenu brut de la page.
5. **Bouton jaune « Lancer l’analyse IA » :**
   - **Action :** Lance le traitement des pages sélectionnées par Claude 3.5 Sonnet et bascule l'utilisateur vers le tableau de bord SEO Éditorial (`/projets/[projectId]/seo-editorial`).
6. **Actions de ligne & Page Details :**
   - **Clic sur l'URL ou sur l'icône document (`Page Details`) :** Ouvre le tiroir latéral d'inspection sur l'audit technique de la page.
   - **Icône lien externe (↗) :** Ouvre la page en direct.
7. **Pagination :**
   - Navigation de page en page (`1-10 sur 87 URL`, `Précédent`, `Suivant`, numéros).

---

## 7. SEO Éditorial (`/projets/[projectId]/seo-editorial` ou `/editorial`)

### Rôle de la page
Tableau de bord sémantique exploitant les évaluations qualitatives de l'IA sur les pages piliers.

### Éléments et Actions disponibles
1. **3 KPI's Globaux :**
   - **Score éditorial moyen (78%) :** Demi-jauge jaune avec note moyenne des pages piliers.
   - **Cannibalisation détectée (⚠️ 1 Conflit) :** Alerte croisée signalant la concurrence sémantique entre deux URLs du site (ex. `/wine&spirit` vs `/diffusion`).
   - **Intent Match Global (85%) :** Pourcentage moyen d'adéquation entre le contenu et l'intention de recherche attendue.
2. **Tableau sémantique comparatif :**
   - Colonnes : Page Pilier, Mot-clé cible (avec indication italique de l'auto-détection si applicable), Score éditorial, Intent Match (/20), Zones Chaudes (/15), Statut Cannibalisation (pastille verte *« Aucune »* ou rouge *« Conflit avec /url »*).
   - **Clic sur le nom de la page pilier ou sur l'icône document (`Page Details`) :**
     - **Action :** Ouvre instantanément le **Tiroir d'inspection** positionné directement sur l'onglet **SEO Éditorial (IA)** de cette page.

---

## 8. GEO — Generative Engine Optimization (`/projets/[projectId]/geo`)

### Rôle de la page
Diagnostic de la visibilité et citabilité du site par les moteurs de réponse à base d'IA générative (Google AI Overviews, Perplexity, SearchGPT).

### Éléments et Actions disponibles
1. **3 KPI's Globaux :**
   - **Score GEO Moyen (68%) :** Demi-jauge jaune de performance d'extraction IA.
   - **Statut /llms.txt :** Indicateur de présence du standard Markdown à la racine du domaine (Badge rouge `Manquant`).
   - **Citabilité Moyenne (55%) :** Taux de passage ranking prêt à l'extraction accompagné d'un graphique de tendance doré avec point focal.
2. **Tableau de bord GEO :**
   - Colonnes : Page Pilier, Score GEO, Accessibilité robots IA (`OUI`/`NON`), Citabilité (`Elevée`/`Moyenne`/`Faible`), Schéma.org (`Présent`/`Manquant`).
   - **Clic sur la page ou sur l'icône document (`Page Details`) :**
     - **Action :** Ouvre le **Tiroir d'inspection** positionné directement sur l'onglet **GEO (IA)** de cette page.

---

## 9. Le Tiroir Latéral d'Inspection Transversal (`Sheet`)

### Rôle du composant
Volet coulissant depuis la droite, superposable sans rechargement sur n'importe quel écran, synchronisé avec les query params (`?inspect=[pageId]&tab=[tech|editorial|geo]`).

### Éléments et Actions disponibles
1. **En-tête et métadonnées de la page :**
   - Titre H1 de la page, URL absolue avec lien sortant, badges `HTTP 200`, `Index`, `Follow`, `Temps de réponse (0.74 s)`.
   - **Bouton X :** Ferme le tiroir et nettoie l'URL sans rafraîchissement de page.
2. **Commutateur des 3 onglets d'inspection :**
   - `SEO Éditorial [XX%]` | `Technique & Meta [XX%]` | `GEO (IA) [XX%]`
   - Soulignement jaune dynamique de l'onglet actif.
3. **Contenu de l'onglet « Technique & Meta » :**
   - **Bloc Scores :** Demi-jauge SVG et 6 barres de progression (*Meta information*, *Page quality*, *Page structure*, *Links*, *Server*, *External factors*).
   - **Cadre Priorités (To-Do) :** Alertes bloquantes (ex. *robots.txt mal configuré*) et optimisations recommandées (ex. *temps de réponse TTFB*).
   - **Accordéons de contrôle :** Checklists avec icônes de succès (cercle vert), avertissement (triangle jaune) et erreur (croix rouge).
4. **Contenu de l'onglet « SEO Éditorial (IA) » :**
   - **Bannière de contexte :** Rappelle la requête cible et le modèle utilisé (*Claude 3.5 Sonnet*).
   - **Bloc Scores & To-Do :** Jauge éditoriale et recommandations prioritaires.
   - **Encart « Chain of Thought » :** Encadré en italique précédé de l'icône robot, détaillant le raisonnement déductif du LLM avant chaque checklist.
5. **Contenu de l'onglet « GEO (IA) » :**
   - **Bannière d'analyse GEO :** Présentation des critères d'extraction pour AI Overviews et Perplexity.
   - **Jauge & Barres de citabilité :** Mesure des autorisations GPTBot/ClaudeBot, présence de `/llms.txt`, sections autonomes et cohérence NAP.
   - **Encart de raisonnement IA & Checklists.**
6. **Protection des coûts API (Pages non-piliers) :**
   - Si une page inspectée n'a pas été cochée comme page pilier, les onglets Éditorial et GEO affichent un écran de verrouillage informatif avec cadenas, protégeant l'agence contre les appels API non autorisés.

---

## 10. Modales transversales

### Modale « + Nouvel Audit »
- **Champ URL :** Saisie du domaine cible.
- **Badge doctrine 100% Mobile-First :** Rappel de l'exécution sous User-Agent Googlebot Smartphone.
- **Bascule « Outrepasser robots.txt » :** Permet d'ignorer les règles anti-crawlers pour les audits de pré-production ou sites protégés.
- **Bouton « Démarrer l’audit » :** Lance le crawl et referme la modale avec animation de succès.

### Modale « Exporter en PDF »
- **Récapitulatif de l'export :** Nom du domaine, volume de pages et date.
- **Bouton « Télécharger le PDF » :** Simule la génération côté serveur et le téléchargement du document prêt pour le client.
