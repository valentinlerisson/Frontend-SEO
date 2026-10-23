# **Cahier des charges technique et fonctionnel complet : plateforme SaaS d'audit SEO & GEO interne**

Ce document constitue la source de vérité unique et exhaustive pour le développement et le déploiement de la plateforme, alignant le moteur d'audit backend, le modèle de données et la structure d'interface (UI/UX).

## **I. Philosophie, périmètre et règles métier**

L'application est un outil SaaS auto-hébergé à usage strictement interne pour une agence SEO. Sa proposition de valeur repose sur la séparation nette entre le crawl déterministe exhaustif (algorithmique pure sur 500 pages) et l'audit qualitatif stratégique (intelligence artificielle sur 10 à 20 pages piliers).

### **Règles métier fondamentales**

> * **Écrasement total (zéro historique de crawl) :** pour préserver les ressources serveur et la base PostgreSQL, chaque nouvel audit sur un projet écrase intégralement les données brutes, les scores et les tâches de l'audit précédent. L'interface affiche une photographie stricte à l'instant T : aucune notion de comparaison temporelle, de delta (+/- points) ou de courbe d'évolution (sparkline) n'est stockée ni affichée. L'archivage repose exclusivement sur l'exportation PDF côté client/serveur.  
> * **Protection des coûts API & calcul local :** le crawl technique et les vérifications de structure/contenu statique sont exécutés localement et gratuitement par le moteur interne. Les appels à l'API Claude 3.5 Sonnet sont strictement cantonnés aux pages piliers sélectionnées par le consultant.  
> * **Doctrine 100 % Mobile-First stricte :** en conformité avec l'indexation de Google (Googlebot Smartphone), l'audit est exécuté exclusivement avec un User-Agent mobile. Le crawler et les requêtes PageSpeed Insights ciblent uniquement les conditions de navigation sur smartphone. L'interface abandonne tout commutateur ou scoring Desktop au profit d'un indicateur fixe d'audit mobile.  
> * **Contournement anti-bot & forçage :** routage systématique du crawler via des proxys résidentiels pour prévenir les blocages (Cloudflare, Datadome). Le système intègre un commutateur permettant d'outrepasser (override) les directives du robots.txt en cas d'audit pré-production ou de blocage accidentel.  
> * **Pénalité bloquante absolue :** toute page renvoyant un code HTTP d'erreur (4xx, 5xx) ou balisée en noindex voit ses scores éditorial et GEO automatiquement fixés à 0, quel que soit son contenu textuel.

## **II. Workflow d'audit en deux temps**

Le traitement asynchrone est orchestré pour découpler l'effort machine de la décision stratégique humaine.

### **1\. Phase 1 : Crawl local & scoring déterministe (500 pages max)**

> * Initialisation du job via la file d'attente (Redis / BullMQ).  
> * Parcours en largeur (BFS \- Breadth-First Search) pour cartographier l'arborescence, calculer la profondeur exacte de clic et recenser le graphe de liens internes entrants (inlinks).  
> * **Requête unique PageSpeed Insights (Mobile) :** pour chaque URL analysée, le worker n'exécute qu'un seul appel API configuré sur la stratégie mobile (strategy=mobile). Cela divise par deux le temps d'exécution du crawl et préserve les quotas de requêtes.  
> * Analyse du code source HTML via Cheerio : extraction des balises, comptage des mots, métriques techniques et détection statique du contenu.  
> * Génération immédiate du score technique individuel de chaque URL et mise en pause du processus sous le statut AWAITING\_AI\_SELECTION.

### **2\. Phase de transition : Sélection et ciblage sémantique (écran Subpages)**

> * Le consultant accède au tableau des pages explorées.  
> * Sélection manuelle de 10 à 20 pages stratégiques (Pages Piliers).  
> * **Gestion du mot-clé cible :**  
  * Saisie manuelle : le consultant force une requête clé précise (ex. : « agence seo bordeaux »). Claude 3.5 évaluera la page sous la contrainte stricte de ce mot-clé.  
  * Auto-détection (champ laissé vide) : Claude 3.5 analyse le texte brut pour déduire lui-même l'intention principale et juger la page en fonction de cette déduction.

### **3\. Phase 2 : Analyse qualitative par IA (Claude 3.5 Sonnet)**

> * Envoi du texte brut nettoyé des pages piliers au LLM avec injection du super-prompt d'évaluation sous forme de grille d'évaluation (Rubric Scoring).  
> * Génération d'un format JSON strict avec raisonnement préalable (Chain of Thought) détaillant les déductions pour chaque critère éditorial et GEO.

### **4\. Phase 3 : Clôture et consolidation**

> * Calcul du score global consolidé.  
> * Génération de la To-Do list d'erreurs globales (actions prioritaires).  
> * Disponibilité immédiate de l'export PDF en marque blanche.

## **III. Barèmes mathématiques et algorithmes de scoring**

Le score global de santé est la moyenne arithmétique directe des trois piliers :

### **1\. Pilier Technique & Déterministe (Sur 100 points — Script local)**

> * **Core Web Vitals (25 pts) :** calculés sur l'émulation mobile standard de Google (LCP \< 2,5 s, INP \< 200 ms, CLS \< 0,1). Une seule note technique définitive est attribuée à chaque page.  
> * **Architecture & Maillage (20 pts) :** 100% des pages navigables en ≤ 3 clics depuis l'accueil (10 pts) \+ absence totale de pages orphelines (présentes uniquement dans le sitemap XML, 10 pts).  
> * **Crawlabilité & Indexation (15 pts) :** fichier robots.txt syntaxiquement valide (5 pts) \+ sitemap XML accessible (5 pts) \+ balise canonical conforme et auto-référencée (5 pts).  
> * **Sécurité & Protocole HTTP (15 pts) :** certificat SSL valide (5 pts) \+ absence de liens internes brisés (4xx/5xx, 5 pts) \+ redirections propres sans boucle ni mixed content (5 pts).  
> * **Structure HTML (15 pts) :** présence d'un unique H1 par page (8 pts) \+ respect de la hiérarchie structurelle des sous-titres H2-H6 sans saut de niveau (7 pts).  
> * **Balisage & Images (10 pts) :** présence de balises \<title\> et métadescriptions uniques et calibrées (5 pts) \+ taux de remplissage des attributs alt sur les images ≥ 90% (5 pts).

### **2\. Pilier Éditorial & Sémantique (Sur 100 points — LLM sur pages piliers)**

> * **Adéquation de l'intention / Intent Match (20 pts) :** adéquation du contenu avec la nature de la requête (informationnelle, transactionnelle, commerciale).  
> * **Absence de cannibalisation (20 pts) :** vérification croisée de l'unicité du sujet parmi l'échantillon des pages piliers auditées.  
> * **Zones chaudes stratégiques (15 pts) :** présence contextuelle et naturelle du mot-clé cible dans le \<title\>, le \<h1\>, l'URL et les 100 premiers mots.  
> * **Règle du contenu primaire / Réponse directe (15 pts) :** délivrance de la réponse essentielle (TL;DR) dès le premier écran sans obliger l'internaute à faire défiler la page.  
> * **Couverture sémantique & Entités (15 pts) :** densité équilibrée du terme principal (≤ 2,5%) et intégration des entités nommées connexes indispensables au champ lexical.  
> * **Signaux E-E-A-T (10 pts) :** identification claire de l'auteur (biographie, qualifications) et présence d'une date de publication ou de mise à jour visible.  
> * **Lisibilité & Confort de lecture (5 pts) :** aération des paragraphes, phrases courtes et clarté stylistique (score type Flesch \> 60).

### **3\. Pilier GEO — Generative Engine Optimization (Sur 100 points — LLM sur pages piliers)**

> * **Accessibilité aux robots IA (25 pts) :** autorisations explicites dans le robots.txt pour GPTBot (10 pts), ClaudeBot (10 pts) et PerplexityBot (5 pts).  
> * **Standard /llms.txt (25 pts) :** présence et conformité d'un fichier Markdown /llms.txt structuré à la racine du domaine.  
> * **Citabilité & Formatage des passages (20 pts) :** sections H2/H3 rédigées de manière autonome (Passage Ranking), avec présence de listes, tableaux de synthèse ou formulations factuelles prêtes à être citées.  
> * **Sources & Données d'autorité (10 pts) :** présence d'au moins deux liens externes vers des sources de référence validant les chiffres ou affirmations.  
> * **Identification d'entité Schema.org (10 pts) :** présence de microdonnées JSON-LD typées Organization ou Person.  
> * **Cohérence NAP (10 pts) :** présence textuelle standardisée des coordonnées professionnelles (Nom, Adresse, Téléphone).

## **IV. Structure de l'interface & expérience utilisateur (Figma)**

L'interface est structurée pour séparer nettement les diagnostics globaux déterministes de l'exploration granulaire par page.

### **1\. Écran « Synthèse »**

> * **En-tête :** nom du projet, statut du crawl, badge informatif \[ 📱 Audit Mobile-First \] et bouton d'action Exporter en PDF.  
> * **Score global :** grand indicateur visuel chiffré unique (sans indicateur de tendance ni delta).  
> * **Détail des 3 piliers :** 3 jauges circulaires (Radial Charts) affichant la note sur 100 de chaque pilier (Technique, Éditorial, GEO).  
> * **Bannière Quick Wins :** Top 3 des actions prioritaires critiques avec redirection vers la gestion détaillée.

### **2\. Écran « Global Issues » (Filtres déterministes)**

Regroupe l'intégralité des anomalies calculées mécaniquement sur les 500 pages, classées par sévérité au sein de 4 onglets (All, Tech. & Meta, Structure, Content).

### **3\. Écran « Subpages » & Tiroir d'inspection (Sheet)**

#### **A. Le tableau de bord principal**

Composant Data Table pour la sélection des pages piliers avec URL, Statut HTTP, Volume de mots, Inlinks, Profondeur et Mot-clé cible.

#### **B. Le tiroir d'inspection unitaire (Sheet latéral droit)**

Affiche l'audit exhaustif d'une URL, structuré en 3 onglets. Chaque onglet respecte la structure visuelle suivante :

> * **Bannière de contexte :** Rappel du type d'analyse (ex. Mot-clé ciblé par Claude 3.5).  
> * **Bloc Scores :** Jauge circulaire (Radial Chart) pour le score principal et barres de progression pour les sous-catégories.  
> * **Priorités (To-Do) :** Liste des actions critiques et recommandations immédiates propres à cette URL.  
> * **Analyse détaillée (Accordéons) :**  
  * Pour l'onglet **Technique & Meta** : Checklist binaire d'éléments (présent/absent).  
  * Pour les onglets **SEO Éditorial (IA)** et **GEO (IA)** : Intégration d'un encart "Chain of Thought" (Raisonnement de l'IA) en tête d'accordéon justifiant la note, suivi de la checklist binaire.

### **4\. Écran transversal « SEO Éditorial »**

Vue transversale dédiée à l'exploitation des résultats de l'IA sur l'ensemble des pages piliers validées.

> * **KPIs Globaux :** Score Éditorial Moyen (Radial chart), Alerte de Cannibalisation globale, et Intent Match Global (pourcentage).  
> * **Tableau de Bord Sémantique :** Liste les pages piliers et compare leurs scores (Score Éditorial, Intent Match, Zones Chaudes, Statut Cannibalisation). Au clic sur une ligne, le tiroir d'inspection de la page s'ouvre sur l'onglet correspondant.

### **5\. Écran transversal « GEO (IA) »**

Vue transversale dédiée à l'évaluation de la citabilité globale du site par les moteurs de réponse (AIO, Perplexity).

> * **KPIs Globaux :** Score GEO Moyen, Statut du fichier /llms.txt à la racine, et Taux de Citabilité Moyen (Passage Ranking).  
> * **Tableau de Bord GEO :** Liste les pages piliers et compare leurs scores (Score GEO, Accessibilité IA, Citabilité, Schema.org). Au clic sur une ligne, le tiroir d'inspection de la page s'ouvre.

## **V. Architecture technique et modèle de données**

### **Stack technique**

> * **Framework d'application :** Next.js (App Router, React, TypeScript).  
> * **Composants graphiques :** Tailwind CSS \+ shadcn/ui.  
> * **Base de données & ORM :** PostgreSQL \+ Prisma ORM.  
> * **Asynchrone :** Redis avec BullMQ.  
> * **Crawl & IA :** Crawlee \+ Anthropic SDK (Claude 3.5 Sonnet).

`model Audit {`  
  `id              String      @id @default(uuid())`  
  `projectId       String      @unique`  
  `scoreGlobal     Float?`  
  `scoreTechnique  Float?      // Note unique 100% Mobile`  
  `scoreEditorial  Float?`  
  `scoreGeo        Float?`  
  `pages           Page[]`  
  `globalIssues    GlobalIssue[]`  
  `createdAt       DateTime    @default(now())`  
`}`

## **VI. Inventaire exhaustif des points de contrôle par URL (Checklists d'inspection)**

Cette section détaille l'intégralité des points de contrôle statiques (Techniques) et dynamiques (IA) évalués pour chaque page. Ces éléments doivent systématiquement apparaître dans le panneau latéral (Sheet) de la page, qu'ils soient en succès, en avertissement ou en erreur.

### **1\. Onglet Technique & Meta (Catégories et priorités)**

#### **Meta data**

> * **Balise Title** (Présence, longueur optimale 50-60 caractères) — *Critique*  
> * **Meta description** (Présence, longueur optimale 150-160 caractères) — *Important*  
> * **Crawlability** (Directives meta robots index/follow) — *Critique*  
> * **Canonical link** (Présence, validité absolue ou auto-référencée) — *Important*  
> * **Language** (Attribut HTML lang présent et valide) — *Faible importance*  
> * **Alternate / hreflang links** (Présents si le site est multilingue) — *Faible importance*  
> * **Charset encoding** (UTF-8) — *Faible importance*

#### **Page quality (Contenu)**

> * **Word count** (Contenu suffisant \> 500 mots, alerte si "thin content") — *Critique*  
> * **Mots-clés du Title présents dans le texte** — *Important*  
> * **Mots-clés du H1 présents dans le texte** — *Important*  
> * **Texte de remplissage** (Détection de "Lorem Ipsum" / Placeholders) — *Critique*  
> * **Texte dupliqué** (Détection de paragraphes dupliqués au sein de la page) — *Important*  
> * **Ratio Texte/Code HTML** (Supérieur à 10%) — *Faible importance*

#### **Page structure**

> * **H1 heading** (Unicité absolue sur la page, longueur minimale) — *Critique*  
> * **Hiérarchie des titres** (H2-H6, absence de sauts de niveaux abrupts) — *Important*  
> * **Images SEO** (Attributs "alt" renseignés sur toutes les images) — *Important*

#### **Link structure**

> * **Liens internes** (Volume correct, ancres pertinentes, pas de liens dynamiques) — *Important*  
> * **Liens internes brisés** (Absence d'erreurs 4xx, 5xx) — *Critique*  
> * **Liens externes** (Présence et validité des liens sortants) — *Nice to have*

#### **Server configuration & Performance**

> * **HTTP redirects** (Absence de chaînes ou de boucles de redirection internes) — *Critique*  
> * **Temps de réponse** (TTFB / LCP local \< 0.4s) — *Important*  
> * **Poids de la page** (Taille totale du HTML) — *Faible importance*

### **2\. Onglet SEO Éditorial (Critères IA Claude 3.5)**

> * **1\. Intent Match & Cannibalisation (Sur 20 points)**  
  * Intention comprise et traitée (informationnelle, transactionnelle).  
  * Absence de conflits (Cannibalisation).  
> * **2\. Zones Chaudes Stratégiques (Sur 15 points)**  
  * Présence du mot-clé dans le \<title\>, le \<H1\>, l'URL, et les 100 premiers mots.  
> * **3\. Contenu Primaire & Réponse Directe (Sur 15 points)**  
  * Réponse immédiate (TL;DR) visible sans scroller.  
  * Appel à l'action (CTA) clair.  
> * **4\. Couverture Sémantique & Entités (Sur 15 points)**  
  * Densité saine du mot-clé (≤ 2,5%).  
  * Richesse des entités (LSI).  
> * **5\. Signaux E-E-A-T (Sur 10 points)**  
  * Expertise et Autorité (Auteur identifié).  
  * Fraîcheur (Date visible).  
> * **6\. Lisibilité (Sur 5 points)**  
  * Structure aérée (\< 50 mots par paragraphe).  
  * Phrases claires (Score de lisibilité).

### **3\. Onglet GEO (IA) (Critères IA Claude 3.5)**

> * **1\. Accessibilité & Standards IA (Sur 50 points)**  
  * Autorisations spécifiques dans le robots.txt (GPTBot, ClaudeBot, PerplexityBot).  
  * Présence et validité du fichier standard /llms.txt à la racine du domaine.  
> * **2\. Citabilité & Passage Ranking (Sur 20 points)**  
  * Sections autonomes prêtes à être indexées (Passage Ranking).  
  * Présence de formats facilement extractibles (Listes à puces factuelles, Tableaux de données, TL;DR).  
> * **3\. Autorité, Preuves & Sources (Sur 30 points)**  
  * Liens externes vers des domaines d'autorité pour appuyer les faits (Preuves).  
  * Balisage Schema.org présent et valide (Organization, Person).  
  * Cohérence textuelle des coordonnées de l'entreprise (NAP : Nom, Adresse, Téléphone).

**1\. Arborescence des dossiers**  
Plaintext

```
src/
├── core/                                      # --- DOMAINE & APPLICATION ---
│   ├── domain/                                # 1. Cœur métier (zéro dépendance externe)
│   │   ├── entities/
│   │   │   ├── project.entity.ts              # Projet (domaine, configuration)
│   │   │   ├── audit.entity.ts                # Audit snapshot (écrasement total / zéro historique)
│   │   │   ├── page.entity.ts                 # Données d'une URL crawlée (500 max)
│   │   │   ├── global-issue.entity.ts         # Anomalie globale (TECH, STRUCTURE, CONTENT)
│   │   │   └── scoring-rubric.entity.ts       # Barèmes (Mobile 100 pts, Éditorial 100 pts, GEO 100 pts)
│   │   ├── value-objects/
│   │   │   ├── url.vo.ts                      # Normalisation et validation d'URL
│   │   │   ├── http-status.vo.ts              # Code HTTP (règle bloquante 4xx/5xx/noindex)
│   │   │   ├── click-depth.vo.ts              # Profondeur de clic BFS (≤ 3)
│   │   │   └── target-keyword.vo.ts           # Requête cible (forcée ou auto-détectée)
│   │   └── ports/                             # Interfaces de communication
│   │       ├── in/                            # Ports Primaires (Cas d'usage exposés)
│   │       │   ├── start-crawl.port.ts
│   │       │   ├── launch-ai-analysis.port.ts
│   │       │   ├── get-project-overview.port.ts
│   │       │   ├── get-global-issues.port.ts
│   │       │   ├── get-subpages.port.ts
│   │       │   ├── get-editorial-dashboard.port.ts
│   │       │   ├── get-geo-dashboard.port.ts
│   │       │   ├── inspect-page.port.ts
│   │       │   └── manage-project.port.ts     # Actualiser (écraser) / Supprimer
│   │       └── out/                           # Ports Secondaires (Services externes / SPI)
│   │           ├── project-repository.port.ts
│   │           ├── audit-repository.port.ts
│   │           ├── crawler.port.ts            # Crawlee / Cheerio BFS
│   │           ├── llm-analyzer.port.ts       # Claude 3.5 Sonnet
│   │           ├── pagespeed.port.ts          # PageSpeed Insights API (Mobile-Only)
│   │           ├── queue.port.ts              # BullMQ / Redis
│   │           └── pdf-exporter.port.ts       # Export de rapport
│   │
│   └── application/                           # 2. Cas d'usage (Orchestration métier)
│       ├── use-cases/
│       │   ├── start-new-audit.use-case.ts    # Initialisation crawl + écrasement N-1
│       │   ├── execute-ai-audit.use-case.ts   # Analyse des 10-20 piliers par Claude 3.5
│       │   ├── calculate-scores.use-case.ts   # Agrégation Tech, Éditorial et GEO
│       │   ├── consolidate-issues.use-case.ts # Génération de la To-Do globale
│       │   ├── refresh-audit.use-case.ts      # Forçage du re-crawl
│       │   └── delete-project.use-case.ts
│       └── dtos/                              # Objets de transfert de données
│           ├── project.dto.ts
│           ├── audit-summary.dto.ts
│           └── page-inspection.dto.ts
│
├── infrastructure/                            # --- ADAPTATEURS SECONDAIRES (DRIVEN) ---
│   ├── persistence/
│   │   ├── prisma/
│   │   │   ├── schema.prisma                  # Modèle PostgreSQL
│   │   │   └── migrations/
│   │   ├── mappers/                           # Conversion DB <-> Entités du Domaine
│   │   │   ├── project.mapper.ts
│   │   │   └── audit.mapper.ts
│   │   └── repositories/
│   │       ├── prisma-project.repository.ts
│   │       └── prisma-audit.repository.ts
│   ├── crawler/
│   │   ├── crawlee-cheerio.adapter.ts         # Crawler mobile BFS (proxies résidentiels)
│   │   └── html-parser.service.ts             # Extraction DOM Cheerio
│   ├── llm/
│   │   ├── anthropic-claude.adapter.ts        # Client Anthropic (Prompt Rubric Scoring)
│   │   └── prompts/
│   │       ├── editorial-audit.prompt.ts      # 7 critères éditoriaux + Chain of Thought
│   │       └── geo-audit.prompt.ts            # 6 critères GEO + Passages citables
│   ├── performance/
│   │   └── pagespeed-mobile.adapter.ts        # Requête unique mobile
│   ├── queue/
│   │   ├── bullmq-job.adapter.ts              # File d'attente Redis
│   │   └── workers/
│   │       └── crawl.worker.ts                # Exécution asynchrone isolée
│   └── pdf/
│       └── react-pdf.adapter.ts               # Moteur d'exportation marque blanche
│
├── presentation/                              # --- ADAPTATEURS PRIMAIRES (DRIVING / UI) ---
│   ├── hooks/                                 # State & URL synchronization
│   │   ├── use-page-inspection.ts             # Pilotage du Sheet unitaire via query params
│   │   ├── use-pillar-selection.ts            # Sas de sélection 10-20 pages
│   │   └── use-audit-stream.ts                # Polling / SSE du statut du job
│   ├── stores/                                # État local partagé (Zustand)
│   │   └── inspection-drawer.store.ts         # Maintien d'état du tiroir sans rechargement
│   └── components/
│       ├── layouts/
│       │   ├── agency-sidebar.tsx             # Menu Principal (Dashboard, Mes Projets)
│       │   ├── project-sidebar.tsx            # Menu Projet (Synthèse, Issues, Édito, GEO, Subpages)
│       │   └── breadcrumb-nav.tsx             # Fil d'ariane dynamique
│       ├── inspection-sheet/                  # TIROIR LATÉRAL TRANSVERSAL (SHEET)
│       │   ├── sheet-container.tsx            # Wrapper slide-over
│       │   ├── sheet-header.tsx               # Titre, URL, badges HTTP et Core Web Vitals
│       │   ├── tabs/
│       │   │   ├── tech-tab.tsx               # Accordéons checklists techniques
│       │   │   ├── editorial-tab.tsx          # 7 critères IA + Chain of Thought
│       │   │   └── geo-tab.tsx                # 6 critères GEO + Format passages
│       │   └── widgets/
│       │       ├── radial-score-chart.tsx     # Jauge circulaire score sur 100
│       │       ├── score-progress-bar.tsx     # Barres de progression par sous-catégories
│       │       ├── todo-priority-list.tsx     # Actions critiques To-Do de la page
│       │       └── ai-reasoning-box.tsx       # Encart "Chain of Thought" Claude 3.5
│       ├── shared/                            # Composants atomiques (shadcn/ui modifiés)
│       │   ├── data-table.tsx
│       │   ├── badge-status.tsx
│       │   └── accordion-section.tsx
│       └── views/                             # Blocs d'écrans dédiés
│           ├── dashboard/                     # Quick start audit, KPI agence
│           ├── projects-list/                 # Table générale des projets
│           ├── project-settings/              # Snapshot, actualiser (écraser), supprimer
│           ├── synthesis/                     # 3 jauges piliers, Quick Wins
│           ├── global-issues/                 # Accordéons consolidés All/Tech/Struct/Content
│           ├── subpages/                      # Table BFS 500 URLs, sélection piliers
│           ├── editorial-global/              # KPIs sémantiques, cannibalisation, table
│           └── geo-global/                    # KPIs GEO, statut llms.txt, citabilité
│
└── app/                                       # --- ROUTING NEXT.JS (APP ROUTER) ---
    ├── layout.tsx                             # Configuration globale (Thème zinc/jaune, Polices)
    ├── page.tsx                               # Redirection automatique vers /dashboard
    │
    ├── (agency)/                              # Scope 1 : Vue Agence (Sidebar Menu Principal)
    │   ├── layout.tsx                         # Intègre AgencySidebar
    │   ├── dashboard/
    │   │   └── page.tsx                       # [Écran 1] Tableau de bord & Lancement rapide
    │   └── projects/
    │       ├── page.tsx                       # [Écran 2] Mes Projets (Table globale & actions)
    │       └── [projectId]/
    │           └── manage/
    │               └── page.tsx               # Gestion du projet : Actualiser / Supprimer
    │
    ├── projects/[projectId]/                  # Scope 2 : Contexte Projet Actif (Sidebar Projet)
    │   ├── layout.tsx                         # Intègre ProjectSidebar + BreadcrumbNav + Sheet
    │   ├── overview/
    │   │   └── page.tsx                       # [Écran 3] Synthèse (Scores piliers, Quick Wins)
    │   ├── issues/
    │   │   └── page.tsx                       # [Écran 4] Global Issues (Consolidation déterministe)
    │   ├── subpages/
    │   │   └── page.tsx                       # [Écrans 5 & 8] Subpages (500 pages & sélection piliers)
    │   ├── editorial/
    │   │   └── page.tsx                       # [Écran 6] SEO Éditorial (Tableau de bord sémantique)
    │   └── geo/
    │       └── page.tsx                       # [Écran 7] GEO (Tableau de bord moteurs IA)
    │
    └── api/                                   # Points d'entrée HTTP (BFF / Contrôleurs)
        ├── audits/
        │   └── route.ts                       # POST : Initier un crawl (Redis/BullMQ)
        ├── projects/[projectId]/
        │   ├── ai-analysis/
        │   │   └── route.ts                   # POST : Déclencher analyse Claude 3.5 sur piliers
        │   ├── export/
        │   │   └── route.ts                   # GET : Génération du rapport PDF
        │   └── refresh/
        │       └── route.ts                   # POST : Écrasement et ré-audit
        └── webhooks/
            └── crawl-status/
                └── route.ts                   # Notifications d'avancement du worker
```

### **2\. Matrice de liaison : Navigation, Layouts et Composants**

L'architecture résout les transitions visibles sur la planche de maquettes en articulant la hiérarchie des layouts :

| Écran maquette | Route Next.js | Fil d'Ariane (Breadcrumb) | Sidebar Active | Sheet d'inspection (Tiroir droit) |
| :---- | :---- | :---- | :---- | :---- |
| **1\. Tableau de bord** | /dashboard | Accueil / Dashboard | Menu Principal (Tableau de bord) | Fermé |
| **2\. Mes Projets** | /projects | Accueil / Mes Projets | Menu Principal (Mes Projets) | Fermé |
| **Gestion Projet** | /projects/\[id\]/manage | Mes Projets / bighappy.fr | Menu Principal (Mes Projets) | Fermé |
| **3\. Synthèse**\[cite: 7, 11\] | /projects/\[id\]/overview | bighappy.fr / Synthèse | Résultat Projet (Synthèse) | Fermé |
| **4\. Global Issues**\[cite: 7, 11\] | /projects/\[id\]/issues | bighappy.fr / Global Issues | Résultat Projet (Global Issues) | Optionnel (au clic sur URL impactée) |
| **5 & 8\. Subpages**\[cite: 7, 11\] | /projects/\[id\]/subpages | bighappy.fr / Subpages | Résultat Projet (Subpages) | **Actif** : Onglet Technique & Meta\[cite: 3, 7, 11\] |
| **6\. SEO Éditorial**\[cite: 1, 7, 11\] | /projects/\[id\]/editorial | bighappy.fr / SEO Éditorial | Résultat Projet (SEO Éditorial) | **Actif** : Onglet SEO Éditorial (IA)\[cite: 2, 7, 11\] |
| **7\. GEO (IA)**\[cite: 6, 7, 11\] | /projects/\[id\]/geo | bighappy.fr / GEO | Résultat Projet (GEO) | **Actif** : Onglet GEO (IA)\[cite: 5, 7, 11\] |

### **3\. Gestion transversale du tiroir d'inspection (Sheet)**

Pour que le panneau latéral s'affiche par-dessus les écrans 5, 6 et 7 sans recharger la page tout en restant synchronisé avec l'URL (permettant le partage ou le retour arrière) :

1. **Persistance par Query Params :** L'ouverture est pilotée par l'URL :  
   ?inspect=page-uuid-123\&tab=editorial  
2. **Emplacement dans le layout :** Le composant SheetContainer est instancié une seule fois dans src/app/projects/\[projectId\]/layout.tsx. Il écoute le hook usePageInspection().  
3. **Condition de verrouillage :** Si la page inspectée n'a pas été sélectionnée comme page pilier (isPillar \=== false), les onglets SEO Éditorial et GEO restent affichés avec le composant de verrou (Lock \+ CTA de lancement), garantissant la protection des coûts API définie dans le cahier des charges.  
   * 

{  
  "\$schema": "https\://json.schemastore.org/project-structure.json",  
  "projectName": "seo-geo-saas-audit",  
  "version": "1.0.0",  
  "architecture": "hexagonal",  
  "framework": "nextjs-app-router",  
  "directories": {  
    "src/core/domain": {  
      "description": "Cœur métier pur sans dépendance externe",  
      "files": \[  
        "entities/project.entity.ts",  
        "entities/audit.entity.ts",  
        "entities/page.entity.ts",  
        "entities/global-issue.entity.ts",  
        "entities/scoring-rubric.entity.ts",  
        "value-objects/url.vo.ts",  
        "value-objects/http-status.vo.ts",  
        "value-objects/click-depth.vo.ts",  
        "value-objects/target-keyword.vo.ts",  
        "ports/in/start-crawl.port.ts",  
        "ports/in/launch-ai-analysis.port.ts",  
        "ports/in/get-project-overview.port.ts",  
        "ports/in/get-global-issues.port.ts",  
        "ports/in/get-subpages.port.ts",  
        "ports/in/get-editorial-dashboard.port.ts",  
        "ports/in/get-geo-dashboard.port.ts",  
        "ports/in/inspect-page.port.ts",  
        "ports/in/manage-project.port.ts",  
        "ports/out/project-repository.port.ts",  
        "ports/out/audit-repository.port.ts",  
        "ports/out/crawler.port.ts",  
        "ports/out/llm-analyzer.port.ts",  
        "ports/out/pagespeed.port.ts",  
        "ports/out/queue.port.ts",  
        "ports/out/pdf-exporter.port.ts"  
      \]  
    },  
    "src/core/application": {  
      "description": "Cas d'usage et orchestration du domaine",  
      "files": \[  
        "use-cases/start-new-audit.use-case.ts",  
        "use-cases/execute-ai-audit.use-case.ts",  
        "use-cases/calculate-scores.use-case.ts",  
        "use-cases/consolidate-issues.use-case.ts",  
        "use-cases/refresh-audit.use-case.ts",  
        "use-cases/delete-project.use-case.ts",  
        "dtos/project.dto.ts",  
        "dtos/audit-summary.dto.ts",  
        "dtos/page-inspection.dto.ts"  
      \]  
    },  
    "src/infrastructure": {  
      "description": "Adaptateurs secondaires (base de données, services tiers, worker)",  
      "files": \[  
        "persistence/prisma/schema.prisma",  
        "persistence/mappers/project.mapper.ts",  
        "persistence/mappers/audit.mapper.ts",  
        "persistence/repositories/prisma-project.repository.ts",  
        "persistence/repositories/prisma-audit.repository.ts",  
        "crawler/crawlee-cheerio.adapter.ts",  
        "crawler/html-parser.service.ts",  
        "llm/anthropic-claude.adapter.ts",  
        "llm/prompts/editorial-audit.prompt.ts",  
        "llm/prompts/geo-audit.prompt.ts",  
        "performance/pagespeed-mobile.adapter.ts",  
        "queue/bullmq-job.adapter.ts",  
        "queue/workers/crawl.worker.ts",  
        "pdf/react-pdf.adapter.ts"  
      \]  
    },  
    "src/presentation": {  
      "description": "Adaptateurs primaires UI (Composants React, State, Hooks)",  
      "files": \[  
        "hooks/use-page-inspection.ts",  
        "hooks/use-pillar-selection.ts",  
        "hooks/use-audit-stream.ts",  
        "stores/inspection-drawer.store.ts",  
        "components/layouts/agency-sidebar.tsx",  
        "components/layouts/project-sidebar.tsx",  
        "components/layouts/breadcrumb-nav.tsx",  
        "components/inspection-sheet/sheet-container.tsx",  
        "components/inspection-sheet/sheet-header.tsx",  
        "components/inspection-sheet/tabs/tech-tab.tsx",  
        "components/inspection-sheet/tabs/editorial-tab.tsx",  
        "components/inspection-sheet/tabs/geo-tab.tsx",  
        "components/inspection-sheet/widgets/radial-score-chart.tsx",  
        "components/inspection-sheet/widgets/score-progress-bar.tsx",  
        "components/inspection-sheet/widgets/todo-priority-list.tsx",  
        "components/inspection-sheet/widgets/ai-reasoning-box.tsx",  
        "components/shared/data-table.tsx",  
        "components/shared/badge-status.tsx",  
        "components/shared/accordion-section.tsx"  
      \]  
    },  
    "src/app": {  
      "description": "Routage Next.js (App Router) et layouts",  
      "files": \[  
        "layout.tsx",  
        "page.tsx",  
        "(agency)/layout.tsx",  
        "(agency)/dashboard/page.tsx",  
        "(agency)/projects/page.tsx",  
        "(agency)/projects/\[projectId\]/manage/page.tsx",  
        "projects/\[projectId\]/layout.tsx",  
        "projects/\[projectId\]/overview/page.tsx",  
        "projects/\[projectId\]/issues/page.tsx",  
        "projects/\[projectId\]/subpages/page.tsx",  
        "projects/\[projectId\]/editorial/page.tsx",  
        "projects/\[projectId\]/geo/page.tsx",  
        "api/audits/route.ts",  
        "api/projects/\[projectId\]/ai-analysis/route.ts",  
        "api/projects/\[projectId\]/export/route.ts",  
        "api/projects/\[projectId\]/refresh/route.ts",  
        "api/webhooks/crawl-status/route.ts"  
      \]  
    }  
  }  
}

\# Architecture Technique & Spécifications Métier

\#\# 1\. Principes Fondamentaux de Conception

L'application repose sur le pattern Ports et Adaptateurs (Architecture Hexagonale). L'objectif est d'isoler l'intelligence d'audit (algorithmes de scoring et heuristiques) de tout framework d'infrastructure.

\#\#\# Les Couches et leurs Règles de Dépendance

1\. \*\*\`src/core/domain/\` (Cœur Métier) :\*\*  
   \* \*\*Zéro dépendance :\*\* aucun framework externe n'est importé (pas de React, Next.js, Prisma ou Crawlee).  
   \* Contient les entités pures, les Value Objects (\`UrlVo\`, \`HttpStatusVo\`) et les interfaces de communication (\`ports/\`).

2\. \*\*\`src/core/application/\` (Cas d'Usage) :\*\*  
   \* Orchestre la logique métier.  
   \* Manipule les entités via les ports d'entrée (\`ports/in/\`) et délègue les opérations techniques aux ports de sortie (\`ports/out/\`).

3\. \*\*\`src/infrastructure/\` (Adaptateurs Secondaires / Driven) :\*\*  
   \* Implémente concrètement les interfaces définies dans \`ports/out/\`.  
   \* Gère la base PostgreSQL (Prisma), les queues Redis/BullMQ, le crawler Crawlee (Cheerio), le SDK Anthropic et l'API PageSpeed Insights.

4\. \*\*\`src/presentation/\` & \`src/app/\` (Adaptateurs Primaires / Driving) :\*\*  
   \* Interface utilisateur Next.js (App Router), composants Tailwind / shadcn/ui.  
   \* Déclenche les cas d'usage via les routes d'API internes (BFF).

\---

\#\# 2\. Invariants Métier Non Négociables

Tout code produit par un agent doit obligatoirement respecter ces quatre règles :

\* \*\*Règle du Zéro Historique (Écrasement Cascade) :\*\* un projet ne conserve qu'un seul audit actif à l'instant T. Toute relance d'audit supprime l'ancien rapport (\`onDelete: Cascade\` sur PostgreSQL) pour éviter le gonflement de la base.  
\* \*\*100 % Mobile-First :\*\* le crawler mobile de Crawlee et l'appel unique Google PageSpeed Insights s'exécutent avec un User-Agent smartphone. Aucun indicateur desktop ne doit exister dans le schéma ou l'UI.  
\* \*\*Workflow en Deux Temps :\*\*  
  1\. Crawl déterministe (500 pages max) \-\> Statut \`AWAITING\_AI\_SELECTION\`.  
  2\. Sélection manuelle de 10 à 20 pages piliers \-\> Analyse Claude 3.5 Sonnet \-\> Statut \`COMPLETED\`.  
\* \*\*Pénalité Bloquante :\*\* toute URL avec un code HTTP d'erreur (4xx/5xx) ou une balise \`noindex\` reçoit automatiquement la note 0 en SEO Éditorial et GEO.

\---

\#\# 3\. Matrice de Synchronisation UI & Navigation

\#\#\# Organisation des Layouts

\* \*\*Layout Agence (\`src/app/(agency)/layout.tsx\`) :\*\*  
  \* Sidebar : \`AgencySidebar\` (liens vers \*Tableau de bord\* et \*Mes Projets\*).  
\* \*\*Layout Projet (\`src/app/projects/\[projectId\]/layout.tsx\`) :\*\*  
  \* Sidebar : \`ProjectSidebar\` (liens contextuels : \*Synthèse\*, \*Global Issues\*, \*SEO Éditorial\*, \*GEO\*, \*Subpages\*).  
  \* En-tête : \`BreadcrumbNav\` (navigation hiérarchique).  
  \* Composant flottant : \`SheetContainer\` (le tiroir latéral d'inspection unitaire).

\#\#\# Gestion de l'Inspection Unitaire (Sheet)

Le tiroir latéral d'inspection unitaire doit pouvoir s'ouvrir depuis n'importe quelle vue sans perdre le contexte de la page courante :

\* \*\*Contrôle par Query Params :\*\* l'état du tiroir est synchronisé dans l'URL :  
  \`\`\`text  
  ?inspect=\[pageId\]\&tab=\[tech\|editorial\|geo\]  
