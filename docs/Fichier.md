# BIGAPP SEO & GEO — SPÉCIFICATIONS TECHNIQUES, ARCHITECTURE BACKEND ET MODÈLE DE SCORING EXHAUSTIF

> **Statut du document** : Document de référence absolu (Source of Truth) pour la conception et l'implémentation du backend d'audit SEO & GEO.  
> **Auteur** : Lead Software Architect & SEO Engineer  
> **Dernière mise à jour** : 2026-10-28  

---

## SOMMAIRE
1. [CAHIER DES CHARGES DES FONCTIONNALITÉS & INVARIANTS MÉTIER](#1-cahier-des-charges-des-fonctionnalités--invariants-métier)
2. [ARCHITECTURE TECHNIQUE DU PROJET (HEXAGONALE / CLEAN ARCHITECTURE)](#2-architecture-technique-du-projet-hexagonale--clean-architecture)
3. [STACK TECHNIQUE & INFRASTRUCTURE RETENUE](#3-stack-technique--infrastructure-retenue)
4. [CARTOGRAPHIE DES MÉTRIQUES, SCORING & GUIDES DE RÉSOLUTION ACTIONNABLES](#4-cartographie-des-métriques-scoring--guides-de-résolution-actionnables)
   - [4.1 Pilier Technique (100 Pts — Déterministe / Robot)](#41-pilier-technique-100-pts--déterministe--robot)
   - [4.2 Pilier Éditorial (100 Pts — IA Sémantique / LLM)](#42-pilier-éditorial-100-pts--ia-sémantique--llm)
   - [4.3 Pilier GEO — Generative Engine Optimization (100 Pts — IA / Robot)](#43-pilier-geo--generative-engine-optimization-100-pts--ia--robot)
   - [4.4 Calcul des Scores Globaux (Page & Projet)](#44-calcul-des-scores-globaux-page--projet)
5. [SCHÉMA DE DONNÉES RELATIONNEL (POSTGRESQL & PRISMA)](#5-schéma-de-données-relationnel-postgresql--prisma)
6. [PIPELINE D'EXÉCUTION & WORKERS ASYNCHRONES (BULLMQ + REDIS)](#6-pipeline-dexécution--workers-asynchrones-bullmq--redis)
7. [STRUCTURE DES PROMPTS IA & CONTRATS ZOD](#7-structure-des-prompts-ia--contrats-zod)
8. [SKILLS & ADAPTERS RECOMMANDÉS POUR LA CONSTRUCTION DU BACKEND](#8-skills--adapters-recommandés-pour-la-construction-du-backend)

---

## 1. CAHIER DES CHARGES DES FONCTIONNALITÉS & INVARIANTS MÉTIER

### 1.1 Invariants Métier Non-Négociables

1. **Architecture Hexagonale Stricte** :
   - Le noyau de domaine (`src/core/domain/`) est 100% pur : aucune importation de Prisma, BullMQ, Crawlee, Cheerio ou React.
   - Les moteurs de calcul de scores et de génération d'anomalies sont des fonctions pures et déterministes, testables unitairement sans base de données ni réseau.

2. **Politique du Zéro-Historique ("Cascade Overwrite")** :
   - Chaque projet ne conserve en base qu'**un seul audit actif à un instant T**.
   - Lorsqu'un utilisateur relance un audit sur un projet existant, la totalité des données du crawl précédent (pages, métriques brutes, anomalies détectées, scores, prompts d'évaluation) est supprimée de manière atomique en cascade via PostgreSQL (`onDelete: Cascade`), puis remplacée par le nouvel audit.

3. **100% Mobile-First Impératif** :
   - Le crawleur se fait passer pour **Googlebot Smartphone** :
     `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`
   - Les audits de performance Google PageSpeed Insights sont interrogés **exclusivement avec la stratégie mobile** (`strategy=mobile`). Aucun score desktop n'est calculé ni affiché.

4. **Cycle de Vie en 2 Phases avec Intervention Humaine** :
   - **Phase 1 (Automatisée - Robot)** : Crawl local BFS (Breadth-First Search) plafonné à **500 pages maximum**. Calcul immédiat de l'arbre d'exploration, des liens internes, des codes HTTP, du balisage DOM et des scores techniques. L'audit passe alors au statut `AWAITING_AI_SELECTION`.
   - **Phase 2 (Semi-Automatisée - IA)** : Le consultant sélectionne manuellement **de 1 à `maxAiPages` pages piliers** (réglage de la page Paramètres, 20 par défaut) dans l'interface Subpages. Dès confirmation, l'audit passe en `ANALYZING_AI` et l'évaluation éditoriale est exécutée en arrière-plan, page par page (3 pages en parallèle) : voir §4.2.bis. Le modèle Gemini est configurable (`GEMINI_MODEL`, défaut `gemini-3.8-flash`, palier gratuit de Google AI Studio) ; sans clé `GEMINI_API_KEY`, l'analyse retombe sur l'heuristique locale. L'audit passe ensuite au statut `COMPLETED`. Le GEO reste, à ce stade, un calcul heuristique.

5. **Protection Stricte des Coûts API LLM & Gating Visuel** :
   - L'analyse IA (modèle Gemini) est **strictement réservée aux pages piliers** (`isPillar: true`).
   - Par page, l'IA ne reçoit que le Title, la méta description, les Hn et les 1 000 premiers mots (compromis tokens). Une analyse n'est pas relancée tant que le contenu et la requête manuelle n'ont pas changé (hash `analyzedHash`).
   - Pour toute page standard non sélectionnée, aucun appel LLM n'est émis. Sur l'interface, les onglets Éditorial et GEO de ces pages affichent un cadenas d'accès verrouillé invitant à promouvoir la page en page pilier.

6. **Pénalité Bloquante (Blocking Penalty)** :
   - Si une page retourne un code d'erreur HTTP **4xx / 5xx** ou comporte une balise `<meta name="robots" content="noindex">`, ses scores Éditorial et GEO sont **automatiquement fixés à 0/100**, et son score technique est plafonné à un maximum de 20/100.

---

### 1.2 Machine à États de l'Audit (`AuditStatus`)

```
   [ IDLE ]
      │
      ▼ (Lancement de l'audit depuis Dashboard ou Projets)
  [ QUEUED ] ── (Prise en charge par le Worker Crawl)
      │
      ▼
 [ CRAWLING_TECH ] ── (Extraction Crawlee + Calcul scoring technique)
      │
      ▼
 [ AWAITING_AI_SELECTION ] ── (Consultant sélectionne 10-20 pages piliers)
      │
      ▼
 [ ANALYZING_AI ] ── (Passerelle SDK Google GenAI / Gemini, une requête par page pilier)
      │
      ├──▶ [ COMPLETED ] (Calcul du score consolidé, audit finalisé)
      │
      └──▶ [ FAILED ] (Erreur critique DNS, timeout ou indisponibilité hôte)
```

---

## 2. ARCHITECTURE TECHNIQUE DU PROJET (HEXAGONALE / CLEAN ARCHITECTURE)

L'architecture isole les règles métier des technologies de persistance, de scraping et de modèles de langage.

```
/src
├── /core
│   ├── /domain                     # 100% PURE LOGIC (Zéro dépendance externe)
│   │   ├── /entities
│   │   │   ├── Project.ts          # Agrégat Projet
│   │   │   ├── Audit.ts            # Entité Audit unique & machine à états
│   │   │   ├── Page.ts             # Entité Page & métadonnées
│   │   │   ├── Issue.ts            # Anomalies catégorisées (Tech, Edito, GEO)
│   │   │   └── Metric.ts           # Métriques numériques & qualitatives
│   │   ├── /value-objects
│   │   │   ├── Url.ts              # Normalisation canonique, protocoles, trailing slash
│   │   │   ├── HttpStatus.ts       # Règles 2xx, 3xx, 4xx, 5xx
│   │   │   ├── CrawlDepth.ts       # Profondeur de clic (0 à N)
│   │   │   ├── CoreWebVitals.ts    # LCP, INP, CLS & diagnostics
│   │   │   └── PillarType.ts       # TECH, EDITORIAL, GEO
│   │   └── /scoring                # MOTEURS DE CALCUL DÉTERMINISTES
│   │       ├── TechScoringEngine.ts
│   │       ├── EditorialScoringEngine.ts
│   │       ├── GeoScoringEngine.ts
│   │       └── GlobalScoringEngine.ts
│   │       └── RecommendationsEngine.ts # Génération des commentaires & résolutions
│   │
│   └── /application                # USE CASES & INTERFACES (Ports)
│       ├── /ports
│       │   ├── /in                 # Primary / Inbound Ports
│       │   │   ├── StartCrawlPort.ts
│       │   │   ├── SelectPillarsPort.ts
│       │   │   ├── TriggerAiAnalysisPort.ts
│       │   └── /out                # Secondary / Outbound Ports
│       │       ├── AuditRepositoryPort.ts
│       │       ├── CrawlerEnginePort.ts
│       │       ├── AiAnalysisGatewayPort.ts
│       │       ├── SpeedTestPort.ts
│       │       └── JobQueuePort.ts
│       └── /use-cases
│           ├── StartAuditUseCase.ts
│           ├── ProcessCrawledPageUseCase.ts
│           ├── SelectPillarPagesUseCase.ts
│           ├── RunAiBatchAnalysisUseCase.ts
│           └── FinalizeAuditUseCase.ts
│
├── /infrastructure                 # ADAPTERS CONCRETS
│   ├── /database
│   │   ├── prisma.ts               # Client Prisma instancié
│   │   └── /repositories
│   │       └── PrismaAuditRepository.ts
│   ├── /crawler
│   │   ├── CrawleeEngineAdapter.ts # CheerioCrawler configuré Mobile Googlebot
│   │   └── PageExtractor.ts        # Extraction DOM Cheerio (Hn, Title, Meta, Links)
│   ├── /ai
│   │   ├── VercelAiGatewayAdapter.ts # Claude 3.5 Sonnet + schéma Zod
│   │   └── PromptsRegistry.ts      # Définition des prompts système Zod
│   ├── /speed
│   │   └── PageSpeedInsightsAdapter.ts # Client API REST Google PSI Mobile
│   └── /queue
│       ├── BullMqJobQueueAdapter.ts# Définition des queues & workers Redis
│       ├── /workers
│       │   ├── CrawlWorker.ts      # Exécute l'extraction Phase 1
│       │   └── AiAnalysisWorker.ts # Exécute le batch Claude Phase 2
│       └── /events
│           └── AuditEventsEmitter.ts # Diffusion SSE vers le front-end
│
└── /presentation                   # Next.js API Routes & Front-end Integration
    └── /api
        ├── /projects/route.ts
        ├── /audits/[auditId]/crawl/route.ts
        ├── /audits/[auditId]/pillars/route.ts
        ├── /audits/[auditId]/ai-analysis/route.ts
        └── /audits/[auditId]/stream/route.ts # Server-Sent Events (SSE)
```

---

## 3. STACK TECHNIQUE & INFRASTRUCTURE RETENUE

| Rôle | Technologie | Rationale & Justification |
| :--- | :--- | :--- |
| **Runtime & Langage** | **Node.js 20+ LTS / TypeScript 5.7+** | Typage strict de bout en bout avec le front-end Next.js 16. |
| **Base de Données** | **PostgreSQL 16** | Robustesse relationnelle, gestion native des cascades, index JSONB et scalabilité. |
| **ORM** | **Prisma ORM 6.x** | Sécurité de type, migrations versionnées (`prisma migrate`), cascade explicite (`onDelete: Cascade`). |
| **Orchestration / Queues** | **BullMQ 5.x + Redis 7** | Gestion des jobs asynchrones, reprise sur incident, limitation de débit (rate limiting) pour respecter les serveurs cibles et quotas API. |
| **Moteur de Crawl** | **Crawlee (CheerioCrawler)** | Rapidité d'exécution (10 à 50x plus rapide qu'un navigateur lourd headless), respect du User-Agent Googlebot Mobile, gestion intégrée des files de requêtes. |
| **Parsing HTML / DOM** | **Cheerio 1.0 + htmlparser2** | Sélection CSS performante, analyse de l'arborescence DOM, extraction des entités et microdonnées. |
| **Passerelle IA** | **Fournisseurs enchaînés** : endpoint compatible OpenAI puis Google Gemini | `src/adapters/secondary/llm/llm-gateway.ts` orchestre des fournisseurs (`gemini-provider.ts` avec `@google/genai`, `openai-compatible-provider.ts` en `fetch` pur vers `LLM_BASE_URL/chat/completions`, compatible OmniRoute, OpenRouter, LiteLLM, Ollama…). Ordre par défaut : OpenAI-compatible (si `LLM_BASE_URL` et `LLM_MODEL` sont définis) puis Gemini (`GEMINI_API_KEY`), modifiable par `LLM_PROVIDERS`. Chaque fournisseur enchaîne ses propres modèles de repli. Sortie JSON imposée par schéma (repli sur le mode `json_object` si l'endpoint refuse `json_schema`), validée par Zod. Un fournisseur en échec ou une réponse invalide fait passer au suivant ; si tous échouent, repli heuristique pour la page. Le fournisseur et le modèle utilisés sont enregistrés dans `analyzedBy`. |
| **Données de recherche** | **Google Autocomplete** (`suggestqueries.google.com`) | Vraies requêtes d'internautes, sans clé API, endpoint non documenté (échec = liste vide). Adaptateur `src/adapters/secondary/search-data/google-autocomplete.ts`. |
| **Performance Web** | **Google PageSpeed Insights REST API** | Métriques Core Web Vitals lab & field réelles (LCP, INP, CLS) avec profil d'émulation Mobile 4G. |
| **Temps Réel UI** | **Server-Sent Events (SSE)** | Flux uni-directionnel natif HTTP/2 permettant à la barre de progression front-end de refléter le statut du crawl et de l'IA en temps réel. |

---

## 4. CARTOGRAPHIE DES MÉTRIQUES, SCORING & GUIDES DE RÉSOLUTION ACTIONNABLES

Chaque critère est défini par son **barème**, sa **méthode de mesure**, sa **sévérité en cas d'échec**, son **commentaire pédagogique explicatif**, et sa **résolution étape par étape** directement exploitable par l'utilisateur.

---

### 4.1 Pilier Technique (100 Pts — Déterministe / Robot)

> **Règles de fiabilité du pilier technique (implémentation actuelle).**
> - **Critères mesurés ou exclus.** Core Web Vitals (25 pts, PageSpeed Insights mobile pour l'accueil et les pages les plus liées, clé `PAGESPEED_API_KEY`, `PSI_MAX_PAGES`), présence au sitemap (5 pts, lecture des sitemaps déclarés ou usuels) et blocage robots.txt par URL (5 pts, règles de Google) sont mesurés. Tout critère non mesurable (page non mesurée, INP indisponible faute de trafic réel, robots.txt injoignable, aucun sitemap) n'est jamais crédité de points fictifs : il sort du dénominateur et le score reste ramené sur 100 (`TechScoreResult.unmeasuredPoints`). Côté GEO, la cohérence NAP (15 pts) suit la même règle quand aucune coordonnée n'est trouvée sur le site.
> - **Crawl et graphe de liens.** Liens suivis jusqu'à 6 clics (`MAX_CRAWL_DEPTH`), puis pages du sitemap non atteintes (`discoveredVia: 'sitemap'`, profondeur -1), dans la limite de `CRAWL_MAX_PAGES` (150 par défaut). `linkGraphComplete` vaut false si la limite a coupé le parcours : un compte de liens entrants inférieur à 3 sort alors du score. Une page du sitemap qu'aucun lien n'atteint, sur un graphe complet, est `ORPHAN_PAGE`. Redirections suivies une à une (`redirect: 'manual'`) : `redirectHops` et `redirectStatuses` sont réels, ce qui rend mesurables les critères « code HTTP » et « chaîne de redirections ».
> - **Couverture et moyennes.** Chaque page garde ses points mesurés (`metricsRaw.techMeasuredPoints`, `EditorialEvaluation.coverage`, 85 ou 100 en GEO) ; le tiroir affiche « calculé sur X des 100 points », et `GlobalScoringEngine.computeProjectScore` pondère les moyennes du projet par ces points.
> - **Canonique et redirections.** Canonique vers une autre URL : 0 pt et `CANONICAL_ELSEWHERE` (plus grave qu'une canonique absente, 3 pts). Une redirection unique ne coûte des points que dans « Code HTTP » ; la chaîne ne pénalise qu'à partir de 2 sauts.
> - **Pages en erreur.** Une page 4xx/5xx ne remonte que son anomalie `HTTP_xxx` : pas d'anomalie éditoriale ni GEO en cascade.
> - **Hiérarchie Hn hors score.** Les sauts de niveau (H2 vers H4) restent signalés (`HEADING_HIERARCHY_SKIP`, `INFO`), mais leurs 7 pts sortent du dénominateur au lieu d'être accordés d'office : Google ne classe pas selon cet ordre.
> - **Moyenne du projet.** Les pages en `noindex` volontaire (sans erreur HTTP) sont exclues de la moyenne technique (`excludedFromTechAverage` dans `GlobalScoringEngine.computeProjectScore`) : une page de mentions légales ou de remerciement ne doit pas tirer le score vers le bas. Les pages en erreur 4xx/5xx restent comptées.
> - **Seuils uniques.** `src/core/domain/scoring/thresholds.ts` est partagé par le moteur de scoring et par le tiroir d'inspection : une anomalie de la To-Do et son accordéon ne peuvent pas se contredire. Les statuts des accordéons Titres, Title et méta reprennent les anomalies du moteur. Seuils : H1 de 10 à 70 caractères, Title de 30 à 65, méta description de 110 à 165.
> - **H1.** Un H1 unique non vide mais hors longueur donne `H1_LENGTH_UNOPTIMIZED` (`WARNING`, 5 pts sur 8) ; `MISSING_H1` est réservé à un H1 réellement absent ou vide.
> - **Page injoignable.** Un timeout, une erreur DNS ou une connexion refusée donne une seule anomalie `FETCH_FAILED` (`CRITICAL`, score 0), sans cascade de fausses alertes (H1, title, images…).
> - **Maillage.** La page d'accueil (profondeur 0) n'est jamais jugée orpheline. Les liens entrants sont comptés parmi les pages explorées par le crawl, plafonné à 50 pages : les textes d'anomalie le précisent.
> - **Codes HTTP.** Tous les codes 2xx sont valides ; les autres codes 3xx sont signalés comme redirections.
> - **Détail des indicateurs.** Les images (source, texte alt), les liens sortants (ancre, type interne ou externe, nofollow) et les pages sources des liens entrants sont stockés par page (`metricsRaw.images`, `links`, `inlinkSources`, plafonnés à 60 images et 150 liens) et consultables dans le tiroir d'inspection, les tableaux d'anomalies et la fiche PDF.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PILIER TECHNIQUE — 100 POINTS                        │
├──────────────────────────────┬────────┬────────────────────────────────┤
│ SOUS-CATÉGORIE               │ POINTS │ MÉTHODE DE COLLECTE            │
├──────────────────────────────┼────────┼────────────────────────────────┤
│ 1. Core Web Vitals           │ 25 pts │ Google PageSpeed Insights (PSI)│
│ 2. Architecture & Maillage   │ 20 pts │ Arbre de crawl BFS (Cheerio)   │
│ 3. Crawlabilité & Indexation │ 15 pts │ Headers HTTP + Balises DOM     │
│ 4. Sécurité & Codes HTTP     │ 15 pts │ Requête HTTP / Socket TLS      │
│ 5. Structure HTML (H1)       │ 8 pts  │ Parseur DOM Cheerio (Hn : 7 pts│
│    + hiérarchie Hn hors score│        │ exclus du dénominateur)        │
│ 6. Métadonnées & Médias      │ 10 pts │ Parseur DOM Cheerio            │
└──────────────────────────────┴────────┴────────────────────────────────┘
```

#### 1. Core Web Vitals (25 Pts) — Collecte : Google PageSpeed Insights Mobile

##### A. Largest Contentful Paint (LCP) — 10 pts
- **Barème** : $\le 2.5\text{s}$ : **10 pts** | $2.5\text{s} < \text{LCP} \le 4.0\text{s}$ : **5 pts** | $> 4.0\text{s}$ : **0 pt**
- **Sévérité si dégradé** : `CRITICAL` si $> 4.0\text{s}$, `WARNING` si $> 2.5\text{s}$.
- **Commentaire affiché** :
  > *"Le temps de chargement du plus grand élément visible (LCP) est trop élevé ({valeur}s). L'utilisateur attend plus de 2,5s avant de voir le contenu principal sur mobile, ce qui dégrade l'expérience et déclenche une pénalité d'algorithme Google Page Experience."*
- **Résolution étape par étape** :
  1. Compresser et convertir l'image héro au format moderne WebP ou AVIF.
  2. Ajouter l'attribut `fetchpriority="high"` et un `<link rel="preload" as="image" href="...">` dans le `<head>` sur l'élément LCP.
  3. Éliminer les ressources CSS/JS bloquant le rendu initial et activer la mise en cache HTTP / CDN (Cloudflare/Fastly).

##### B. Interaction to Next Paint (INP) — 8 pts
- **Barème** : $\le 200\text{ms}$ : **8 pts** | $200\text{ms} < \text{INP} \le 500\text{ms}$ : **4 pts** | $> 500\text{ms}$ : **0 pt**
- **Sévérité si dégradé** : `WARNING`.
- **Commentaire affiché** :
  > *"La réactivité aux interactions utilisateur est lente ({valeur}ms). Un délai perceptible bloque l'interface lors des clics ou tapotements sur mobile, créant une sensation de freeze."*
- **Résolution étape par étape** :
  1. Découper les tâches JavaScript longues (Long Tasks $> 50\text{ms}$) via `scheduler.yield()` ou `setTimeout()`.
  2. Déporter les calculs lourds ou scripts tiers non essentiels (trackers, chats) en asynchrone (`defer`, `async` ou Web Workers).
  3. Réduire la taille des bundles JavaScript et reporter l'hydratation des composants interactifs sous la ligne de flottaison.

##### C. Cumulative Layout Shift (CLS) — 7 pts
- **Barème** : $\le 0.1$ : **7 pts** | $0.1 < \text{CLS} \le 0.25$ : **3 pts** | $> 0.25$ : **0 pt**
- **Sévérité si dégradé** : `WARNING`.
- **Commentaire affiché** :
  > *"La page subit des sauts visuels inopinés lors du chargement (score CLS : {valeur}). Les éléments se déplacent pendant que l'utilisateur lit, risquant des clics erronés."*
- **Résolution étape par étape** :
  1. Définir impérativement les attributs `width` et `height` (ou la propriété CSS `aspect-ratio`) sur toutes les balises `<img>`, `<video>` et `<iframe>`.
  2. Réserver un conteneur dimensionné avec `min-height` pour les bannières publicitaires et widgets dynamiques injectés.
  3. Utiliser `font-display: swap` avec des polices de secours métriquement ajustées pour éviter le FOUT/FOIT.

---

#### 2. Architecture & Maillage Interne (20 Pts) — Collecte : BFS Graph Crawlee

##### A. Profondeur de Clic (Click Depth) — 10 pts
- **Barème** : $\le 3$ clics : **10 pts** | $4$ clics : **5 pts** | $\ge 5$ clics : **0 pt**
- **Sévérité si dégradé** : `WARNING`.
- **Commentaire affiché** :
  > *"Cette page est enfouie à {valeur} clics de la page d'accueil. Googlebot dilue son crawl budget et accorde un PageRank interne très faible aux pages situées au-delà de 3 clics."*
- **Résolution étape par étape** :
  1. Ajouter un lien vers cette page dans le menu de navigation principal (Mega Menu) ou le footer thématique.
  2. Créer un maillage contextuel transversal depuis d'autres articles ou pages de catégorie de niveau 1 ou 2.
  3. Ajouter un fil d'Ariane (*Breadcrumb*) conforme Schéma.org pour raccourcir le chemin d'accès.

##### B. Connexité & Pages Orphelines — 10 pts
- **Barème** : $\ge 3$ liens entrants internes : **10 pts** | $1$ à $2$ liens : **5 pts** | $0$ lien entrant (Page orpheline) : **0 pt**
- **Sévérité si dégradé** : `CRITICAL` si 0 lien entrant, sinon `WARNING`.
- **Commentaire affiché** :
  > *"Page orpheline ou sous-maillée : cette URL ne reçoit que {valeur} lien(s) interne(s) sur l'ensemble du site. Les robots d'indexation risquent de la désindexer faute de flux de popularité."*
- **Résolution étape par étape** :
  1. Insérer au minimum 3 liens contextuels ancrés naturellement dans des pages thématiquement proches.
  2. Éviter les ancres génériques ("cliquez ici", "en savoir plus") au profit d'ancres descriptives intégrant la requête cible.
  3. Vérifier que la page est bien inscrite dans le fichier `sitemap.xml`.

---

#### 3. Crawlabilité & Indexation (15 Pts) — Collecte : Headers HTTP & Balises DOM

##### A. Autorisation `robots.txt` — 5 pts
- **Barème** : Autorisée : **5 pts** | Bloquée par règle `Disallow` : **0 pt**
- **Sévérité si dégradé** : `CRITICAL`.
- **Commentaire affiché** :
  > *"L'accès à cette URL est formellement interdit à Googlebot par une directive `Disallow` dans le fichier `robots.txt`."*
- **Résolution étape par étape** :
  1. Éditer le fichier `robots.txt` à la racine de votre hébergement.
  2. Supprimer la règle bloquante correspondant au répertoire ou à l'expression régulière concernée.
  3. Tester la validation dans l'outil d'inspection d'URL de Google Search Console.

##### B. Présence dans le Sitemap XML — 5 pts
- **Barème** : Présente dans sitemap : **5 pts** | Accessible au crawl mais absente du sitemap : **2 pts** | Déclarée mais en 404 : **0 pt**
- **Sévérité si dégradé** : `INFO`.
- **Commentaire affiché** :
  > *"Cette page canonique valide n'est pas répertoriée dans vos fichiers sitemap XML déclarés."*
- **Résolution étape par étape** :
  1. Régénérer votre sitemap dynamique pour y intégrer cette URL avec sa balise `<lastmod>` à jour.
  2. Vous assurer que seules les URLs répondant en HTTP 200 et indexables figurent au sitemap.

##### C. Balise Canonique (`rel="canonical"`) — 5 pts
- **Barème** : Présente, absolue et valide : **5 pts** | Absente : **2 pts** | Pointant vers une 4xx ou contradictoire : **0 pt**
- **Sévérité si dégradé** : `CRITICAL` si 4xx ou contradictoire, `WARNING` si absente.
- **Commentaire affiché** :
  > *"La balise canonique est absente ou pointe vers une URL invalide ({valeur}). Risque majeur de contenu dupliqué ou d'exclusion de l'index."*
- **Résolution étape par étape** :
  1. Ajouter dans le `<head>` : `<link rel="canonical" href="https://domaine.com/chemin-propre" />`.
  2. Utiliser impérativement une URL absolue (avec protocole `https://` et sans paramètres d'URL de tracking `utm_`).

---

#### 4. Sécurité & Codes HTTP (15 Pts) — Collecte : Client HTTP Fetch

##### A. Certificat SSL & HTTPS — 5 pts
- **Barème** : HTTPS actif et valide : **5 pts** | HTTP non sécurisé ou certificat expiré : **0 pt**
- **Sévérité si dégradé** : `CRITICAL`.
- **Commentaire affiché** :
  > *"La page n'est pas servie sous un protocole HTTPS valide et sécurisé. Les navigateurs affichent un avertissement de sécurité 'Non sécurisé'."*
- **Résolution étape par étape** :
  1. Installer ou renouveler un certificat SSL/TLS (ex: Let's Encrypt gratuit).
  2. Forcer la redirection permanente 301 de l'ensemble du trafic HTTP vers HTTPS au niveau serveur (Nginx/Apache/Vercel).

##### B. Code de Réponse HTTP — 5 pts
- **Barème** : HTTP 200 : **5 pts** | Redirection 301/308 : **3 pts** | Redirection temporaire 302 : **1 pt** | Erreur 4xx ou 5xx : **0 pt** *(Pénalité bloquante active)*
- **Sévérité si dégradé** : `CRITICAL`.
- **Commentaire affiché** :
  > *"La page renvoie un code d'erreur HTTP {status}. Le contenu est inaccessible pour les internautes et les moteurs de recherche."*
- **Résolution étape par étape** :
  1. Si 404 : Restaurer la page ou mettre en place une redirection 301 vers l'équivalent le plus proche.
  2. Si 500 : Corriger l'exception applicative ou l'erreur de base de données dans vos logs serveur.

##### C. Chaînes et Boucles de Redirection — 5 pts
- **Barème** : 0 saut (Direct) : **5 pts** | 1 saut propre (301) : **3 pts** | $\ge 2$ sauts ou boucle infinie : **0 pt**
- **Sévérité si dégradé** : `WARNING` (si 2 sauts), `CRITICAL` (si boucle).
- **Commentaire affiché** :
  > *"L'accès à l'URL génère une chaîne de {valeur} redirections successives. Cela consomme inutilement le crawl budget et ralentit le TTFB."*
- **Résolution étape par étape** :
  1. Pointer directement tous les liens internes vers l'URL finale canonique en HTTP 200.
  2. Réécrire les règles `.htaccess` ou de routing pour faire correspondre l'ancienne URL directement à la destination finale (1 seul bond).

---

#### 5. Structure HTML & Hiérarchie des Titres (8 Pts notés) — Collecte : Cheerio DOM

##### A. Balise `<h1>` Unique et Conforme — 8 pts
- **Barème** : Exactement un `<h1>` pertinent : **8 pts** | Multiples `<h1>` : **3 pts** | Aucun `<h1>` ou vide : **0 pt**
- **Sévérité si dégradé** : `CRITICAL` si absent, `WARNING` si multiple.
- **Commentaire affiché** :
  > *"{diagnostic : Aucun H1 détecté / Plusieurs balises H1 détectées ({count})}. Le titre H1 doit être l'indicateur thématique suprême de la page."*
- **Résolution étape par étape** :
  1. Conserver un seul et unique `<h1>` par document HTML, placé en haut du corps principal (`main`).
  2. Formuler un H1 concis (entre 15 et 65 caractères) contenant le mot-clé principal de la page.
  3. Rétrograder les autres éléments stylés en H1 vers des balises `<h2>` ou de simples classes CSS de présentation.

##### B. Hiérarchie des Sous-Titres (H2 à H6) — hors score
- **Barème** : aucun point. Les 7 pts sont exclus du dénominateur (le score reste ramené sur 100), car Google ne classe pas selon l'ordre des titres ; l'anomalie reste utile pour l'accessibilité.
- **Sévérité si dégradé** : `INFO`.
- **Commentaire affiché** :
  > *"Saut de hiérarchie détecté dans l'arborescence des titres (ex: passage direct de H2 à H4). Cela perturbe la segmentation algorithmique du contenu."*
- **Résolution étape par étape** :
  1. Structurer le contenu de façon descendante : H1 $\rightarrow$ H2 $\rightarrow$ H3 $\rightarrow$ H4.
  2. Ne jamais choisir un niveau de titre pour son apparence visuelle (utiliser des classes utilitaires Tailwind comme `text-lg font-bold`).

---

#### 6. Balisage, Métadonnées & Médias (10 Pts) — Collecte : Cheerio DOM

##### A. Optimisation Title & Meta Description — 5 pts
- **Barème** : Title et Description calibrés et uniques : **5 pts** | Présents mais non calibrés : **3 pts** | Absents : **0 pt**
- **Sévérité si dégradé** : `CRITICAL` si Title absent, sinon `WARNING`.
- **Commentaire affiché** :
  > *"La balise `<title>` ({titleLength} car.) ou la méta description ({descLength} car.) est manquante ou hors gabarit standard, risquant d'être tronquée dans la SERP."*
- **Résolution étape par étape** :
  1. Rédiger une balise `<title>` percutante comprise entre 45 et 60 caractères incluant la proposition de valeur et le mot-clé.
  2. Rédiger une `<meta name="description">` incitative de 130 à 155 caractères avec un appel à l'action clair.

##### B. Attributs `alt` sur les Images — 5 pts
- **Barème** : $\ge 90\%$ d'images avec `alt` : **5 pts** | Entre $70\%$ et $89\%$ : **3 pts** | $< 70\%$ : **0 pt**
- **Sévérité si dégradé** : `WARNING`.
- **Commentaire affiché** :
  > *"{missingCount} image(s) ne possèdent aucun texte alternatif (`alt`). Google Images et les lecteurs d'écran pour malvoyants ne peuvent pas interpréter vos visuels."*
- **Résolution étape par étape** :
  1. Renseigner un attribut `alt="Description textuelle du visuel"` explicite pour chaque image de contenu.
  2. Pour les images purement décoratives, renseigner un attribut vide `alt=""` ou `aria-hidden="true"`.

---

### 4.2 Pilier Éditorial (100 Pts — IA Sémantique / LLM)

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PILIER ÉDITORIAL — 100 POINTS                        │
├──────────────────────────────┬────────┬────────────────────────────────┤
│ CRITÈRE SÉMANTIQUE           │ POINTS │ ÉVALUATION                     │
├──────────────────────────────┼────────┼────────────────────────────────┤
│ 1. Intent Match              │ 20 pts │ Alignement intention vs requête│
│ 2. Absence de Cannibalisation│ 20 pts │ Unicité du ciblage intra-site  │
│ 3. Zones Chaudes SEO         │ 15 pts │ Title, début du contenu, H2/H3 │
│ 4. Contenu Primaire & TL;DR  │ 15 pts │ Réponse directe d'entrée       │
│ 5. Richesse Sémantique & EEAT│ 20 pts │ Entités métier & couverture    │
│ 6. Signaux de Confiance      │ 10 pts │ Articles seulement (sans objet │
│                              │        │ ailleurs, hors dénominateur)   │
│ (Lisibilité : diagnostic)    │ 0 pt   │ Hors score, voir §4.2.ter      │
└──────────────────────────────┴────────┴────────────────────────────────┘
```

> **Requête cible et biais.** `EditorialScoringEngine.withMeasurements` classe la requête : `MANUAL` (saisie), `CONFIRMED` (déduite, mais la requête exacte ou quasi identique est proposée par Google Autocomplete, vérifiée par `GoogleAutocomplete.fetchExact` et `isSameQuery`, ou la page est réellement trouvée dans la SERP mesurée sur exactement la même requête) ou `INFERRED`. Une SERP lancée sans trouver la page ne confirme rien, et une mesure faite sur « requête + ville » ne confirme pas la requête sans ville. Une requête `INFERRED` exclut l'intention et les zones chaudes (35 pts) du dénominateur : juger une page sur une requête tirée d'elle-même gonflerait le score. La même fonction remplace l'estimation de cannibalisation par la mesure SERP quand elle existe ; `AuditService.rescoreEditorial` recalcule le score sans IA après chaque relevé SERP terminé.

> **Mesure de la variabilité.** `scripts/llm-variability.ts` (`npm run variability -- site.fr [analyses] [piliers]`) relance l'analyse des piliers sans rien enregistrer et affiche l'écart par critère. Chaque appel porte un identifiant unique (`EditorialAnalysisInput.nonce`, commentaire ajouté au message, sans effet sur l'analyse) pour exclure tout cache ; le cache de l'application n'est pas en jeu (le script appelle `llmGateway.evaluateEditorial` directement). Résultats datés : section 5 de `docs/tableau-metriques.md`.

> **Stabilité du scoring IA.** Température 0 sur les deux fournisseurs (`openai-compatible-provider.ts`, `gemini-provider.ts`), barèmes à paliers décrits dans le prompt (le modèle choisit le palier le plus proche), et cache par empreinte du contenu, de la requête saisie, de la version du prompt (`EDITORIAL_PROMPT_VERSION`) et du modèle principal (`analyzedHash`, `llmGateway.cacheKey()`) : une page inchangée n'est pas ré-analysée. L'origine de chaque analyse (IA ou heuristique locale) est stockée (`editorialStatus.engine`) et affichée.

#### 1. Search Intent Match (20 Pts)
- **Barème** : réponse exacte (20 pts) | écart mineur de format ou d'angle (15 pts) | réponse partielle (10 pts) | traitée à la marge (5 pts) | hors sujet (0 pt)
- **Commentaire affiché** :
  > *"Le contenu ne répond pas directement à l'intention sous-jacente de l'internaute (Intention détectée : {detectedIntent}). Un utilisateur recherchant une solution concrète se retrouve face à un argumentaire commercial verbeux."*
- **Résolution étape par étape** :
  1. Adapter le format de la page à l'intention dominante : tutoriel/guide pour de l'informationnel, grille de tarifs/comparateur pour du commercial, bouton d'achat direct pour du transactionnel.
  2. Supprimer les préambules superflus et offrir la solution dans le premier tiers de la page.

#### 2. Absence de Cannibalisation Sémantique (20 Pts)
- **Barème** : Unicité totale (20 pts) | Conflit partiel (10 pts) | Conflit direct avec une autre page pilier (0 pt)
- **Commentaire affiché** :
  > *"Risque de cannibalisation identifié avec l'URL `{competingUrl}` sur la thématique '{concept}'. Les deux pages se disputent le même positionnement dans les SERP."*
- **Résolution étape par étape** :
  1. Fusionner les deux pages en une page pilier de référence si elles couvrent le même besoin.
  2. Ou différencier nettement leurs ciblages de mots-clés et faire pointer un lien canonique ou un lien contextuel de la page secondaire vers la page maîtresse.

#### 3. Optimisation des Zones Chaudes (15 Pts)
- **Barème** : 6 pts Title + 5 pts début du contenu (la requête et le sujet sont posés dès les premières phrases) + 4 pts sous-titres H2/H3 reprenant la requête ou ses variantes. Le H1 n'est plus évalué ici : il est déjà contrôlé dans le pilier technique, et un H1 absent sur tout le site coûtait 5 points à chaque page (double pénalité). Le slug d'URL n'est plus évalué : modifier une URL en production est risqué et sans effet démontré.
- **Commentaire affiché** :
  > *"Le mot-clé principal n'est pas positionné dans les zones à forte pondération algorithmique (absent de : {missingZones})."*
- **Résolution étape par étape** :
  1. Insérer le terme cible au plus près du début de la balise Title et du titre H1.
  2. Nettoyer le slug d'URL pour le rendre lisible et concis (`/mot-cle-principal/`).
  3. Mentionner le sujet clé dès les 100 premiers mots du corps de texte.

#### 4. Contenu Primaire & Réponse Directe (TL;DR) (15 Pts)
- **Barème** : immédiate et claire (15 pts) | présente dès le début mais incomplète (11 pts) | noyée plus bas (7 pts) | seulement suggérée (3 pts) | absente (0 pt)
- **Commentaire affiché** :
  > *"La page manque d'un résumé exécutif ou d'une réponse claire en entrée. L'internaute doit scroller excessivement pour trouver l'information clé."*
- **Résolution étape par étape** :
  1. Ajouter un encadré 'En résumé' ou 'Ce qu'il faut retenir' (TL;DR) juste après le titre H1.
  2. Formuler une réponse claire de 2 à 3 phrases répondant immédiatement à la problématique.

#### 5. Couverture Sémantique & Entités Nommées (20 Pts)
- **Barème** : couverture complète avec les notions du métier (20 pts) | quelques manques (15 pts) | couverture partielle (10 pts) | sujet effleuré (5 pts) | texte pauvre (0 pt). Anomalie `SEMANTIC_GAPS` sous 12 pts.
- **Commentaire affiché** :
  > *"Le vocabulaire employé reste générique. Les entités clés du domaine d'expertise ({suggestedEntities}) ne sont pas abordées."*
- **Résolution étape par étape** :
  1. Enrichir le texte avec les entités nommées et concepts techniques associés au sujet (référentiel Wikidata).
  2. Couvrir les questions connexes posées par les utilisateurs dans la section PAA (People Also Ask).

#### 6. Signaux de Confiance E-E-A-T (10 Pts)
- **Barème** : Auteur qualifié (5 pts) + Date de mise à jour (3 pts) + Sources (2 pts)
- **Commentaire affiché** :
  > *"Manque de signaux d'autorité et d'expertise (E-E-A-T). L'article n'affiche pas d'auteur identifié ni de date de révision."*
- **Résolution étape par étape** :
  1. Intégrer un encart auteur avec photo, nom, fonction et lien vers une page biographique ou profil LinkedIn.
  2. Afficher explicitement la date de première publication et la mention 'Mis à jour le {date}'.

#### (Diagnostic hors score) Lisibilité & Clarté Typographique
- **Barème** : Flesch > 60 et paragraphes courts (5 pts) | Lecture dense (2 pts) | Blocs indigestes (0 pt)
- **Commentaire affiché** :
  > *"Le texte comporte des blocs de paragraphes trop longs et un indice de lisibilité Flesch trop sévère pour une lecture sur écran mobile."*
- **Résolution étape par étape** :
  1. Limiter les paragraphes à 3 ou 4 lignes maximum.
  2. Utiliser des listes à puces et mettre en gras les termes essentiels pour faciliter la lecture en diagonale.

---

### 4.2.bis Module éditorial V1 — requête cible et données de recherche (sans Search Console)

Le barème de 100 points ci-dessus est inchangé. Le module V1 y ajoute des données de recherche et des livrables, calculés par page pilier.

**Principes de conception**
- Aucune donnée Google Search Console (clics, impressions, positions) n'est disponible : le module s'appuie sur la page elle-même, sur Google Autocomplete et sur le LLM.
- Le référentiel d'évaluation est celui de Google sur le contenu utile (« people-first », E-E-A-T, effort et originalité, « Qui, Comment, Pourquoi »). La confiance (Trust) prime sur les autres composantes d'E-E-A-T.

**Fonctionnalités V1**
1. **Requête cible par page** : déduite par l'IA (Title, Hn, contenu, suggestions Autocomplete) puis modifiable par l'utilisateur dans le tiroir d'inspection. Une requête manuelle (`targetQuerySource = MANUAL`) est prioritaire à chaque ré-analyse ; « Revenir à la détection automatique » la supprime. Champs : `Page.targetQuery`, `Page.targetQuerySource` (`AUTO` | `MANUAL`).
2. **Alignement intention / contenu** : intention détectée (informationnelle, commerciale, transactionnelle, navigationnelle) et score `intentMatch` (/20).
3. **Snippet SERP** : score /100 d'attractivité du Title et de la méta description, critiques, et Title / méta réécrits (45 à 60 et 130 à 155 caractères, ville incluse pour une page locale). Boutons « Copier ».
4. **Content gaps** : sections et entités probablement couvertes par les pages concurrentes mais absentes de la page.
5. **E-E-A-T et ancrage local** : auteur, date, sources (signaux DOM prioritaires sur l'appréciation du modèle) ; pour un établissement local, ville, adresse ou téléphone visibles.
6. **Nouvelles anomalies** : `WEAK_SNIPPET` (score snippet < 60), `CONTENT_GAPS` (3 sections manquantes ou plus), `MISSING_LOCAL_SIGNALS` (établissement local sans signal local).

**Source des données : état actuel et cible**

| Donnée | Aujourd'hui | À terme |
| :--- | :--- | :--- |
| Requêtes fréquentes | Google Autocomplete (réel) | Autocomplete + PAA de la SERP |
| Top 10 et concurrents | **Estimé par l'IA** (`contentGaps.source = AI_ESTIMATE`) | **SERP réelle** (`contentGaps.source = SERP`) |
| Position de la page | Non fournie | Position réelle dans le Top 100 |

> **Évolution prévue — SERP réelle.** L'estimation des content gaps par l'IA est un palier provisoire, affiché comme tel dans l'interface. Elle sera remplacée par une API SERP payante à l'usage, derrière un port `SerpProviderPort` (premier adaptateur envisagé : Serper.dev ; alternative : DataForSEO pour une meilleure précision par ville). Le port fournira le Top 10 organique, les PAA et la position de la page ; les pages concurrentes seront ensuite crawlées avec l'extracteur Cheerio existant pour comparer Hn et entités. Cette évolution est mise de côté en attendant l'arbitrage budgétaire et nécessitera une clé API dans `.env`. Le scraping direct de `google.com` est exclu (CGU, blocages).

**Règles de la cannibalisation (estimation IA)**
- Le modèle ne voit que l'URL, le Title et le H1 des autres pages piliers, jamais leur contenu ni la SERP : le résultat est une estimation, affichée comme telle. Il doit nommer l'URL exacte de la page concernée (retenue seulement si elle figure dans la liste des piliers) et la requête commune.
- **Conflit** : score `cannibalizationRisk` inférieur à 10 ET page concurrente identifiée (anomalie `CANNIBALIZATION_RISK`, `WARNING`). **Recoupement partiel** : score de 10 à 14 ET page identifiée (même anomalie, `INFO`, hors compteur de conflits). Sans page identifiée, aucune alerte, car il n'y a rien d'actionnable.
- Un thème commun n'est pas un conflit : une page d'accueil qui présente les offres ne cannibalise pas leurs pages détaillées, et une page de service et un article de blog ont des intentions différentes.
- Le barème de 20 points est inchangé. Sans IA, l'heuristique locale ne détecte aucune cannibalisation.

**Cycle de vie et coûts**
- Contenu analysé : Title, méta description, Hn et 1 000 premiers mots, conservés au crawl dans `Page.metricsRaw.content` (aucun nouveau téléchargement en phase 2).
- Cache : `Page.contentHash` (contenu crawlé) et `Page.analyzedHash` (contenu + requête manuelle de la dernière analyse IA). Le bouton « Ré-analyser » force un nouvel appel. Un nouvel audit supprime tout (invariant zéro-historique) : le cache sert donc à la ré-sélection de piliers et à la ré-analyse d'une page, pas d'un audit à l'autre.
- Indicateur de moteur : `aiEvaluationRaw.editorialStatus` (`LLM` ou `HEURISTIC` avec le message d'erreur éventuel). Une page analysée en heuristique l'indique dans l'interface.

---

### 4.2.ter Diagnostics éditoriaux complémentaires (hors barème)

Ces diagnostics s'ajoutent au pilier éditorial sous forme d'anomalies (`INFO` ou `WARNING`) et d'accordéons dédiés dans le tiroir d'inspection. **Ils n'entrent pas dans le score sur 100** : le barème du §4.2 est inchangé. Chaque accordéon le rappelle.

**Heuristiques objectives** (calculées au crawl dans `src/adapters/secondary/crawler/editorial-signals.ts`, sans appel IA, stockées dans `Page.metricsRaw.content.signals`). Le « contenu principal » est `main`, à défaut `article`, à défaut `body`, après retrait de `nav`, `header`, `footer`, `aside`, des formulaires et des rôles `navigation`, `banner` et `contentinfo`.

| Diagnostic | Mesure | Anomalies |
| :--- | :--- | :--- |
| **Fraîcheur et obsolescence** (accordéon 8) | Années vieilles d'au moins 2 ans dans le Title, le H1 et le texte, avec ~50 caractères de contexte (une date historique légitime peut rester). Date de mise à jour lue dans `article:modified_time`, `og:updated_time`, `dateModified` (microdonnées et JSON-LD). | `OUTDATED_YEAR_MENTIONS` (`INFO`, cite les extraits et le statut de la date), `STALE_UPDATE_DATE` (`INFO`, date de mise à jour de plus de 2 ans). L'absence de date de mise à jour ne déclenche pas d'alerte à elle seule. |
| **Lisibilité et scannabilité** (accordéon 9) | Longueur moyenne des paragraphes `<p>`, paragraphes de plus de 100 mots, part de phrases de plus de 25 mots, nombre de listes (au moins 2 `li`) et de tableaux. | `DENSE_PARAGRAPHS` (`WARNING`, moyenne supérieure à 80 mots ou plus de 40 % de paragraphes longs, à partir de 3 paragraphes), `LONG_SENTENCES` (`INFO`, plus de 35 % de phrases longues, à partir de 10 phrases), `NO_LISTS_OR_TABLES` (`INFO`, 600 mots ou plus sans liste ni tableau). Moins de 3 paragraphes : mesure signalée comme peu fiable, sans alerte. |
| **Maillage dans le contenu** (accordéon 10) | Liens du contenu principal uniquement (internes, externes), avec repérage des ancres vides ou génériques (« en savoir plus », « cliquez ici », « lire la suite », « read more »…), comparées sans accents ni ponctuation. | `GENERIC_ANCHORS` (`INFO`, `WARNING` à partir de 3), `NO_CONTEXTUAL_LINKS` (`INFO`, 500 mots ou plus sans aucun lien interne dans le contenu). |

**Analyse IA** (ajoutée à la requête d'analyse existante, aucun appel supplémentaire ; contrat `quality` du schéma Zod). Ce sont des indices, sans comparaison avec les pages concurrentes.

| Diagnostic | Mesure | Anomalies |
| :--- | :--- | :--- |
| **Expérience vécue** (accordéon 11) | Preuves de vécu réelles : première personne, retours de terrain, cas clients, anecdotes. Courts extraits copiés de la page comme preuves. | `NO_FIRST_HAND_EXPERIENCE` (`INFO`) |
| **Gain d'information** (accordéon 11) | Niveau faible / moyen / élevé, données ou méthode propres, cas concrets, passages génériques, limites évoquées. | `GENERIC_CONTENT` (`INFO`, niveau faible uniquement) |
| **Réassurance** (accordéon 11) | Blocs absents utiles à la page : déroulé du premier contact, délais, tarifs indicatifs, réalisations, garanties, localisation. | `MISSING_REASSURANCE` (`INFO`, 2 blocs absents ou plus) |

**Balisage Schema.org E-E-A-T.** Le balisage JSON-LD qui porte les signaux E-E-A-T (auteur, éditeur, dates) relève du pilier GEO et est proposé dans l'onglet GEO (voir §4.3, critère 5). L'accordéon « Signaux E-E-A-T » de l'onglet éditorial ne traite que les signaux visibles sur la page (auteur, date, sources) et renvoie vers l'onglet GEO.

**Ordre des accordéons de l'onglet éditorial** (utilisé par le routage des anomalies, `lib/issue-routing.ts` ; indices à partir de 0, le numéro affiché dans le titre vaut l'indice + 1, d'où « accordéon 8 » pour la fraîcheur dans les tableaux ci-dessus) : 0 intent et cannibalisation, 1 zones chaudes, 2 contenu primaire, 3 E-E-A-T, 4 snippet SERP, 5 requêtes Google et content gaps, 6 ancrage local, 7 fraîcheur, 8 lisibilité, 9 maillage dans le contenu, 10 expérience vécue et gain d'information. Les accordéons 4 à 6 et 10 s'affichent même sans analyse IA, avec la mention « Non disponible », pour garder des positions stables. Sur un audit antérieur à ces diagnostics, les accordéons 7 à 9 invitent à relancer l'audit.

---

### 4.2.quater Rôle des pages et cohérence du site

**Rôle de la page** (`src/core/domain/scoring/page-role.ts`) : accueil, marque / institutionnelle, contact, offre / service, réalisation / étude de cas, article / contenu informatif, liste / hub, utilitaire (mentions légales, plan du site, politique de confidentialité). Il est déterminé, du plus fiable au moins fiable, par : le chemin des pages utilitaires et de contact ; le type Schema.org (`Article`, `BlogPosting`, `ContactPage`, `AboutPage`, `CollectionPage`…) ; `og:type` ; le nombre d'éléments `<article>` (plusieurs cartes = liste) ; la date de publication dans les balises meta ; le nom de la rubrique (« actualités », « clients »…) ; les pages citées dans le contenu d'une telle rubrique ; enfin les mots du chemin. À défaut : offre / service. Pour un pilier, l'IA reçoit ce rôle et peut le corriger en le justifiant (sans appel supplémentaire). Une **correction manuelle** (liste déroulante dans Subpages) prime sur tout et recalcule le score éditorial d'un pilier déjà analysé sans nouvel appel à l'IA. Les pages utilitaires comptent parmi les rôles à faible enjeu de classement dans l'avertissement de sélection des piliers. Il adapte les attentes :
- **E-E-A-T (10 pts)** : auteur, date et sources ne se demandent qu'à un **article**. Pour les autres rôles, le critère est « sans objet » et sort du dénominateur : le score éditorial est ramené sur 90 points puis sur 100. Aucune anomalie `LOW_EEAT_SIGNALS` hors article. Le modèle donne un conseil de confiance adapté (identité légale, agréments, direction nommée, coordonnées) sans exiger d'auteur.
- **Réponse directe** : pour un article, une réponse ou un résumé ; pour les autres pages, une proposition de valeur claire et une action visible.
- **Expérience vécue** : demandée aux articles, aux offres et aux réalisations seulement ; les avis clients ne comptent pas comme expérience de l'auteur. **Gain d'information** : sans objet pour une page de contact.
- **Requêtes Google (Autocomplete)** : non interrogées pour les pages de marque et de contact, dont la requête n'est pas thématique (sauf requête saisie par l'utilisateur). Pour les autres, la graine est courte et sans la marque (segments du H1 puis du Title), avec plusieurs essais.

**Cohérence du site** (section de l'onglet SEO Éditorial, anomalies `SITE_*`, régénérées à chaque analyse) :
- Contrôles sans IA sur toutes les pages explorées : `SITE_DUPLICATE_TITLES` (avertissement), `SITE_DUPLICATE_META` et `SITE_DUPLICATE_H1` (info), `SITE_INCONSISTENT_FIGURES` (chiffres-clés contradictoires d'une page à l'autre, par exemple « 26 établissements » contre « 24 », à vérifier), `SITE_PILLARS_LOW_POTENTIAL` (au moins 3 piliers dont au moins 75 % sont des pages d'accueil, de marque ou de contact).
- Un appel IA unique pour tout le site (`SITE_FINDING_n`, info, estimation à vérifier) : recoupements d'intention, type de page manquant, rôle inadapté. Le modèle ne reçoit que le Title, le H1, la méta, la requête cible, le rôle et le début du contenu des piliers. Les URL citées sont vérifiées contre la liste des piliers.
- Dans Subpages, chaque page affiche son rôle, et un avertissement apparaît quand la sélection est surtout composée de pages de marque ou de contact.

**Fiabilité des diagnostics.**
- Les mots collés par le balisage (« en<span>EHPAD</span> ») sont séparés avant l'extraction du texte (nombre de mots, extraits, ancres).
- Le fil d'Ariane n'est pas compté comme maillage dans le contenu.
- Les dates numériques complètes (jj/mm/aaaa : avis, publications) ne sont plus signalées comme années obsolètes.
- Contenu conditionné aux cookies tiers (`CONSENT_GATED_CONTENT`, info, impact moyen) : détecté quand la page affiche « accepter les cookies … pour avoir accès au module ».
- Le Title et le H1 absents de la page forcent la réponse « mot-clé absent » du modèle. Les suggestions de Title et de méta sont contrôlées : les mots propres absents de la page (par exemple un lieu inventé) sont signalés « à vérifier avant publication ».

---

### 4.3 Pilier GEO — Generative Engine Optimization (100 Pts — IA / Robot)

```
┌────────────────────────────────────────────────────────────────────────┐
│                      PILIER GEO — 100 POINTS                           │
├──────────────────────────────┬────────┬────────────────────────────────┤
│ CRITÈRE GEO                  │ POINTS │ ÉVALUATION                     │
├──────────────────────────────┼────────┼────────────────────────────────┤
│ 1. Accessibilité Bots IA     │ 15 pts │ Test robots.txt (GPT/ClaudeBot)│
│ 2. Fichier /llms.txt         │ 0 pt   │ Affiché, hors score            │
│ 3. Citabilité & Passage Rank │ 40 pts │ Jugée par l'IA (piliers)       │
│ 4. Données d'Autorité & Liens│ 5 pts  │ Liens externes vers sources    │
│ 5. Données Structurées JSON-LD│ 25 pts│ Schéma.org détecté             │
│ 6. Cohérence NAP & Identité  │ 15 pts │ Name, Address, Phone constants │
└──────────────────────────────┴────────┴────────────────────────────────┘
```

> **Pondérations.** Révisées après relecture : l'accès des robots est une condition, pas une preuve d'être cité (25 pts ramenés à 15) ; `/llms.txt` passe hors score faute de preuve d'usage ; les 15 pts libérés vont à la citabilité (30 à 40) et au Schema.org (20 à 25). Ces poids restent des choix éditoriaux, non calibrés sur des citations réelles. La cohérence NAP est jugée à l'échelle du site (`nap.ts`) : téléphone et adresse comptent s'ils figurent quelque part sur le site, chaque page ne perd que les points de cohérence si ses coordonnées contredisent son propre JSON-LD (jamais le numéro le plus fréquent du site, pour ne pas pénaliser un groupe multi-établissements) ; sans JSON-LD de coordonnées sur la page, ces 5 pts sortent du dénominateur (`consistencyMeasured: false`, `napMeasuredPoints` : 0, 10 ou 15, GEO calculé sur 85 + ces points), et un manque n'est signalé qu'une fois, sur l'accueil (`reportMissing`). Elle sort du dénominateur quand aucune coordonnée n'est trouvée sur le site, sauf pour un établissement local repéré par l'analyse d'un pilier : elle vaut alors 0. Accès des robots IA : groupe du robot, à défaut `*` (`parseRobotsTxt(text, 'gptbot')`), et test de la page d'accueil avec le user-agent de chaque robot pour repérer un pare-feu (`firewallBlocked`) : signalé comme blocage probable (`AI_BOTS_POSSIBLY_FIREWALLED`, info), sans perte de points, car le test vient d'une IP non officielle. Schema.org d'un pilier incomplet : la page est rendue dans Chrome sans fenêtre (`scripts/render/schema-types.mjs`, `RenderedSchema`) pour lire un JSON-LD injecté par JavaScript.

#### 1. Accessibilité Robots IA (`robots.txt`) (15 Pts)
- **Barème** : GPTBot (6 pts) + ClaudeBot (6 pts) + PerplexityBot (3 pts)
- **Commentaire affiché** :
  > *"Les robots d'indexation des moteurs génératifs ({blockedBots}) sont bloqués par votre fichier `robots.txt`. Votre site est invisible dans SearchGPT, Perplexity et Claude Search."*
- **Résolution étape par étape** :
  1. Ouvrir le fichier `robots.txt`.
  2. Vérifier et ajouter les directives suivantes :
     ```txt
     User-agent: GPTBot
     Allow: /

     User-agent: ClaudeBot
     Allow: /

     User-agent: PerplexityBot
     Allow: /
     ```

#### 2. Standard `/llms.txt` & Documentation Markdown (hors score)
> Aucun moteur majeur n'a confirmé utiliser ce fichier : il est affiché dans l'onglet GEO mais n'entre pas dans le score, et son absence n'est signalée qu'en `INFO`.

- **Barème** : aucun point. Présence et format (titre Markdown, plus de 50 caractères) affichés.
- **Commentaire affiché** :
  > *"Aucun fichier `/llms.txt` n'est détecté à la racine de votre domaine. Ce standard émergeant permet aux LLM de comprendre instantanément votre offre sans devoir parser l'intégralité du HTML."*
- **Résolution étape par étape** :
  1. Créer un fichier texte nommé `llms.txt` à la racine de votre site (`https://votre-site.com/llms.txt`).
  2. Rédiger une synthèse Markdown claire décrivant votre mission d'entreprise, vos produits phares et la liste des liens vers vos pages piliers.

#### 3. Citabilité & Passage Ranking (40 Pts)
- **Barème** (grille vérifiée, `src/core/domain/scoring/citability.ts`, `evaluateCitability`) : passages citables vérifiés mot pour mot, 80 à 400 caractères (1 = 8, 2 = 12, 3 = 16 pts) + définition claire de ce que la page propose (extrait vérifié, 8 pts) + fait précis contenant un chiffre (extrait vérifié, 8 pts) + sous-titres H2/H3 en questions (2 ou plus = 8, 1 = 4 pts). L'IA renvoie `quotablePassages`, `definitionQuote` et `factQuote` mais plus de note ; le code calcule le score (`citability.checks`). Remplace depuis le 2026-10-28 (prompt `v5-2026-10-28`) la note globale de l'IA, qui variait jusqu'à 20 pts d'une analyse à l'autre. Anomalie `LOW_AI_CITABILITY` sous 28 pts. Estimation sans IA pour les pages non piliers : 36 pts si au moins 3 sous-titres, sinon 20.
- **Mise en place** : pour une page pilier, jugée par l'IA dans la requête de l'analyse éditoriale (`citability` dans `llm-gateway.ts`, rangée dans `EditorialEvaluation.citability`) ; `analyzeEditorial` recalcule alors le score GEO de la page et ses anomalies GEO avec cette citabilité (`aiCitability.source = 'AI'`). Les passages citables renvoyés par l'IA ne sont gardés que s'ils figurent mot pour mot dans le contenu. Pour les autres pages, estimation sans IA par le nombre de sous-titres (`source = 'HEURISTIC'`), affichée comme telle.
- **Commentaire affiché** :
  > *"Le contenu n'est pas découpé en passages autonomes citables. Les modèles génératifs peinent à extraire des citations courtes et précises pour leurs réponses synthétiques."*
- **Résolution étape par étape** :
  1. Formuler des intertitres H2/H3 sous forme de questions directes posées par votre cible.
  2. Faire suivre chaque question d'un paragraphe autonome de 40 à 60 mots apportant une définition factuelle et sans ambiguïté.
  3. Ajouter des tableaux comparatifs synthétiques ou des listes ordonnées.

#### 4. Données d'Autorité & Sources Externes (5 Pts)
- **Barème** : $\ge 2$ liens vers des domaines reconnus (5 pts) | 1 lien (3 pts) | aucun (1 pt). La liste de domaines (`.gouv.fr`, `.gov`, `.edu`, `insee.fr`, `who.int`, `wikipedia.org`…) est un choix arbitraire : signal faible.
- **Commentaire affiché** :
  > *"La page n'étaye aucune de ses affirmations par des liens externes vers des sources de données reconnues. Les moteurs IA privilégient les contenus vérifiables."*
- **Résolution étape par étape** :
  1. Citer et lier au moins 2 sources tierces faisant autorité (études officielles, livres blancs universitaires, statistiques de référence).
  2. Configurer les liens externes en `rel="noopener"`.

#### 5. Données Structurées Schéma.org JSON-LD (25 Pts)
- **Barème** : entité décrite (Organization, LocalBusiness, Article, Product, Service, Person…) (25 pts) | seulement des types de structure (WebPage, WebSite, BreadcrumbList…) (10 pts) | balisage sans type (5 pts) | aucun (0 pt). Anomalie `WEAK_SCHEMA_ORG` sous 25 pts. La validité n'est pas contrôlée ; un JSON-LD injecté par JavaScript reste invisible.
- **Commentaire affiché** :
  > *"Absence de données structurées JSON-LD valides (`Organization`, `Article`, `FAQPage`). Les moteurs IA ne peuvent pas valider avec certitude les entités de la page."*
- **Résolution étape par étape** :
  1. Intégrer un script `<script type="application/ld+json">` dans le `<head>`.
  2. Pour un article : baliser `Article` ou `BlogPosting` avec `author`, `datePublished` et `publisher`.
  3. Pour une FAQ : implémenter le schéma `FAQPage` avec chaque question/réponse.

**Balisage Schema.org suggéré** (accordéon « Schema.org & Cohérence NAP » de l'onglet GEO, `src/core/domain/scoring/eeat-schema.ts`, généré à l'affichage). Le JSON-LD est adapté au type de page : `Organization` ou `LocalBusiness` (si l'IA détecte un établissement local) pour la page d'accueil, `Article` pour un contenu daté ou un chemin de type blog / guide / actualité, `WebPage` sinon. Il reprend ce que la page fournit (titre, description, URL canonique, date de mise à jour détectée, ville) et laisse les autres champs sous la forme `[À COMPLÉTER : …]` (auteur, fonction, page biographique, dates de publication, nom de l'entreprise, logo, coordonnées, profils) : aucune information n'est inventée. Si l'anomalie `MISSING_SCHEMA_ORG_JSONLD` ou `LOW_EEAT_SIGNALS` est levée, le bloc est ouvert et mis en avant (« À intégrer ») ; sinon il reste consultable dans un dépliant discret. Si un balisage du même type existe déjà sur la page, l'interface invite à le compléter plutôt qu'à ajouter un doublon. Le bouton « Copier le code » fournit le script `<script type="application/ld+json">` prêt à coller.

#### 6. Cohérence NAP (Name, Address, Phone) & Identité (15 Pts)
- **Barème** : Coordonnées uniformes et conformes (10 pts) | Données partielles (5 pts) | Discordances détectées (0 pt)
- **Commentaire affiché** :
  > *"Les coordonnées de contact (Nom d'entreprise, Adresse postale, Téléphone) présentent des discordances entre les pages du site ou ne concordent pas avec les mentions légales."*
- **Résolution étape par étape** :
  1. Standardiser la typographie exacte du nom commercial, de l'adresse et du numéro de téléphone sur toutes les pages (header, footer, page contact).
  2. Renseigner ces mêmes données dans le schéma JSON-LD `LocalBusiness` ou `Organization`.

---

### 4.3.bis Impact sur le classement et priorités

Chaque anomalie porte une étiquette d'**impact sur le classement dans Google** (`lib/issue-impact.ts`), fondée sur ce que Google documente (indexation, pertinence, maillage, contenu utile) et non sur des conventions SEO. Les anomalies du pilier GEO portent l'étiquette « Visibilité IA ».

| Impact | Anomalies (codes) |
| :--- | :--- |
| **Fort** | `HTTP_*`, `FETCH_FAILED`, `BLOCKED_BY_ROBOTS_TXT`, `*_BLOCKED_STATUS`, `ORPHAN_PAGE`, `INTENT_MISMATCH`, `CANNIBALIZATION_RISK` avérée (`WARNING`), `MISSING_METADATA` quand le Title manque |
| **Moyen** | `MISSING_CANONICAL`, `LOW_INLINKS_COUNT`, `CLICK_DEPTH_*`, `CWV_*`, `NO_HTTPS`, redirections, `MISSING_H1`, `HOT_ZONES_UNOPTIMIZED`, `MISSING_TLDR_SUMMARY`, `LOW_EEAT_SIGNALS`, `WEAK_SNIPPET`, `CONTENT_GAPS`, `MISSING_LOCAL_SIGNALS`, `GENERIC_ANCHORS`, `NO_CONTEXTUAL_LINKS`, `NO_FIRST_HAND_EXPERIENCE`, `GENERIC_CONTENT`, recoupement partiel de cannibalisation |
| **Faible** | `H1_LENGTH_UNOPTIMIZED`, `MULTIPLE_H1`, `HEADING_HIERARCHY_SKIP`, `METADATA_LENGTH_UNOPTIMIZED`, méta description seule manquante, `MISSING_FROM_SITEMAP`, `IMAGES_*`, `DENSE_PARAGRAPHS`, `LONG_SENTENCES`, `NO_LISTS_OR_TABLES`, `OUTDATED_YEAR_MENTIONS`, `STALE_UPDATE_DATE` |

**Critères retirés du score ou rétrogradés** (aucun effet démontré sur le classement) : longueur du H1, sauts de hiérarchie Hn et H1 multiples (sans perte de points, en `INFO`), longueur de la méta description (`INFO`), slug d'URL et mot-clé dans les 100 premiers mots (retirés du barème), seuil de mots (« contenu mince » : seul un contenu quasi vide, moins de 150 mots, est signalé, car Google n'impose pas de longueur), score de lisibilité (hors score), blocs de réassurance (conversion, pas classement). Un `H1` absent reste un avertissement. Un Title absent reste critique.

**Onglet SEO éditorial d'une page pilier.** Construit par `src/adapters/primary/presenters/editorial-sections.ts`, dans un ordre fixe auquel `lib/issue-routing.ts` renvoie par indice : 0 intention, 1 cannibalisation, 2 zones chaudes, 3 réponse directe ou proposition de valeur, 4 couverture du sujet, 5 E-E-A-T (masqué hors article), 6 ce que montre Google, 7 Title et méta, 8 ancrage local (masqué hors établissement local), 9 fraîcheur, 10 lisibilité, 11 liens dans le contenu, 12 expérience vécue et originalité (masqué pour contact et utilitaire). L'en-tête compare l'intention de la page à celle de Google et donne la position mesurée ; pour une requête de marque, une autre page du site en tête est normale (bleu). Chaque constat porte sa source (Mesuré, Google, Estimation IA). Les suggestions Autocomplete enregistrées sont refiltrées à l'affichage (`autocomplete-relevance.ts`) et l'intention de la SERP est recalculée depuis les résultats stockés.

**Points à traiter d'une page (tiroir d'inspection).** Dans chaque onglet (Technique, Éditorial, GEO), la liste « À traiter » est coupée en deux groupes : « Font varier le score » (anomalies liées à un critère noté, avec les points en jeu, ex. « jusqu'à 8 pts ») et « Sans effet sur le score » (diagnostics et recommandations : longueur du H1, plusieurs H1, hiérarchie Hn, snippet, content gaps, fraîcheur, lisibilité, expérience vécue…). La correspondance code d'anomalie / points est dans `lib/score-effect.ts` et doit rester alignée sur les moteurs de scoring ; les points sont donnés avant normalisation des critères non mesurés ou sans objet.

**Onglet Issues & Tips.** Les anomalies sont regroupées par impact, dans l'ordre : « À corriger en priorité » (impact fort), « À planifier » (moyen), « Améliorations mineures » (faible, repliée par défaut) et « Visibilité dans les moteurs IA » (GEO, repliée par défaut). Quatre tuiles en tête comptent les anomalies et les pages concernées par niveau et filtrent la liste d'un clic. Les filtres combinent le pilier (Technique, Éditorial, GEO), la gravité (critique, avertissement, info) et une recherche libre, avec des compteurs et un bouton de réinitialisation. Chaque anomalie affiche son pilier, sa gravité et le nombre de pages ; dépliée, elle donne la description, les étapes pour corriger (« Comment corriger »), les 5 premières pages concernées avec leurs indicateurs, et un lien vers la liste complète. Les liens de la synthèse (`?filter=critical|warning|passed`) préfiltrent la gravité.

**Codes couleur.** Rouge : critique ; jaune : avertissement ; bleu : info (recommandation mineure). Le vert n'est jamais utilisé pour une anomalie à corriger. Dans le tiroir d'inspection, chaque point à traiter renvoie vers le bloc détaillé concerné (ouvert et amené à l'écran). Subpages affiche le score technique de chaque page.

**Détection des signaux de page.** Les données structurées (JSON-LD, y compris racine en tableau et `@graph`, microdonnées `itemtype`, RDFa `typeof`), l'auteur, la date et les liens d'autorité sont lus **avant** le retrait de `script`, `nav`, `header` et `footer` du DOM (ils étaient auparavant perdus). Un balisage ajouté par JavaScript reste invisible de ce crawler (qui n'exécute pas le JavaScript) : l'analyse GEO le précise et renvoie au test des résultats enrichis de Google. Le critère GEO indique « détecté », pas « valide » : la validité du balisage n'est pas contrôlée.

**Synthèse de l'audit.** Elle affiche « Vos priorités pour monter dans Google » (jusqu'à 5 anomalies à impact fort ou moyen, triées par impact, gravité puis nombre de pages) et la mention de ce que l'outil ne mesure pas (liens entrants, positions réelles, force des concurrents). Les anomalies sont triées par impact dans toutes les listes. Le compteur « recommandations mineures » regroupe les anomalies de niveau `INFO`.

**Conseil de synthèse** (`src/adapters/primary/presenters/synthesis-advice.ts`, sans appel IA supplémentaire). Une fois les piliers analysés, la synthèse affiche un conseil construit à partir des analyses : le critère éditorial le moins bien servi en moyenne (avec le conseil de la page la plus concernée), le point fort à conserver et l'action rapide de la page au score éditorial le plus bas. Une note précise si certaines pages ont été analysées sans IA.

**Années obsolètes.** Une année n'est signalée que dans un contexte de date (« en », « depuis », « mis à jour », un mois, une date numérique) dans le texte, ou librement dans le Title et le H1. Les nombres suivis d'une monnaie ou d'une unité (€, W, kg, mm…) et ceux précédés de « modèle », « réf », « RCS », « Air Top »… sont ignorés.

---

### 4.3.ter Positionnement Google (SERP)

Onglet **Positionnement** : position réelle des pages piliers sur leur requête cible, et pages qui se classent devant elles. C'est un **résultat mesuré, hors du score sur 100**, lancé à la demande sur **toute page explorée, indexable et accessible** (piliers ou non, sans passer par l'analyse IA) : cases à cocher pour une sélection (20 pages au plus par lancement) ou bouton par ligne. La requête se saisit à la main dans le tableau (enregistrée comme requête manuelle de la page) ; à défaut, la requête cible de la page, puis son H1, puis son Title. L'onglet est disponible dès la fin du crawl.

- **Source** : un Chrome local **visible** avec un profil persistant dédié (`scripts/serp/google-serp.mjs`, patchright), appelé depuis le serveur par un processus enfant. Le résultat est un JSON (position, titre, URL réelle après résolution des redirections Google, extrait, domaine). Le port `SerpProviderPort` (`src/core/ports/serp-provider.ts`) isole cette source ; `createSerpProvider()` choisit l'implémentation selon `SERP_PROVIDER` : `browser` (défaut, `GoogleBrowserSerp`) ou `serper` (`SerperApiSerp`, API Serper.dev payante, clé `SERPER_API_KEY`, cache `.cache/serp-api/`, refus 401/403/429 traité comme un blocage). L'API est la voie conforme si l'application est fournie à des tiers. Chaque fournisseur a un identifiant (`SerpProviderPort.id`) enregistré dans `SerpAnalysis.provider` et `SerpHistoryEntry.provider` ; le re-test ne compare que des relevés du même fournisseur.
- **Limites et précautions** : les recherches automatisées vont à l'encontre des conditions d'utilisation de Google ; usage local, à la demande, quelques requêtes espacées ; aucun contournement de captcha (résolution manuelle dans la fenêtre) ; profil jamais connecté à un compte personnel ; positions variables selon le lieu et le profil ; sélecteurs sensibles aux changements de Google (captures de debug dans `debug/`). Cache disque de 24 h par requête (`.cache/serp/`). Une seule analyse à la fois.
- **Ce qui est calculé** (`src/core/domain/scoring/serp-analysis.ts`) : position du domaine ; pages du site présentes dans les résultats (deux ou plus : **cannibalisation avérée**) ; lecture des 3 premiers concurrents (titres H2/H3, longueur) ; **sections absentes** : titres qui reviennent chez au moins deux concurrents et dont les mots manquent à la page ; **intention dominante** des résultats (titres et extraits), comparée à celle détectée ; longueur moyenne des titres et extraits affichés.
- **Intégration à l'éditorial** : dans le tiroir de la page, l'accordéon « Requêtes Google & Content gaps » passe de « estimation IA » à « source : SERP » (sections mesurées), la ligne cannibalisation affiche la preuve, et l'intention est confirmée ou signalée à vérifier. Le tableau éditorial affiche un badge de position.
- **Position de la page** : trois cas distincts. La page sort comme résultat à part entière (n°X) ; elle s'affiche en **lien annexe** (sitelink) sous un résultat du même site (par exemple « À propos » sous la page d'accueil, cas fréquent sur une requête de marque) ; ou seule une autre page du site sort. Les liens annexes ne sont extraits que pour le domaine audité.
- **Liens de résultats** : Google remplace les adresses par des jetons chiffrés (`/goto?url=CAES…`). Le script suit chaque redirection avec le contexte du navigateur (sans suivre le saut, lecture de l'en-tête `location`), avec une pause de 0,3 à 0,9 s entre deux requêtes ; à défaut, l'adresse affichée sous le titre sert de repli et le résultat est marqué approximatif. Une recherche qui n'extrait aucun résultat est une erreur, jamais une mesure « absent ».
- **États** : en cours, terminé, captcha ou blocage (les requêtes suivantes sont annulées), erreur.

---

### 4.4 Calcul des Scores Globaux (Page & Projet)

#### Score de Page :
$$\text{Score Page}_i = \frac{\text{Score Technique}_i + \text{Score Éditorial}_i + \text{Score GEO}_i}{3}$$

#### Score Global du Projet :
$$\text{Score Global Projet} = 0.40 \times \overline{\text{Score Technique}} + 0.35 \times \overline{\text{Score Éditorial}_{\text{Piliers}}} + 0.25 \times \overline{\text{Score GEO}_{\text{Piliers}}}$$

---

## 5. SCHÉMA DE DONNÉES RELATIONNEL (POSTGRESQL & PRISMA)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum AuditStatus {
  IDLE
  QUEUED
  CRAWLING_TECH
  AWAITING_AI_SELECTION
  ANALYZING_AI
  COMPLETED
  FAILED
}

enum PillarType {
  TECH
  EDITORIAL
  GEO
}

enum IssueSeverity {
  CRITICAL
  WARNING
  INFO
}

model Project {
  id          String   @id @default(cuid())
  domain      String   @unique
  name        String
  faviconUrl  String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  audits      Audit[]

  @@map("projects")
}

model Audit {
  id              String       @id @default(cuid())
  projectId       String
  project         Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  status          AuditStatus  @default(IDLE)
  progress        Int          @default(0)
  
  overallScore    Float?
  techScore       Float?
  editorialScore  Float?
  geoScore        Float?

  totalPagesCount Int          @default(0)
  pillarPagesCount Int         @default(0)
  crawlStartedAt  DateTime?
  completedAt     DateTime?
  errorMessage    String?

  pages           Page[]
  issues          Issue[]

  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@map("audits")
}

model Page {
  id              String      @id @default(cuid())
  auditId         String
  audit           Audit       @relation(fields: [auditId], references: [id], onDelete: Cascade)
  
  url             String
  path            String
  httpStatus      Int         @default(200)
  depth           Int         @default(0)
  isPillar        Boolean     @default(false)
  isIndexable     Boolean     @default(true)
  
  title           String?
  metaDescription String?
  h1              String?
  h2Count         Int         @default(0)
  wordCount       Int         @default(0)
  inlinksCount    Int         @default(0)
  outlinksCount   Int         @default(0)
  
  pageScore       Float?
  techScore       Float?
  editorialScore  Float?
  geoScore        Float?

  metricsRaw      Json?
  aiEvaluationRaw Json?

  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@unique([auditId, url])
  @@index([auditId, isPillar])
  @@map("pages")
}

model Issue {
  id             String        @id @default(cuid())
  auditId        String
  audit          Audit         @relation(fields: [auditId], references: [id], onDelete: Cascade)
  
  pillar         PillarType
  severity       IssueSeverity
  code           String
  title          String
  description    String
  recommendation String
  stepsToResolve String[]      // Guide de résolution pas-à-pas
  
  affectedUrl    String?
  metadata       Json?

  createdAt      DateTime      @default(now())

  @@index([auditId, pillar, severity])
  @@map("issues")
}
```

---

## 6. PIPELINE D'EXÉCUTION & WORKERS ASYNCHRONES (BULLMQ + REDIS)

### 6.1 Worker 1 : Crawl Technique (`CrawlWorker`)
- Crawlee `CheerioCrawler` avec User-Agent Googlebot Mobile.
- Plafond 500 pages.
- Évaluation unitaire via `TechScoringEngine` et génération des anomalies avec leurs guides de résolution.
- Passage de l'audit à `AWAITING_AI_SELECTION`.

### 6.2 Worker 2 : Analyse IA (`AiAnalysisWorker`)
- Réception des 10 à 20 pages piliers confirmées par l'utilisateur.
- Invocation de Claude 3.5 Sonnet avec le contrat Zod.
- Calcul unitaire des scores Éditorial et GEO via `EditorialScoringEngine` et `GeoScoringEngine`.
- Synthèse globale du projet et clôture à l'état `COMPLETED`.

---

## 7. STRUCTURE DES PROMPTS IA & CONTRATS ZOD

> **Implémentation actuelle.** Le contrat réel est `EditorialLlmSchema` dans `src/adapters/secondary/llm/llm-gateway.ts` (Zod v4, `zod/v4`, converti en JSON Schema pour Gemini). Il reprend les critères ci-dessous et ajoute `targetQuery` (requête et intention), `snippet`, `contentGaps` et `local` (§4.2.bis). Les types métier correspondants sont `SearchInsights` et `EditorialAnalysisInput` dans `src/core/domain/types.ts`. Le schéma GEO ci-dessous n'est pas encore branché sur un modèle. Le contenu de la page est transmis au modèle comme donnée non fiable.

```typescript
import { z } from "zod";

export const EditorialAiEvaluationSchema = z.object({
  intentMatch: z.object({
    detectedIntent: z.enum(["INFORMATIONAL", "TRANSACTIONAL", "COMMERCIAL", "NAVIGATIONAL"]),
    score: z.number().min(0).max(20),
    critique: z.string(),
    actionableAdvice: z.string(),
  }),
  cannibalizationRisk: z.object({
    score: z.number().min(0).max(20),
    competingConcepts: z.array(z.string()),
    critique: z.string(),
    actionableAdvice: z.string(),
  }),
  hotZonesOptimization: z.object({
    score: z.number().min(0).max(15),
    titleKeywordPresent: z.boolean(),
    h1KeywordPresent: z.boolean(),
    first100WordsKeywordPresent: z.boolean(),
    actionableAdvice: z.string(),
  }),
  primaryContentTldr: z.object({
    score: z.number().min(0).max(15),
    hasDirectAnswer: z.boolean(),
    critique: z.string(),
    actionableAdvice: z.string(),
  }),
  semanticDepth: z.object({
    score: z.number().min(0).max(15),
    recognizedEntities: z.array(z.string()),
    missingKeyEntities: z.array(z.string()),
    actionableAdvice: z.string(),
  }),
  eeatSignals: z.object({
    score: z.number().min(0).max(10),
    hasAuthor: z.boolean(),
    hasPublicationDate: z.boolean(),
    hasSources: z.boolean(),
    actionableAdvice: z.string(),
  }),
  readability: z.object({
    score: z.number().min(0).max(5),
    critique: z.string(),
    actionableAdvice: z.string(),
  }),
  quickWins: z.array(z.string()).min(1).max(3),
});

export const GeoAiEvaluationSchema = z.object({
  aiCitability: z.object({
    score: z.number().min(0).max(20),
    extractableBlocksCount: z.number(),
    hasDirectDefinitions: z.boolean(),
    critique: z.string(),
    actionableAdvice: z.string(),
  }),
  authoritySources: z.object({
    score: z.number().min(0).max(10),
    externalAuthoritativeLinksCount: z.number(),
    critique: z.string(),
    actionableAdvice: z.string(),
  }),
  napConsistency: z.object({
    score: z.number().min(0).max(10),
    detectedName: z.string().nullable(),
    detectedAddress: z.string().nullable(),
    detectedPhone: z.string().nullable(),
    isConsistent: z.boolean(),
    actionableAdvice: z.string(),
  }),
  llmReadinessSummary: z.string(),
  quickWins: z.array(z.string()).min(1).max(3),
});
```

---

## 8. SKILLS & ADAPTERS RECOMMANDÉS POUR LA CONSTRUCTION DU BACKEND

Pour implémenter ce backend de manière optimale et robuste, voici les 5 briques architecturales clés à orchestrer :

1. **`crawlee-mobile-scraper`** :
   - Pipeline d'extraction Cheerio haute vitesse avec profil Googlebot Smartphone.
   - Gestion des limites mémoire, découverte d'URLs via BFS et respect du plafond de 500 pages.
2. **`prisma-cascade-storage`** :
   - Mise en place du schéma PostgreSQL avec politique `onDelete: Cascade` pour garantir l'invariant du projet à audit unique sans orphelinat de données.
3. **`bullmq-pipeline-orchestrator`** :
   - Découplage de la Phase 1 (crawl technique rapide) et de la Phase 2 (évaluation LLM par lots) via Redis avec backoff exponentiel et gestion de concurrence.
4. **`vercel-ai-anthropic-gateway`** :
   - Module d'appel à Claude 3.5 Sonnet avec parsing strict Zod (`generateObject`), calcul automatique des recommandations actionnables et bascule de secours sur Gemini 1.5 Pro.
5. **`sse-realtime-reporter`** :
   - Endpoints Server-Sent Events pour alimenter la barre de progression et le statut en temps réel sur le dashboard sans surcharger le serveur.


### SERP : profondeur, ville et re-test (`AuditService.runSerpJob`)
- Première page de Google ; si la page n'y figure pas et que la requête n'est pas une requête de marque, pages 2 et 3 (`--start 1 --pages 2` du script, cache distinct), soit les positions 11 à 30.
- Requête déduite d'une page locale : la ville repérée par l'IA pour cette page est ajoutée si elle manque ; rien pour une requête saisie ni pour une page de groupe sans ville unique.
- Re-test sans cache (`fresh`) quand la position s'écarte de plus de 3 rangs du dernier relevé de la même requête, ou apparaît, ou disparaît ; la seconde mesure est retenue (`SerpAnalysis.retest`).

### Cannibalisation mesurée : cas limites (`EditorialScoringEngine.withMeasurements`)
- Seule la page auditée sort : 20 pts (mesuré).
- Deux pages du site : 10 pts ; trois ou plus : 5 pts.
- La page auditée est absente mais une autre page du site sort : 10 pts, `otherPageRanks: true`, anomalie `CANNIBALIZATION_RISK` en avertissement (« Google classe une autre page du site sur cette requête »).
- Aucune page du site dans les résultats lus : non mesurable, l'estimation de l'IA est conservée avec la mention de la profondeur lue.

### Tests des moteurs de score
`npm run test:scoring` (`tests/scoring.test.ts`, node:test via tsx) vérifie les règles NAP, le dénominateur GEO, le Schema.org par type et les cas de cannibalisation mesurée. `npm run test:serp` couvre l'analyse des pages de résultats.

### Réponse de l'IA tronquée
`OpenAiCompatibleProvider` : si le modèle s'arrête sur la limite de jetons (`finish_reason = length`), un nouvel essai est fait une fois avec deux fois plus de jetons (32 000 au plus). Seulement ensuite l'erreur remonte et la page passe en évaluation heuristique, ce que l'origine de l'analyse affiche.

### Requête cible conservée
`launchAudit` reprend, page par page (clé `SiteCrawler.urlKey`), la requête de l'audit précédent : une requête saisie toujours, une requête déduite seulement si `queryBasisHash` (Title, H1 et sous-titres normalisés par `normalizeText`) est identique ; le corps de page n'y entre pas. La requête déduite est rangée dans `metricsRaw.keptQuery` et transmise à l'IA (`EditorialAnalysisInput.fixedQuery`, même balise que la requête manuelle) ; le résultat reste `source: 'AUTO'` avec `kept: true`, donc soumis à la confirmation par Google. `reanalyzePage` avec `targetQuery: null` efface `keptQuery` : l'IA redéduit la requête.

### Citabilité sans objet (contact, utilitaire)
`GeoScoringEngine` résout le rôle (manuel, puis celui de l'IA rangé dans `GeoEvaluation.role`, puis la détection) ; pour `contact` et `utility`, `aiCitability.applicable = false` : 40 pts hors dénominateur (`geoMeasuredPoints`), pas d'anomalie `LOW_AI_CITABILITY`. `rescoreEditorial` recalcule aussi le GEO, pour qu'une correction de rôle s'applique tout de suite. `replaceGeoIssues` conserve l'anomalie `AI_BOTS_POSSIBLY_FIREWALLED` (issue du test du domaine au crawl), qui disparaissait de l'accueil après l'analyse IA.

### Validation
Les mesures de variabilité, l'état de la calibration et l'essai de l'API SERP sont regroupés dans la section 5 de `docs/tableau-metriques.md`.

### Zones chaudes mesurées
`measureHotZones` (`src/core/domain/scoring/hot-zones.ts`), appliqué dans `EditorialScoringEngine.withMeasurements` : part des mots porteurs de la requête cible (`contentTokens`, pluriel en s/x confondu) présents dans le Title (6), les 100 premiers mots (5) et les H2/H3 réunis (4), au prorata. Remplace le score de l'IA (`hotZonesOptimization.source = 'MEASURED'`, détail dans `zones`) ; l'IA ne fournit plus que `actionableAdvice`. Synonymes non reconnus.
