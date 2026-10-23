# 🏗️ Architecture, Structure et Logique du Front-End — BigApp SEO

Ce document détaille l'architecture globale, la hiérarchie des composants, le flux de données ainsi que la logique métier et technique mise en œuvre dans le front-end de la plateforme.

---

## 1. Principes Fondamentaux de Conception

L'application front-end est conçue selon les principes de l'**Architecture Hexagonale (Ports & Adaptateurs)**, découplant les règles d'évaluation d'audit de la couche de présentation et des composants graphiques.

### Les 4 piliers architecturaux :
1. **Séparation Déterministe vs IA :** 
   - Le moteur technique s'exécute sur un large échantillon de pages (jusqu'à 500 URLs).
   - L'évaluation par IA (*Claude 3.5 Sonnet*) est strictement cantonnée aux 10 à 20 pages piliers sélectionnées manuellement par le consultant.
2. **Doctrine 100 % Mobile-First :** 
   - L'interface n'intègre aucun sélecteur ou score Desktop résiduel. Tous les indicateurs reflètent les conditions d'indexation mobile de Google (*Googlebot Smartphone*, émulation réseau et Core Web Vitals).
3. **Écrasement Total (Zéro Historique) :** 
   - Chaque projet ne stocke qu'un seul état d'audit actif à l'instant T. Toute relance d'audit écrase intégralement les données précédentes pour préserver les ressources serveur et garantir une photographie nette.
4. **Fluidité Transversale de l'Inspection (Sheet) :** 
   - Le tiroir latéral d'inspection unitaire peut être ouvert depuis n'importe quelle vue sans perdre le contexte d'affichage, tout en restant synchronisé dans l'URL pour faciliter le partage ou le retour arrière.

---

## 2. Arborescence et Organisation des Fichiers

```plaintext
/
├── app/                                       # Routage Next.js 16 (App Router)
│   ├── layout.tsx                             # Layout racine (Thème sombre, Providers, Police Inter)
│   ├── page.tsx                               # Page d'accueil / Tableau de bord principal
│   ├── dashboard/page.tsx                     # Redirection automatique vers /
│   ├── projets/
│   │   ├── page.tsx                           # Liste générale des projets
│   │   └── [projectId]/
│   │       ├── synthese/page.tsx              # Écran 3 : Synthèse de l'audit
│   │       ├── global-issues/
│   │       │   ├── page.tsx                   # Écran 4 : Global Issues & Tips
│   │       │   └── [issueId]/page.tsx         # Détail d'une anomalie (ex. Thin Content)
│   │       ├── subpages/page.tsx              # Écrans 5 & 8 : Subpages (500 URLs & sélection piliers)
│   │       ├── seo-editorial/page.tsx         # Écran 6 : Tableau de bord sémantique IA
│   │       └── geo/page.tsx                   # Écran 7 : Tableau de bord moteurs IA
│   ├── projects/                              # Routes miroirs / compatibilité anglaise
│   │   ├── page.tsx                           # Redirection vers /projets
│   │   └── [projectId]/
│   │       ├── overview/page.tsx              # Redirection vers /projets/[id]/synthese
│   │       ├── issues/page.tsx                # Redirection vers /projets/[id]/global-issues
│   │       ├── subpages/page.tsx              # Redirection vers /projets/[id]/subpages
│   │       ├── editorial/page.tsx             # Redirection vers /projets/[id]/seo-editorial
│   │       └── geo/page.tsx                   # Redirection vers /projets/[id]/geo
│   └── globals.css                            # Tokens CSS Tailwind v4 & shadcn/base-nova
│
├── components/
│   ├── audit/                                 # Composants d'audit et vues métier
│   │   ├── audit-header.tsx                   # Fil d'ariane, badge de crawl & bouton Nouvel Audit
│   │   ├── score-gauges.tsx                   # Jauges SVG circulaires, semi-circulaires & courbe
│   │   ├── page-inspection-sheet.tsx          # Tiroir latéral transversal (Technique, Édito, GEO)
│   │   ├── synthesis-view.tsx                 # Vue d'assemblage Synthèse
│   │   ├── global-issues-view.tsx             # Vue d'assemblage Global Issues
│   │   ├── individual-issue-view.tsx          # Vue d'assemblage détail d'anomalie
│   │   ├── subpages-view.tsx                  # Vue d'assemblage Subpages
│   │   ├── seo-editorial-view.tsx             # Vue d'assemblage SEO Éditorial
│   │   └── geo-view.tsx                       # Vue d'assemblage GEO
│   ├── dashboard/                             # Éléments du tableau de bord d'agence
│   │   ├── app-shell.tsx                      # Conteneur global (Sidebar + Main)
│   │   ├── app-sidebar.tsx                    # Barre de navigation latérale dynamique
│   │   ├── audit-launcher.tsx                 # Formulaire de lancement rapide
│   │   ├── projects-table.tsx                 # Tableau des derniers audits
│   │   └── stat-card.tsx                      # Cartes statistiques d'agence
│   ├── projects/                              # Éléments de gestion de projets
│   │   ├── projects-list-table.tsx            # Tableau complet des projets
│   │   ├── delete-project-dialog.tsx          # Modale de suppression de projet
│   │   └── pagination-nav.tsx                 # Composant de pagination
│   ├── providers/                             # Gestion d'état partagé (Contextes React)
│   │   ├── projects-provider.tsx              # Gestion du cycle de vie des projets et du crawl
│   │   └── inspection-provider.tsx            # Gestion du tiroir latéral et synchronisation URL
│   └── ui/                                    # Primitives UI (shadcn / base-ui)
│
├── lib/
│   ├── audit-data.ts                          # Modèle de données complet et mock pour Big Happy
│   ├── projects.ts                            # Entités projets, formatage du temps et calculs de score
│   └── utils.ts                               # Utilitaire de fusion de classes Tailwind (clsx + twMerge)
│
└── docs/
    ├── fonctionnalites_par_page.md            # Spécification détaillée des fonctionnalités par page
    └── structure_et_logique_frontend.md       # Ce document d'architecture et logique
```

---

## 3. Gestion d'État et Flux de Données

Le front-end s'appuie sur deux contextes React réactifs et découplés, garantissant des temps de réponse instantanés sans surcoût de rechargement :

### 1. `ProjectsProvider` (`components/providers/projects-provider.tsx`)
- **Rôle :** Orchestre la liste des projets de l'agence, les compteurs de statistiques globales et la simulation de crawl.
- **Fonctionnalités exposées :**
  - `projects` : Tableau des projets avec statuts, scores et métadonnées.
  - `stats` : Statistiques d'agence (projets actifs, audits du mois).
  - `launchAudit(domain)` : Démarre un nouvel audit sur un domaine avec progression de 0 à 100%.
  - `relaunchAudit(projectId)` : Réinitialise et relance un audit avec écrasement cascade.
  - `deleteProject(projectId)` : Supprime définitivement un projet.

### 2. `InspectionProvider` (`components/providers/inspection-provider.tsx`)
- **Rôle :** Contrôle l'affichage du **Tiroir d'inspection unitaire latéral (Sheet)** depuis n'importe quel écran.
- **État géré :**
  - `isOpen` : Booléen d'affichage du tiroir.
  - `pageId` : Identifiant de l'URL actuellement inspectée (ex. `wine-and-spirit`, `accueil`, `contact`).
  - `tab` : Onglet actif (`tech`, `editorial`, `geo`).
- **Synchronisation bi-directionnelle avec l'URL :**
  - L'ouverture via `openInspection(pageId, tab)` met à jour l'état React de façon synchrone (ouverture instantanée sans latence) tout en ajoutant les paramètres d'URL via l'API HTML5 `window.history.pushState` (`?inspect=[pageId]&tab=[tab]`).
  - Lors de l'utilisation des boutons Précédent/Suivant du navigateur, l'écouteur `popstate` synchronise automatiquement l'état du tiroir.
  - La fermeture via `closeInspection()` nettoie les paramètres d'URL sans déclencher de rechargement réseau.

---

## 4. Logique Métier Implémentée

### A. Règle du Sas de Sélection des Pages Piliers
Sur l'écran **Subpages** :
- Le consultant dispose d'un plafond strict de **20 pages piliers maximum** (`3 / 20 sélectionnées`).
- Pour chaque page, le champ **Mot-clé cible** propose deux modes :
  1. *Saisie manuelle :* Le LLM analyse la page sous la contrainte exclusive de cette requête.
  2. *Champ vide (Auto-détection) :* Le LLM déduit l'intention de recherche principale en lisant le contenu brut.
- Au clic sur **« Lancer l’analyse IA »**, les pages cochées sont enregistrées et la navigation bascule vers la vue SEO Éditorial.

### B. Règle de Protection des Coûts API (Cadenas sur pages non-piliers)
Dans le **Tiroir d'inspection (Sheet)** :
- Si l'utilisateur inspecte une URL qui ne fait **pas** partie des pages piliers sélectionnées (ex. `/contact` ou `/actualités`) :
  - L'onglet **Technique & Meta** s'affiche normalement (calculé déterministement et gratuitement).
  - Les onglets **SEO Éditorial** et **GEO** affichent un écran de verrouillage explicatif avec icône de cadenas et bouton de retour vers l'audit technique.
  - Cela matérialise la contrainte budgétaire stricte énoncée dans le cahier des charges.

### C. Détection de Cannibalisation et Alertes Croisées
Sur l'écran **SEO Éditorial** :
- Une analyse croisée des intentions de recherche détecte les concurrences directes entre pages d'un même domaine.
- L'alerte met en évidence le conflit (ex. *« Conflit avec /diffusion »*) et abaisse la note de zones chaudes en conséquence.

### D. Algorithmes de Visualisation Graphique SVG
Dans `components/audit/score-gauges.tsx` :
- **`CircularGauge` :** Cercle trigonométrique SVG calculant la longueur de circonférence ($2\pi r$) et animant le décalage `strokeDashoffset` avec une transition CSS fluide de 1000ms.
- **`SemiCircleGauge` :** Arc en fer à cheval (demi-cercle supérieur) simulant un tachymètre ou jauge de vitesse avec chiffre XXL au centre.
- **`TrendAreaChart` :** Tracé vectoriel avec gradient linéaire doré (`#c5a830` vers `#7a671b`) et point d'inflexion pour matérialiser le score de citabilité moyenne GEO.

---

## 5. Tokens de Design et Charte Graphique

L'application applique une charte sombre rigoureuse et contrastée conçue pour les outils d'audit professionnels :
- **Fond principal :** `#000000` (Noir profond)
- **Surfaces et cartes :** `#2b2b2b` / `#222222` (Gris anthracite structuré)
- **Couleur d'accent primaire :** `#f5e400` (Jaune solaire distinctif BigApp SEO)
- **Texte au premier plan :** `#ffffff` (Titres) et `#b3b3b3` (Labels secondaires)
- **Palette de sévérité unifiée :**
  - 🔴 **Critique / Bloquant :** `#ef4444` (Erreurs HTTP 4xx/5xx, Thin content < 400 mots, Conflits de cannibalisation, `/llms.txt` manquant)
  - 🟡 **Avertissement / Moyen :** `#eab308` / `#f5e400` (Temps de réponse TTFB, Thin content 400-500 mots, sauts H2-H4)
  - 🟢 **Validé / Conforme :** `#12b10f` (Code HTTP 200, balise canonical conforme, certification SSL, authorisations IA robots.txt)

---

## 6. Modèle de Données TypeScript (`lib/audit-data.ts`)

Les structures de données garantissent la stricte conformité entre les maquettes graphiques et les retours prévus du crawler et de l'API Claude 3.5 Sonnet :

- **`ProjectAuditData` :** Contrat racine d'un audit de domaine (ID, nom, statistiques de crawl, scores agrégés, KPIs, pages piliers, subpages, anomalies globales, inspections unitaires).
- **`PillarPage` :** Entité représentant une page stratégique enrichie par l'IA (scores sémantiques, Intent Match /20, Zones Chaudes /15, statut de cannibalisation, citabilité, accessibilité IA, microdonnées Schema.org).
- **`SubpageItem` :** Entité représentant une URL brute du crawl BFS (profondeur, inlinks entrants, nombre de mots, mot-clé cible forcé ou auto-détecté).
- **`GlobalIssue` :** Entité représentant une anomalie déterministe agrégée (catégorie, niveau de sévérité, volume de pages impactées, liste d'aperçu).
- **`InspectionData` :** Snapshot unitaire complet pour une URL regroupant les checklists des 3 onglets ainsi que les encarts de raisonnement déductif (*Chain of Thought*) de Claude 3.5 Sonnet.
