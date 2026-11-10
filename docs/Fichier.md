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
> - **Crawl et graphe de liens.** Liens suivis jusqu'à `CrawlScope.maxDepth` clics (6 pour tout le site), puis pages du sitemap non atteintes (`discoveredVia: 'sitemap'`, profondeur -1), dans la limite de `CrawlScope.maxPages` (réglage des Paramètres, `CRAWL_MAX_PAGES` par défaut côté serveur). `linkGraphComplete` vaut false si la limite a coupé le parcours : un compte de liens entrants inférieur à 3 sort alors du score. Une page du sitemap qu'aucun lien n'atteint, sur un graphe complet, est `ORPHAN_PAGE`. Redirections suivies une à une (`redirect: 'manual'`) : `redirectHops` et `redirectStatuses` sont réels, ce qui rend mesurables les critères « code HTTP » et « chaîne de redirections ».
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
┌─────────────────────────────────────────────────────────────────────────────┐
│          PILIER ÉDITORIAL — 100 POINTS (prompt v13-2026-11-10)              │
├───────────────────────────────┬────────┬────────────────────────────────────┤
│ CRITÈRE                       │ POINTS │ RETENU POUR                        │
├───────────────────────────────┼────────┼────────────────────────────────────┤
│ Intention (grille à cases)    │ 15 pts │ pages notées                       │
│ Cannibalisation               │ 10 pts │ mesurée dans Google seulement      │
│ Couverture des recherches     │ 15 pts │ pages notées (mesurée par le code) │
│ Début de page (grille)        │ 10 pts │ réponse directe ou proposition     │
│ Critère « sujet » (grille)    │ 20 pts │ couverture (informer), crédibilité │
│                               │        │ (marque) ou savoir-faire (présenter)│
│ Auteur, date, sources         │ 10 pts │ articles seulement                 │
│ Qualité du contenu            │ 15 pts │ famille « informer »               │
│ Lisibilité mesurée            │  5 pts │ si mesurable                       │
│ Contact, légal, utilitaire    │   —    │ non notées (hors moyenne)          │
└───────────────────────────────┴────────┴────────────────────────────────────┘
```

> **Requête cible et biais.** `EditorialScoringEngine.withMeasurements` classe la requête : `MANUAL` (saisie), `CONFIRMED` (déduite, mais la requête exacte ou quasi identique est proposée par Google Autocomplete, vérifiée par `GoogleAutocomplete.fetchExact` et `isSameQuery`, ou la page est réellement trouvée dans la SERP mesurée sur exactement la même requête) ou `INFERRED`. Une SERP lancée sans trouver la page ne confirme rien, et une mesure faite sur « requête + ville » ne confirme pas la requête sans ville. Une requête `INFERRED` exclut l'intention et les zones chaudes (30 pts) du dénominateur, sauf pour une requête de marque (`queryJudged`) : juger une page sur une requête tirée d'elle-même gonflerait le score. La même fonction remplace l'estimation de cannibalisation par la mesure SERP quand elle existe ; `AuditService.rescoreEditorial` recalcule le score sans IA après chaque relevé SERP terminé.

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
1. **Requête cible par page** : choisie parmi des requêtes candidates génériques, sans la marque, proposées par l'IA et vérifiées dans Google Autocomplete (voir « Requêtes candidates » plus bas) ; pages de contact et utilitaires : déduite par l'IA comme avant. Modifiable par l'utilisateur dans le tiroir d'inspection ou d'un clic dans l'onglet Positionnement. Une requête manuelle (`targetQuerySource = MANUAL`) est prioritaire à chaque ré-analyse ; « Revenir à la détection automatique » la supprime. Champs : `Page.targetQuery`, `Page.targetQuerySource` (`AUTO` | `MANUAL`).
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
- **Depuis le prompt v12 (09/11/2026), l'estimation de l'IA n'entre plus dans la note** : `EditorialScoringEngine.criterionPoints` ne crée `points.cannibal` (10 pts, `basis: 'measured'`) que si la concurrence est mesurée dans Google (`cannibalizationRisk.source === 'SERP'` ou mesure d'une requête notée). Sur big-happy.fr (6 piliers), les 6 notes étaient des estimations, dont 5 au maximum : le critère ne départageait rien. L'anomalie `CANNIBALIZATION_RISK` estimée passe en `INFO` ; l'avertissement est réservé au conflit mesuré. Présentateur : bloc « Concurrence entre vos pages » en « Hors note » (`outOfScore`), barre « Cannibalisation » seulement si mesurée.

**Cycle de vie et coûts**
- Contenu analysé : Title, méta description, Hn et 1 000 premiers mots, conservés au crawl dans `Page.metricsRaw.content` (aucun nouveau téléchargement en phase 2).
- Cache : `Page.contentHash` (contenu crawlé) et `Page.analyzedHash` (contenu + requête manuelle de la dernière analyse IA). Le bouton « Ré-analyser » force un nouvel appel (mots-clés de départ, requête conservée, volumes, choix des requêtes notées, recherches hors page et réécriture gardés). « Repartir de zéro » (`POST …/editorial` avec `reset: true` → `reanalyzePage` → `clearEditorial`, puis analyse forcée) efface `keptQuery`, `keptCandidates`, `candidatesVersion`, `keptProblem` et `querySetOverride` de `metricsRaw`, `editorial`, `editorialStatus`, `keywords`, `opportunities` et `rewrite` de `aiEvaluationRaw`, remet `targetQuery` à null (`AUTO`) et `analyzedHash` à null ; rôle choisi (`roleOverride`), relevés Google (`serp`, `serpQueries`, `serpHistory`, `serpOpinion`) et GEO gardés. Un nouvel audit supprime tout (invariant zéro-historique) : le cache sert donc à la ré-sélection de piliers et à la ré-analyse d'une page, pas d'un audit à l'autre.
- Indicateur de moteur : `aiEvaluationRaw.editorialStatus` (`LLM` ou `HEURISTIC` avec le message d'erreur éventuel). Une page analysée en heuristique l'indique dans l'interface.

---

### 4.2.quater Mots-clés et volumes de recherche (hors barème)

Tableau du tiroir (onglet Contenu, `components/audit/keyword-research-panel.tsx`), enregistré dans `Page.aiEvaluationRaw.keywords` (`KeywordResearch`). **N'entre pas dans le score.**

- **Calcul** : `src/core/domain/keyword-research.ts`. `keywordSeeds` : requête visée, candidates, segments du Title et du H1, H2 ; marque et lieux retirés, 2 à 6 mots, `isUsableSeed`, doublons écartés (mêmes mots, pluriels confondus), 15 au plus. Un titre de page qui s'adresse au lecteur (pronoms) ou parle de cookies est écarté. Les suggestions Google Autocomplete ne servent pas de graines : sur les pages de référence, elles ajoutaient des villes au hasard et des sujets voisins. `buildKeywordRows` : volumes des graines (variantes regroupées par l'outil comprises), puis 8 idées voisines au plus qui partagent un mot avec une graine ; tri par volume ; `keywordPresence` (Title, H1, H2/H3, 1 000 premiers mots) ; `forSerp` sur les 3 meilleurs volumes non nuls, sans variante d'une requête retenue (un mot ajouté, `isSameQuery`, ou remplacé, `swapsOneWord`).
- **Source** (`KeywordVolumePort`, `src/core/ports/keyword-volume.ts`), choisie par `KEYWORD_VOLUME_PROVIDER` (`keyword-volume-provider.ts`) :
  - `google-ads` (`google-ads-keywords.ts`) : API Google Ads v26, `generateKeywordHistoricalMetrics` pour les graines et `generateKeywordIdeas` (graines + URL de la page) pour les idées, langue `languageConstants/1002`, France `geoTargetConstants/2250`, réseau `GOOGLE_SEARCH`. Variables : `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_REFRESH_TOKEN` (obtenu une fois par `node --env-file=.env scripts/google-ads/auth.mjs`, redirection `http://127.0.0.1:8765` à déclarer sur le client OAuth), `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (compte administrateur, si besoin), `GOOGLE_ADS_API_VERSION`. **État au 30/10/2026** : accès de base (Basic) obtenu, volumes réels actifs (`KEYWORD_VOLUME_PROVIDER=google-ads`). Avant l'accès, Google répondait `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`. Graines : formulations complètes (12 au plus) puis leurs **versions courtes** (`origin: 'core'`, 2 puis 3 mots porteurs de sens, petits mots du milieu gardés, mots sans sujet retirés en tête : `CORE_DROP`, élision retirée), 20 au plus : « outil d'intelligence marché » n'avait ni volume ni idée, « intelligence marché » et « veille concurrentielle » en ont. Sans idée avec l'URL de la page, nouvel essai avec les seuls mots-clés. Idées voisines gardées si elles partagent au moins 2 mots porteurs de sens avec une même graine, ou un seul mot non général (`GENERIC_TOKENS`, sinon `weak`) ; **avis de l'IA** (`llmGateway.judgeKeywords`, 25 mots-clés à volume ≥ 20 au plus, un appel par page, pas sur des volumes simulés) : `relevance` match / broad / off, avec la problématique et le rôle de la page dans la consigne ; un « match » doit citer une phrase de la page (`evidence`) que `matchEvidenceVerified` retrouve mot pour mot et qui partage au moins un mot porteur de sens avec la recherche, sinon « broad » ; `buildQuerySet` ne note d'office que les « match » (sans avis : tout sauf `weak`). **Depuis le 30/10/2026, toutes les analyses passent par `claude/claude-sonnet-4-5`** (`LLM_MODEL`, via OmniRoute) : l'accès Antigravity de `gpt-oss-120b` a été refusé par Google (401). Le modèle entre dans la clé de cache : chaque page sera ré-analysée à sa prochaine analyse. Modèle dédié au tri : `LLM_JUDGE_MODEL` (essayé en premier pour ce seul appel, `LlmRequest.model`, le modèle habituel en relais) ; essai du 30/10/2026 avec `claude/claude-sonnet-4-5` sur 5 pages : tri cohérent là où `gpt-oss-120b` oscillait (« aide à domicile » écartée pour un EHPAD, « agence de communication » gardée pour big-happy.fr). Appels Google Ads : un nouvel essai après une coupure réseau ; recherche en échec, volumes précédents gardés (`keepPreviousKeywords`, champ `warning`). La règle « requête de marque seule » ne vaut plus que pour contact et utilitaire : sur une autre page, une requête cible qui contient la marque est ignorée ; variantes que Google compte comme une seule recherche (même volume et mêmes chiffres mois par mois) gardées une fois. `buildQuerySet` ignore les volumes de moins de 20 (`MIN_SCORED_VOLUME`, « 10 » étant le plus petit palier). `brandVariants` prend le label placé avant l'extension (« fr.yamaha.com » donne « yamaha »).
  - `mock` (`mock-keyword-volumes.ts`) : volumes **inventés**, stables pour un même mot-clé, pour tester l'écran. Affichés « Volumes simulés » et « (simulé) » en bleu.
  - `none`, ou rien de configuré : liste sans volume.
- **Déclenchement** : à la fin de `analyzeEditorial` quand l'IA a répondu, ou `POST /api/audits/[auditId]/pages/[pageId]/keywords` (`AuditService.researchKeywords`, aucun appel IA). Une source en échec n'arrête rien : le message est affiché en bleu.

### 4.2.quater-bis Recherches hors page (hors barème, sauf recherche cochée)

Bloc du tiroir (onglet Contenu, `components/audit/keyword-opportunities-panel.tsx`, sous le tableau des mots-clés), enregistré dans `Page.aiEvaluationRaw.opportunities` (`KeywordOpportunities`). **À la demande seulement** : `POST /api/audits/[auditId]/pages/[pageId]/opportunities` → `AuditService.researchKeywordOpportunities`. Pensé pour une page dont le contenu ne donne pas de bonnes recherches (fiche produit pauvre, titres de modèle Shopify : « tes mensurations », « avis clients »).

- **Étapes** (`audit-service.ts`) : (1) recherches déjà connues de la page (`known` : requêtes notées, choix de l'utilisateur, mots-clés, requête visée, candidates) ; (2) `provider.ideas(seeds, { limit: 60 })` **sans URL** (`keywordSeed` seul) ; Keyword Planner en échec : arrêt avant l'appel à l'IA ; (3) autres pages du même audit (statut 200, indexables), sans les traductions de la page (même fin d'adresse), les plus courtes d'abord ; (4) résultats Google déjà relevés (`serpQueries`, `serp`, statut `DONE`, 10 premiers) : titres pour l'IA, domaines pour `brandsFromDomains` ; (5) `llmGateway.suggestOpportunities` (prompt `OPPORTUNITY_PROMPT`, schéma `OpportunitySchema` : `keyword`, `kind`, `evidence`), 20 au plus, type inconnu lu comme `attribute` ; (6) marque du site écartée, lieux ciblés retirés (`stripPlaces`), `isUsableSeed` ; (7) `provider.volumes()` (nouvelle méthode du port : `generateKeywordHistoricalMetrics` seul, 40 mots-clés au plus ; source de démonstration : volumes inventés) ; (8) `classifyOpportunities` ; (9) analyse relue juste avant l'enregistrement (l'appel à l'IA dure 10 à 30 s) ; note recalculée seulement si des requêtes sont déjà choisies à la main (leur poids peut changer).
- **Statut** (`src/core/domain/keyword-opportunities.ts`, fonctions pures) : `rejected` (`third-party-brand` si `kind = brand` ou si un mot correspond à `brandsFromDomains` ; `no-volume` ; `low-volume` sous `MIN_SCORED_VOLUME` = 20) ; sinon `foreign` = mots porteurs de sens absents du Title et du H1 de la page, hors `GENERIC_TOKENS` ; si `kind = product` ou s'il manque des mots, une autre page dont le Title ou le H1 contient tous les `foreign` (`containsKeyword`) donne `other-page` ; sinon `ready` si aucun mot ne manque dans la page (Title, H1, sous-titres, 1 000 premiers mots, pluriels confondus par `stem`), `off-offer` si `kind = product`, `confirm` sinon (`missing` liste les mots absents). `brandsFromDomains` : `brandVariants` de chaque domaine, sans la marque du site ; un domaine dont une variante reprend un mot du Title ou du H1 est écarté en entier (« veste-maroc.com » donne aussi « vestemaroc », écarté). `broad` (pour `ready` et `confirm`) : moins de `min(2, n)` mots en commun avec le sujet (requête visée, sinon H1, sinon Title), même règle que les idées « lien faible ». `seasonalityOf` : `peakRatio` = mois le plus fort / moyenne des 12 mois (arrondi au dixième), gardé à partir de `SEASONAL_PEAK_RATIO` = 2 ; `recent` si les 3 premiers mois sont à 0. `evidence` gardée seulement si retrouvée mot pour mot (8 caractères au moins). Doublons : mêmes mots porteurs de sens qu'une recherche connue ou déjà gardée (`sameWords`, pas `isSameQuery` qui accepte un mot de plus : « veste maroc noir » n'est pas « veste maroc ») ; variantes regroupées par Keyword Planner (même entrée de volume) gardées une fois. Tri : statut, puis recherches du sujet avant les plus larges, puis volume.
- **Note** : `buildQuerySet` reçoit `opportunities` (champ `RawPageData.keywordOpportunities`, lu par `toRawPage`) ; elles ne sont **jamais notées d'office**. Leur volume ne sert qu'aux requêtes choisies à la main (`volumeOf` cherche dans les mots-clés puis dans les recherches hors page ; volumes simulés ignorés). La case « Notée » (intégrables et à confirmer, désactivée sur des volumes simulés) passe par `useQuerySetToggle` (`components/audit/use-query-set-toggle.ts`, partagé avec le tableau des mots-clés) et `POST …/queries`. L'intention d'une requête ajoutée est jugée à la prochaine analyse de la page.
- **Correctif lié (05/11/2026)** : en repli sans volume retenu, `buildQuerySet` saute une candidate dont un volume réel connu (mots-clés ou recherches hors page) est inférieur à 20.
- **Tests** : `tests/scoring.test.ts`, « Recherches hors page : statut calculé par le code… » et « Requêtes notées : recherches hors page notées seulement cochées… ».

### 4.2.sexies Graphiques de la Synthèse et de « L'essentiel » (hors barème)

- **Domaine** (`src/core/domain/scoring/score-losses.ts`) : `techCriteria(breakdown, unmeasured)` (6 catégories, plafonds moins points non mesurés), `editorialCriteria(points)`, `geoCriteria(geo)` (robots IA 15, citabilité 40 sauf contact et utilitaire, sources 5, Schema.org 25, NAP `napMeasuredPoints`), `pageLosses` (perte ramenée sur la note du pilier, ≥ 0,5 pt), `siteGains` (Σ perdus / Σ mesurés × 100 par pilier, × `PILLAR_WEIGHT`). Rubrique du tiroir par critère (`section`). `TechScoringEngine` renvoie aussi `unmeasuredBreakdown` ; l'exploration enregistre `metricsRaw.techBreakdown` et `techUnmeasured`.
- **Présentateur** (`src/adapters/primary/presenters/dashboard-data.ts`) : `techCriteriaOf` (détail enregistré, sinon recalcul de `TechScoringEngine` avec robots.txt et sitemap déduits des anomalies, gardé seulement si la note recalculée égale la note enregistrée, mis en cache par page), `lossesOfPage`, `siteGainsOf` (pages de la moyenne technique : hors noindex volontaire ; éditorial et GEO : piliers accessibles), `searchDemandOf`, `pageHealthOf`. `lib/score-bands.ts` : `bandOf` (< 60, 60-79, ≥ 80), `bucketOf` (top 3, 4-10, 11-30, absente, non mesurée), sans dépendance lourde (utilisé côté navigateur). `ProjectAuditData.dashboard` (`history`, `gains`, `techDetail`, `searchDemand`, `pageHealth`) et `InspectionData.essentials` (`losses`, `previous`, `cwv`). La route `GET /api/projects/[projectId]/audit` lit les 7 audits terminés précédents (notes) et les pages du dernier (notes par adresse).
- **Interface** : `components/charts/viz.tsx` (`StatTile`, `Delta`, `Sparkline`, `RingMeter` et `BarMeter` (jauges d'une note : remplissage dans la couleur de l'état, piste d'un pas plus clair de la même couleur via `color-mix`, nom accessible avec la note et l'état), `RankedBars`, `StackedBar` (`showShare`), `ThresholdMeter`, `compact`, `lowerFirst`), SVG et CSS sans bibliothèque ; couleurs `--viz-*` dans `app/globals.css` (validées avec `validate_palette.js` du skill dataviz : rampe ordinale des positions dans les deux thèmes ; le rouge et le vert d'état ne se distinguent pas en deutéranopie, d'où la mention écrite et la position fixe). `components/audit/synthesis-view.tsx` et `inspection-essentials.tsx` les utilisent. Capture Patchright : une `addInitScript` bloque le chargement de l'application ; passer en thème clair après chargement (`document.documentElement.dataset.theme = 'light'`).

### 4.2.quinquies Réécriture proposée (hors barème)

`src/core/domain/page-rewrite.ts` : `writingGuide(role)` (fiche par rôle : informer, offre, institutionnel, réalisation, contact ; sans effet sur la note), `REWRITE_RULES`, `rewriteMessage`, `contentHeadings` (bandeau de cookies écarté, espaces réduits), `matchHeading` (H2 réellement présents), `unverifiedFacts` (noms propres hors début de phrase et nombres absents de la page, nombres de un à douze en lettres acceptés, marqueurs « [À COMPLÉTER] » ignorés). `llmGateway.proposeRewrite` (`RewriteSchema` : title, meta, h1, sections, newSections ; 12 sections réécrites et 3 ajoutées au plus). `AuditService.proposeRewrite(auditId, pageId, { force })` : requête la plus lourde du groupe de requêtes notées comme principale, les autres comme secondaires, enregistré dans `aiEvaluationRaw.rewrite` avec `basedOn` (`RewriteBasis` : empreinte du contenu, famille (absente avant le 09/11/2026 : non comparée), requête principale, `queries` = requêtes notées par poids décroissant, absent avant le 05/11/2026) ; `isRewriteOutdated(basedOn, current)` compare ces champs, la liste des requêtes sans tenir compte de l'ordre, et seulement la requête principale pour une proposition sans `queries` ; une proposition à jour est rendue sans nouvel appel sauf `force`. Route `POST /api/audits/[auditId]/pages/[pageId]/rewrite`. Présentateur : `editorial.rewrite` avec `outdated` (`isRewriteOutdated`). Interface : `components/audit/page-rewrite-panel.tsx`, affiché quand l'analyse IA existe ; **seul endroit des Title et méta prêts à copier**, rédigés seulement au clic (bloc « Livrables prêts à l'emploi » retiré le 05/11/2026 ; rien n'est affiché avant). L'analyse de la page ne demande plus `suggestedTitle` / `suggestedMeta` à l'IA (`snippet` garde `score`, `titleCritique`, `metaCritique` ; les champs restent optionnels dans `types.ts` pour les analyses anciennes, jamais affichés ; `findUnverifiedTerms` supprimé). PDF de la page (`page-print-sheet.tsx`, « Textes prêts à copier ») : seulement avec une réécriture à jour. Anomalie `WEAK_SNIPPET` : étape unique `SNIPPET_REWRITE_STEP` (renvoi vers « Proposer une réécriture »), imposée aussi par le présentateur aux anomalies enregistrées avant.

### 4.2.ter Diagnostics éditoriaux complémentaires (hors barème)

Ces diagnostics s'ajoutent au pilier éditorial sous forme d'anomalies (`INFO` ou `WARNING`) et d'accordéons dédiés dans le tiroir d'inspection. **Ils n'entrent pas dans le score sur 100** : le barème du §4.2 est inchangé. Chaque accordéon le rappelle.

**Heuristiques objectives** (calculées au crawl dans `src/adapters/secondary/crawler/editorial-signals.ts`, sans appel IA, stockées dans `Page.metricsRaw.content.signals`). Le « contenu principal » est `main`, à défaut `article`, à défaut `body`, après retrait de `nav`, `header`, `footer`, `aside`, des formulaires et des rôles `navigation`, `banner` et `contentinfo`.

| Diagnostic | Mesure | Anomalies |
| :--- | :--- | :--- |
| **Fraîcheur et obsolescence** (accordéon 8) | Années vieilles d'au moins 2 ans dans le Title, le H1 et le texte, avec ~50 caractères de contexte. `staleMentions` (`scoring/freshness.ts`, 10/11/2026) écarte, dans le moteur et le présentateur, les années qui datent un début ou un fait historique (`isHistoricalMention` : « depuis », « dès », « fondé·e / créé·e / lancé·e / né·e en » devant l'année dans l'extrait) ; l'extraction du robot est inchangée, les audits enregistrés en profitent sans nouvelle exploration. Date de mise à jour lue dans `article:modified_time`, `og:updated_time`, `dateModified` (microdonnées et JSON-LD). | `OUTDATED_YEAR_MENTIONS` (`INFO`, cite les extraits et le statut de la date), `STALE_UPDATE_DATE` (`INFO`, date de mise à jour de plus de 2 ans). L'absence de date de mise à jour ne déclenche pas d'alerte à elle seule. |
| **Lisibilité et scannabilité** (accordéon 9) | Longueur moyenne des paragraphes `<p>`, paragraphes de plus de 100 mots, part de phrases de plus de 25 mots, nombre de listes (au moins 2 `li`) et de tableaux. | `DENSE_PARAGRAPHS` (`WARNING`, moyenne supérieure à 80 mots ou plus de 40 % de paragraphes longs, à partir de 3 paragraphes), `LONG_SENTENCES` (`INFO`, plus de 35 % de phrases longues, à partir de 10 phrases), `NO_LISTS_OR_TABLES` (`INFO`, 600 mots ou plus sans liste ni tableau). Moins de 3 paragraphes : mesure signalée comme peu fiable, sans alerte. |
| **Maillage dans le contenu** (accordéon 10) | Liens du contenu principal uniquement (internes, externes), avec repérage des ancres vides ou génériques (« en savoir plus », « cliquez ici », « lire la suite », « read more »…), comparées sans accents ni ponctuation. | `GENERIC_ANCHORS` (`INFO`, `WARNING` à partir de 3), `NO_CONTEXTUAL_LINKS` (`INFO`, 500 mots ou plus sans aucun lien interne dans le contenu). |

**Analyse IA** (ajoutée à la requête d'analyse existante, aucun appel supplémentaire ; contrat `quality` du schéma Zod). Ce sont des indices, sans comparaison avec les pages concurrentes.

| Diagnostic | Mesure | Anomalies |
| :--- | :--- | :--- |
| **Expérience vécue** (accordéon 11) | Preuves de vécu réelles : première personne, retours de terrain, cas clients, anecdotes. Courts extraits copiés de la page comme preuves. | `NO_FIRST_HAND_EXPERIENCE` (`INFO`, famille `inform` seulement depuis le 10/11/2026) |
| **Gain d'information** (accordéon 11) | Niveau faible / moyen / élevé, données ou méthode propres, cas concrets, passages génériques, limites évoquées. | `GENERIC_CONTENT` (`INFO`, niveau faible, famille `inform` seulement depuis le 10/11/2026) |
| **Réassurance** (accordéon 11) | Blocs absents utiles à la page : déroulé du premier contact, délais, tarifs indicatifs, réalisations, garanties, localisation. | `MISSING_REASSURANCE` (`INFO`, 2 blocs absents ou plus) |

**Balisage Schema.org E-E-A-T.** Le balisage JSON-LD qui porte les signaux E-E-A-T (auteur, éditeur, dates) relève du pilier GEO et est proposé dans l'onglet GEO (voir §4.3, critère 5). L'accordéon « Signaux E-E-A-T » de l'onglet éditorial ne traite que les signaux visibles sur la page (auteur, date, sources) et renvoie vers l'onglet GEO.

**Ordre des accordéons de l'onglet éditorial** (utilisé par le routage des anomalies, `lib/issue-routing.ts` ; indices à partir de 0, le numéro affiché dans le titre vaut l'indice + 1, d'où « accordéon 8 » pour la fraîcheur dans les tableaux ci-dessus) : 0 intent et cannibalisation, 1 zones chaudes, 2 contenu primaire, 3 E-E-A-T, 4 snippet SERP, 5 requêtes Google et content gaps, 6 ancrage local, 7 fraîcheur, 8 lisibilité, 9 maillage dans le contenu, 10 expérience vécue et gain d'information. Les accordéons 4 à 6 et 10 s'affichent même sans analyse IA, avec la mention « Non disponible », pour garder des positions stables. Sur un audit antérieur à ces diagnostics, les accordéons 7 à 9 invitent à relancer l'audit.

---

### 4.2.quater Rôle des pages et cohérence du site

**Rôle de la page** (`src/core/domain/scoring/page-role.ts`) : accueil, marque / institutionnelle, contact, offre / service, réalisation / étude de cas, article / contenu informatif, liste / hub, utilitaire (mentions légales, plan du site, politique de confidentialité). Il est déterminé, du plus fiable au moins fiable, par : le chemin des pages utilitaires et de contact ; le type Schema.org (`Article`, `BlogPosting`, `ContactPage`, `AboutPage`, `CollectionPage`…) ; `og:type` ; le nombre d'éléments `<article>` (plusieurs cartes = liste) ; la date de publication dans les balises meta ; le nom de la rubrique (« actualités », « clients »…) ; les pages citées dans le contenu d'une telle rubrique ; enfin les mots du chemin. À défaut : offre / service. Pour un pilier, l'IA reçoit ce rôle et peut le corriger en le justifiant (sans appel supplémentaire). Une **correction manuelle** (liste déroulante dans Subpages) prime sur tout et recalcule le score éditorial d'un pilier déjà analysé sans nouvel appel à l'IA. Les pages utilitaires comptent parmi les rôles à faible enjeu de classement dans l'avertissement de sélection des piliers. Il adapte les attentes :
- **E-E-A-T (10 pts)** : auteur, date et sources ne se demandent qu'à un **article**. Pour les autres rôles, le critère est « sans objet » et sort du dénominateur : le score éditorial est ramené sur 90 points puis sur 100. Aucune anomalie `LOW_EEAT_SIGNALS` hors article. Le modèle donne un conseil de confiance adapté (identité légale, agréments, direction nommée, coordonnées) sans exiger d'auteur.
- **Réponse directe** : pour un article ou un contenu informatif, une réponse ou un résumé ; pour les autres pages, une proposition claire (ce qui est proposé et pour qui, de façon précise). L'action visible n'est plus jugée (conversion, pas classement) : elle peut revenir en piste bleue.
- **Famille** (`page-family.ts`) : déduite du rôle, elle décide du critère « sujet », de la qualité du contenu et de l'exclusion des pages de contact et légales (voir plus bas le paragraphe « Famille de la page »).
- **Expérience vécue** : demandée aux articles, aux offres et aux réalisations seulement ; les avis clients ne comptent pas comme expérience de l'auteur. **Gain d'information** : sans objet pour une page de contact.
- **Requêtes Google (Autocomplete)** : non interrogées pour les pages de contact et utilitaires, dont la requête n'est pas thématique (sauf requête saisie par l'utilisateur). Pour les autres, la graine est la requête cible (saisie, conservée ou choisie parmi les candidates), puis des segments courts et sans la marque du H1 et du Title, avec plusieurs essais.

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

**Onglet SEO éditorial d'une page pilier.** Construit par `src/adapters/primary/presenters/editorial-sections.ts`, dans un ordre fixe auquel `lib/issue-routing.ts` renvoie par indice : 0 intention, 1 cannibalisation (« Hors note » si estimée), 2 zones chaudes, 3 réponse directe ou proposition claire, 4 couverture du sujet ou « Présentation et preuves » (sans objet pour une page non notée), 5 E-E-A-T (masqué hors article), 6 ce que montre Google, 7 Title et méta, 8 ancrage local (masqué hors établissement local), 9 fraîcheur, 10 lisibilité, 11 liens dans le contenu, 12 expérience vécue et originalité (masqué pour contact et utilitaire). L'en-tête compare l'intention de la page à celle de Google et donne la position mesurée ; pour une requête de marque, une autre page du site en tête est normale (bleu). Chaque constat porte sa source (Mesuré, Google, Estimation IA). Les suggestions Autocomplete enregistrées sont refiltrées à l'affichage (`autocomplete-relevance.ts`) et l'intention de la SERP est recalculée depuis les résultats stockés.

**Tableaux par requête et indications hors note** (10/11/2026). `EditorialAccordion.queries` (`QueryMatrixData`, `lib/audit-data.ts` : `source` `ai` ou `measured`, colonnes avec libellé court, complet et maximum, une ligne par requête avec poids, volume, note et cellules, note du critère). `editorial-sections.ts` : `intentMatrix` (cases `INTENT_CHECKS` retrouvées par libellé dans `intentPassed` / `intentFailed` ; absent si une requête jugée n'a pas ses cases, les lignes de texte restent alors) et `coverageMatrix` (`QuerySetMeasure.coverage.zones`, points et mots absents de chaque zone, enregistrés par `EditorialScoringEngine` depuis cette date : un `rescoreAudit` suffit à les remplir ; mots absents réécrits comme dans la requête par `queryWords`). `coverageAction` remplace l'avis de l'IA quand le tableau existe : deux requêtes au plus, triées par poids × points manquants (0,5 pt au moins), zones où les placer, gain arrondi à l'unité inférieure. Composants : `components/audit/query-matrix.tsx` (`QueryMatrix` : cases oui en vert, non en bleu, zones avec barre `--viz-accent` sur `--viz-track`, infobulle des mots absents, légende des cases) affiché par `EditorialBlock` et `EditorialNote` ; `QueryTable` dans `page-print-sheet.tsx`. `outOfScore` et `excluded` passent le bloc dans le groupe `diagnostic` ; `diagnostic()` donne « Pistes de l’IA » quand les seuls constats sont des estimations de l'IA (avec l'action), « N à revoir » seulement pour un constat mesuré. `EditorialNote` (`editorial-block.tsx`) rend ces blocs en texte (titre, état écrit, constat, « Piste », détail à ouvrir, même ancre `inspection-acc-N`), section « Indications hors note » de `page-inspection-sheet.tsx` ; ligne « Rien à signaler » en liens texte. Title et méta : repères `TECH_THRESHOLDS` (30 à 65, 110 à 165) ; attrait pour le clic et ancrage local estimés par l'IA en `info`. `qualityAccordion` : constats de l'IA en `info`, conseil seulement dans l'action ; `DIAGNOSTIC_NOTE` retiré (la section dit déjà « sans effet sur la note », et la lisibilité notée affichait « hors barème »).

**Points à traiter d'une page (tiroir d'inspection).** Dans chaque onglet (Technique, Éditorial, GEO), la liste « À traiter » est coupée en deux groupes : « Font varier le score » (anomalies liées à un critère noté, avec les points en jeu, ex. « jusqu'à 8 pts ») et « Sans effet sur le score » (diagnostics et recommandations : longueur du H1, plusieurs H1, hiérarchie Hn, snippet, content gaps, fraîcheur, lisibilité, expérience vécue…). La correspondance code d'anomalie / points est dans `lib/score-effect.ts` et doit rester alignée sur les moteurs de scoring ; les points sont donnés avant normalisation des critères non mesurés ou sans objet.

**Onglet Issues & Tips.** Les anomalies sont regroupées par impact, dans l'ordre : « À corriger en priorité » (impact fort), « À planifier » (moyen), « Améliorations mineures » (faible, repliée par défaut) et « Visibilité dans les moteurs IA » (GEO, repliée par défaut). Quatre tuiles en tête comptent les anomalies et les pages concernées par niveau et filtrent la liste d'un clic. Les filtres combinent le pilier (Technique, Éditorial, GEO), la gravité (critique, avertissement, info) et une recherche libre, avec des compteurs et un bouton de réinitialisation. Chaque anomalie affiche son pilier, sa gravité et le nombre de pages ; dépliée, elle donne la description, les étapes pour corriger (« Comment corriger »), les 5 premières pages concernées avec leurs indicateurs, et un lien vers la liste complète. Les liens de la synthèse (`?filter=critical|warning|passed`) préfiltrent la gravité.

**Codes couleur.** Rouge : critique ; jaune : avertissement ; bleu : info (recommandation mineure). Le vert n'est jamais utilisé pour une anomalie à corriger. Dans le tiroir d'inspection, chaque point à traiter renvoie vers le bloc détaillé concerné (ouvert et amené à l'écran). Subpages affiche le score technique de chaque page.

**Détection des signaux de page.** Les données structurées (JSON-LD, y compris racine en tableau et `@graph`, microdonnées `itemtype`, RDFa `typeof`), l'auteur, la date et les liens d'autorité sont lus **avant** le retrait de `script`, `nav`, `header` et `footer` du DOM (ils étaient auparavant perdus). Un balisage ajouté par JavaScript reste invisible de ce crawler (qui n'exécute pas le JavaScript) : l'analyse GEO le précise et renvoie au test des résultats enrichis de Google. Le critère GEO indique « détecté », pas « valide » : la validité du balisage n'est pas contrôlée.

**Synthèse de l'audit** (`synthesis-view.tsx`, refonte du 08/11/2026). Trois étages : `OverviewCard` (note globale en `RingMeter`, mention, `Delta` et `Sparkline` ; phrase `advice.headline` et détail `advice.points` dans un `<details>` ; piliers en `BarMeter` avec leur poids `PILLAR_WEIGHTS` ; `KeyFigures` : part de la demande mesurée dans le top 10 ou recherches à mesurer (`demandSummary`), pages techniques sous 60 (`pageHealth`), domaines référents (`backlinkSummary`)), `ActionsCard` (« Par où commencer » : 5 premiers `dashboard.gains`, compteurs d'anomalies par gravité vers `/global-issues?filter=`), puis `GoogleCard`, `PagesCard`, `ReachCard` (`ContextCard` commune ; `StackedBar` en barre fine `height={10}` `showShare={false}`). « Vos priorités pour monter dans Google » (`pickPriorities`) et l'encadré du conseil sont retirés de la synthèse ; la mention de ce que l'outil ne mesure pas (liens entrants, positions réelles, force des concurrents) passe dans « Sources et limites », repliable. Les anomalies sont triées par impact dans toutes les listes. Le compteur « recommandations mineures » regroupe les anomalies de niveau `INFO`.

**Conseil de synthèse** (`src/adapters/primary/presenters/synthesis-advice.ts`, sans appel IA supplémentaire). Une fois les piliers analysés, la synthèse affiche un conseil construit à partir des analyses : le critère éditorial le moins bien servi en moyenne (avec le conseil de la page la plus concernée), le point fort à conserver et l'action rapide de la page au score éditorial le plus bas. Une note précise si certaines pages ont été analysées sans IA.

**Années obsolètes.** Une année n'est signalée que dans un contexte de date (« en », « depuis », « mis à jour », un mois, une date numérique) dans le texte, ou librement dans le Title et le H1. Les nombres suivis d'une monnaie ou d'une unité (€, W, kg, mm…) et ceux précédés de « modèle », « réf », « RCS », « Air Top »… sont ignorés.

---

### 4.3.ter Positionnement Google (SERP)

**Reprise après interruption** (`src/core/services/job-registry.ts`, `AuditService.recoverInterrupted`). Les travaux en arrière-plan (exploration, analyse IA, mesure Google) sont suivis dans un registre gardé sur `globalThis` (il survit au rechargement à chaud de Next.js, pas à un arrêt du serveur), avec un signe de vie à chaque page explorée, page analysée, recherche faite ou relevé enregistré. Un travail absent du registre (serveur redémarré) ou sans signe de vie depuis 30 minutes (audit) ou 15 minutes (mesure Google) est interrompu : exploration → audit `FAILED` (« Réessayer ») ; analyse IA → `AWAITING_AI_SELECTION` avec un message bleu dans Sous-pages (les pages déjà analysées ne sont pas refaites, cache par empreinte) ; recherches Google `RUNNING` → `PENDING` « Interrompue : reprenez la mesure », reprises par « Reprendre ». Appelé par `GET /api/projects`, `GET /api/projects/[projectId]/audit`, `GET /api/audits/[auditId]` et avant chaque nouvelle mesure ; remplace l'ancien drapeau `serpJobRunning`, qui restait bloqué après un arrêt.

Onglet **Positionnement** : position réelle des pages piliers sur leur requête cible, et pages qui se classent devant elles. C'est un **résultat mesuré, hors du score sur 100**, lancé à la demande sur **toute page explorée, indexable et accessible** (piliers ou non, sans passer par l'analyse IA) : cases à cocher pour une sélection (20 pages au plus par lancement) ou bouton par ligne. Colonne « Requêtes à mesurer » (`QueryChooser`) : la requête cible de la page (à défaut son H1), puis les mots-clés « Fort volume » (`keywordsForSerp`, volumes Keyword Planner, voir §4.2.quater), puis ses candidates suggérées par Google, puis celles de l'IA. Cible et mots-clés à fort volume sont cochés ; les candidates complètent jusqu'à 3. L'utilisateur coche, décoche ou ajoute une requête (champ et bouton « + », ou Entrée ; « × » retire une requête ajoutée), 6 cochées au plus (`MAX_CHOSEN_SERP_QUERIES`). Les requêtes mesurées sont affichées sous la position avec « En faire la requête cible ». L'onglet est disponible dès la fin du crawl.

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

#### GEO mis de côté (depuis le 05/11/2026)

`GEO_ENABLED = false` (`src/core/domain/features.ts`), à la demande de l'utilisateur. **Ce qui tourne toujours** : `GeoScoringEngine`, partie GEO de l'analyse IA, anomalies GEO (table `issues`, pilier `GEO`), `Page.geoScore`, `Audit.geoScore`, `aiEvaluationRaw.geo`, écran `components/audit/geo-view.tsx`. **Ce qui change** :
- Notes : `GlobalScoringEngine.computePageScore` = (technique + éditorial) / 2 pour une page pilier analysée ; `PILLAR_WEIGHTS` = { tech : 0,4 / 0,75, editorial : 0,35 / 0,75, geo : 0 } pour `computeProjectScore`, la note de repli du présentateur et `score-losses.PILLAR_WEIGHT`.
- Présentateur : anomalies du pilier GEO non transmises (`toProjectAuditData`), `scores.geo` à null, critères GEO absents des points perdus (`lossesOfPage`, `siteGainsOf`) et de l'état des pages (`pageHealthOf`).
- Interface : entrée « GEO » du menu (`app-sidebar.tsx`), `/projets/[id]/geo` renvoyé vers la synthèse, onglet « Moteurs IA » de la fiche (`page-inspection-sheet.tsx` ; `inspection-provider.tsx` ouvre « L'essentiel » à la place d'un lien `tab=geo`), note et actions GEO de « L'essentiel », tuile GEO de la synthèse (poids affichés depuis `PILLAR_WEIGHTS`), filtre GEO des anomalies, jauges, colonne et glossaire GEO des PDF, colonne « Moteurs IA » de la liste des projets, textes d'accueil.
- Notes enregistrées recalculées le 05/11/2026 par un script ponctuel (pages piliers : `pageScore` ; audits : `overallScore`, sans toucher `completedAt`) ; copie de la base avant recalcul gardée hors du dépôt.
- **Réactiver** : `GEO_ENABLED = true`, puis recalculer `pageScore` et `overallScore` de la même façon (`computePageScore`, `computeProjectScore` avec `measuredPoints`). Tests : `tests/scoring.test.ts` suit le réglage.

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
- Requêtes mesurées par page : la liste cochée envoyée par l'onglet (`queryLists` de `POST /api/audits/[id]/serp`, nettoyée par `chosenSerpQueries` : 120 caractères, sans doublon, 6 au plus, mesurée telle quelle) ; à défaut (`serpQueriesOf`, `serpQueriesFor`) la requête cible, puis les candidates suggérées par Google, puis les autres, 3 au plus. Une reprise (`resume`) refait les requêtes du lancement interrompu (lues dans `serpQueries`). Requête cible absente de la liste : `markTargetSkipped` enregistre `aiEvaluationRaw.serpTargetSkipped`, et le présentateur affiche le relevé de la première requête avec `SubpageItem.serpTargetSkipped` au lieu de `serpOutdatedQuery`. L'ancien champ `queries` (requête saisie devenant cible manuelle) reste accepté par l'API, l'onglet ne l'envoie plus. Concurrents lus pour la requête cible seulement. Relevés rangés dans `aiEvaluationRaw.serpQueries` ; `serp` reste le relevé de la requête cible (il sert au score). Chaque relevé terminé entre dans `serpHistory` (dédoublonné par date et requête). Un captcha annule les recherches restantes de la page et des pages suivantes.
- Après les recherches d'une page pilier, `switchToMeasuredQuery` : si la requête cible est déduite, non suggérée par Google et absente des résultats, alors que la page sort sur une candidate (`betterMeasuredTarget`), la requête de ce relevé devient la cible (`keptQuery`), `serp` prend ce relevé et la page est ré-analysée par l'IA.
- Re-test sans cache (`fresh`) quand la position s'écarte de plus de 3 rangs du dernier relevé de la même requête, ou apparaît, ou disparaît ; la seconde mesure est retenue (`SerpAnalysis.retest`).

### Cannibalisation mesurée : cas limites (`EditorialScoringEngine.withMeasurements`)
- Seule la page auditée sort : 20 pts (mesuré).
- Deux pages du site : 10 pts ; trois ou plus : 5 pts.
- La page auditée est absente mais une autre page du site sort : 10 pts, `otherPageRanks: true`, anomalie `CANNIBALIZATION_RISK` en avertissement (« Google classe une autre page du site sur cette requête »).
- Aucune page du site dans les résultats lus : non mesurable, l'estimation de l'IA est conservée avec la mention de la profondeur lue.

### Tests des moteurs de score
`npm run test:scoring` (`tests/scoring.test.ts`, node:test via tsx, 101 cas) vérifie les règles NAP, le dénominateur GEO, le Schema.org par type, les cas de cannibalisation mesurée et les requêtes candidates (marque écartée, choix de la cible, requêtes mesurées, remplacement). `npm run test:serp` couvre l'analyse des pages de résultats.

### Réponse de l'IA tronquée
`OpenAiCompatibleProvider` : si le modèle s'arrête sur la limite de jetons (`finish_reason = length`), un nouvel essai est fait une fois avec deux fois plus de jetons (32 000 au plus). Seulement ensuite l'erreur remonte et la page passe en évaluation heuristique, ce que l'origine de l'analyse affiche.

### Requête cible conservée
`launchAudit` reprend, page par page (clé `SiteCrawler.urlKey`), la requête de l'audit précédent : une requête saisie toujours, une requête déduite seulement si `queryBasisHash` (Title, H1 et sous-titres normalisés par `normalizeText`) est identique ; le corps de page n'y entre pas. La requête déduite est rangée dans `metricsRaw.keptQuery` et transmise à l'IA (`EditorialAnalysisInput.fixedQuery`, même balise que la requête manuelle) ; le résultat reste `source: 'AUTO'` avec `kept: true`, donc soumis à la confirmation par Google. `reanalyzePage` avec `targetQuery: null` efface `keptQuery` et `keptCandidates` : l'IA propose de nouvelles candidates.

### Requêtes candidates (`src/core/domain/scoring/query-candidates.ts`)
Pages autres que contact et utilitaires, sans requête saisie ni conservée : `AuditService.proposeCandidates` appelle `llmGateway.proposeQueries` (prompt `QUERY_PROPOSAL_PROMPT` : 5 recherches génériques sans la marque, avec les autres piliers pour ne pas reprendre leur sujet), puis `sanitizeCandidates` écarte la marque (`containsBrand`, variantes `brandVariants` du domaine), les rubriques (`isUsableSeed`) et les doublons (`isSameQuery`), 5 au plus. Chaque candidate est vérifiée par `GoogleAutocomplete.fetchExact` (`suggestedByGoogle`). `chooseTargetQuery` : première suggérée parmi les 3 premières, sinon la première ; transmise à l'IA par `EditorialAnalysisInput.chosenQuery` (même balise que la requête manuelle, sans `kept`). Les candidates sont rangées dans `SearchInsights.candidates` et `metricsRaw.keptCandidates`, reprises d'un audit à l'autre avec la même empreinte que la requête. Une `keptQuery` n'est reprise sur une page à candidates que si des candidates existent et qu'elle ne contient pas la marque. `SearchInsights.targetQuery.isBrand` (marque dans la requête, ou page de contact ou utilitaire) remplace la règle par le rôle dans `EditorialScoringEngine` et `editorial-sections.ts` ; absent (analyse antérieure) : règle par le rôle. L'empreinte `analyzedHash` est calculée avec la requête retenue, pour que l'analyse suivante ne soit pas relancée. Version du prompt : `v11-2026-10-30`. **Depuis v11**, `QUERY_PROPOSAL_PROMPT` demande la problématique (`problem`, rangée dans `SearchInsights.problem` et `metricsRaw.keptProblem`) et 8 à 12 mots-clés de départ courts pour Keyword Planner (`MAX_QUERY_CANDIDATES` = 12) ; `mentionedInPage` écarte un mot-clé dont aucun mot porteur de sens ne figure dans la page ; `CANDIDATES_VERSION` = 2 : des candidates d'une version précédente ne sont reprises ni à l'analyse ni d'un audit à l'autre (la requête déduite avec elles est redéduite). Sans volume, `buildQuerySet` note les 3 premiers mots-clés (`FALLBACK_QUERY_SET`), poids égal ; l'exclusion des 30 pts ne vaut plus que sans groupe. Interface : plus de saisie de requête visée (tiroir : problématique, requêtes notées, bouton « Ré-analyser la page » ; Sous-pages : colonne « Requêtes notées » en lecture seule ; Positionnement : « Ajouter aux requêtes notées » remplace « En faire la requête cible », pas de « Cible » quand la page a un groupe).

**Barème sur 100 et grilles à cases** (`scoring/editorial-checks.ts`) : `INTENT_CHECKS` (15), `OPENING_ANSWER_CHECKS` (réponse 4 · se suffit 3 · précise 3) ou `OPENING_PITCH_CHECKS` (ce qui est proposé et pour qui 6 · introduction précise 4, depuis v12) selon `answersQuestion(role)` (10), `SUBJECT_CHECKS[subjectGridOf(role)]` (20, depuis v13 : `inform` = notions 6 · questions 5 · explications 5 · exemples 4 ; `credibility` (rôle `brand`) = preuve concrète 7 · ce qui distingue 5 · `people` qui est derrière 4 · `track` repères de solidité 4 ; `skills` (accueil, offre, liste, réalisation) = preuve concrète 7 · ce qui distingue l'approche 5 · `how` ce qui est fait et comment 4 · `needs` besoins traités 4 ; la grille v12 `present` avec « conditions pratiques » est retirée : aucune case ne juge la conversion). Une case peut porter `quote` : cochée seulement si l'extrait est retrouvé par le code (`openingQuote` dans les 150 premiers mots avec `openingQuoteVerified`, `proofQuote` n'importe où dans le contenu avec `proofQuoteVerified`, 20 caractères au moins) ; `scoreChecks(checks, answers, quoteVerified)`. `checksPrompt(role)` insère la grille dans le message (`<grille>`) ; l'IA renvoie `checks.intent`, `checks.opening`, `checks.goal` (booléens, « true » ou « oui » tolérés par `toBool`), `checks.openingQuote` et `checks.proofQuote` ; `toEvaluation` ajoute `goalKey` (la famille). `familyGridMatches(goalKey, family)` : la grille `cover` d'avant v12 vaut pour `inform` ; une grille d'un ancien objectif de preuve (`convince`, `reassure`…) ne correspond plus, l'ancien palier converti est gardé jusqu'à la prochaine analyse. Une analyse faite sous l'ancien objectif `direct` (couverture mise à 0 par l'IA sans jugement) laisse le critère « sujet » hors note. Doublon supprimé en v12 : sur une page d'accueil ou d'offre, « ce qui est proposé et pour qui », « ce qui distingue » et « action visible » étaient demandés à la fois au début de page et à l'objectif « convaincre » (24 pts sur 75). `EditorialScoringEngine.criterionPoints` calcule `evaluation.points` (`CriterionPoints` : `earned`, `max`, `basis` measured / checklist / ai / legacy, cases cochées et non cochées) : `scoreChecks`, ancien palier converti sans grille, cannibalisation mesurée sur 20 divisée par deux (absente si seulement estimée), E-E-A-T calculé (5 + 3 + 2). Note = somme des points / somme des maximums retenus × 100 ; `coverage.total` vaut 100. `queryJudged(search)` : intention et zones chaudes retirées seulement pour une requête générique `INFERRED` (une requête de marque reste jugée). Présentateur : `pointsOf` (même conversion pour une analyse sans `points`), `checkItems` (cases cochées en vert, non cochées en bleu), `editorialCategories` depuis les points ; `synthesis-advice.ts` calcule ses moyennes sur les critères retenus pour chaque page. `lib/score-effect.ts` : `INTENT_MISMATCH` 15, `CANNIBALIZATION_RISK` 10, `MISSING_TLDR_SUMMARY` 10 ; le présentateur (`audit-presenter.ts`, priorités du tiroir) les passe sans effet sur la note pour une cannibalisation seulement estimée et pour une page non notée. `AuditService.rescoreAudit(auditId)` recalcule sans IA tous les piliers d'un audit puis le score du site.

**Qualité du contenu et lisibilité notées** (`scoring/content-quality.ts`) : l'IA renvoie `quality.informationGain.originalDataQuote`, `concreteCaseQuote` et `limitsQuote` (extraits copiés, vides si rien ; tolérés absents par le schéma Zod). `EditorialScoringEngine.calculate` calcule `evaluation.contentQuality` (`evaluateContentQuality` : extraits retrouvés mot pour mot avec `normalizeQuote`, 20 caractères au moins ; expérience 3 ou 5 pts, donnée 4, cas 4, limite 2) pour la famille `inform` seulement et `evaluation.readabilityPoints` (`readabilityPoints` sur `editorialSignals.readability`). Dénominateur : 90 ou 100 points, plus 15 si la qualité est mesurée, plus le maximum mesurable de lisibilité ; `coverage.total` vaut 120. Présentateur : blocs « Qualité du contenu » et « Lisibilité » passés dans le groupe noté (même indice d'accordéon, le routage des anomalies ne change pas), barres de score correspondantes. `lib/score-effect.ts` : `NO_FIRST_HAND_EXPERIENCE` 5, `GENERIC_CONTENT` 10, `DENSE_PARAGRAPHS` 2, `LONG_SENTENCES` 2, `NO_LISTS_OR_TABLES` 1. Depuis le 10/11/2026, `audit-presenter.ts` (`EDITORIAL_CRITERION_OF`) relie chaque anomalie éditoriale à son critère : si l'évaluation a des `points` sans ce critère (qualité d'une page qui présente, lisibilité peu fiable, cannibalisation estimée), la priorité passe « Sans effet sur le score » (`affectsScore: false`, pas de « jusqu’à N pts »).

**Grille du critère « sujet » selon le rôle** (prompt `v13-2026-11-10`, `SubjectGrid` dans `types.ts`) : `subjectGridOf(role)` (`page-family.ts`) donne `inform` (famille informer), `credibility` (rôle `brand`), `skills` (accueil, offre, liste, réalisation) ou `null` (non notée). `SUBJECT_GRID_LABEL`, `PRESENT_CRITERIA` et `presentCriterion(role)` (titres « Crédibilité » et « Savoir-faire », libellés des pistes et de l'anomalie `SEMANTIC_GAPS`), `subjectCriterionTitle(role)`. `gridMatches(goalKey, grid)` remplace `familyGridMatches` : `cover` vaut `inform`, une grille `present` (v12) ne correspond à aucune grille v13 (ancienne note gardée jusqu'à la prochaine analyse). Le moteur pose `EditorialEvaluation.subjectGrid` (grille du rôle actuel) ; `setPageRole` relance l'analyse quand `checks.goalKey` ne correspond plus à `subjectGrid` ; le présentateur marque `familyStale` sur le même test. `llm-gateway` : ligne « Grille de la page » dans le message, barème `semanticDepth` de la famille `present` selon la grille, prix et modalités en pistes hors note, `goalKey` = grille. Clé de cache de l'analyse : `|grid:…` au lieu de `|family:…`. **Rôle de départ** (`analyzeEditorial`) : choix manuel, sinon `editorial.role` de l'analyse précédente, sinon rôle détecté. Si l'IA corrige le rôle vers une autre grille, second appel `evaluateEditorial` avec le rôle corrigé (une fois ; rôle et justification du premier appel gardés) ; si elle le confirme (`toRole` ne renvoie rien quand le rôle reçu est inchangé), le rôle de départ et la justification précédente sont gardés. Script de variabilité : `SUBJECT_CHECKS[subjectGridOf(role)]`.

**Famille de la page** (`PageFamily` : `inform`, `present`, `unscored`, `scoring/page-family.ts`, depuis le prompt `v12-2026-11-09` ; remplace les six objectifs `PageGoal` et le fichier `page-goal.ts`). `familyOf(role)` : article et contenu informatif → `inform` ; contact et utilitaire → `unscored` ; accueil, offre, liste, marque, réalisation → `present`. `FAMILY_LABEL` (Informer, Présenter, Non notée), `FAMILY_HINT`, `PRESENT_CRITERION` (titre « Présentation et preuves », pistes, anomalie « Pistes pour mieux présenter l’offre »), `subjectCriterionTitle(family)`. Plus de choix manuel : la route `…/goal`, `AuditService.setPageGoal` et `metricsRaw.goalOverride` (ignoré s'il reste en base) sont supprimés ; corriger le rôle suffit. `AuditService.setPageRole` recalcule sans IA (`rescoreEditorial`, qui renvoie l'évaluation), puis relance l'analyse de la page (`reanalyzePage`) si la grille « sujet » enregistrée ne correspond plus à la nouvelle famille (`familyGridMatches`) et qu'un fournisseur IA est configuré. `analyzeEditorial` transmet la famille à l'IA (`EditorialAnalysisInput.family`, ligne « Famille de la page » du message, barèmes `semanticDepth` `present` et `inform` dans `SYSTEM_PROMPT`, pistes de conversion autorisées en `present` mais hors note) et la met dans la clé de cache (`|family:…`) ; l'évaluation enregistre `EditorialEvaluation.family`. `llm-gateway.toEvaluation` vide `semanticDepth` et `contentGaps` pour `unscored`, et `contentGaps` hors `inform` (4 pistes au plus en `present`, 10 en `inform`). `EditorialScoringEngine.calculate` : `score` vaut `null` pour `unscored` (`coverage.measured` = 0, points gardés pour l'affichage, aucune anomalie de critère : intention, zones chaudes, début de page, sujet) ; `computePageScore(tech, undefined, …)` donne alors la note technique seule et `computeProjectScore` exclut la page de la moyenne éditoriale. `present` émet `SEMANTIC_GAPS` en `INFO` ; `CONTENT_GAPS` seulement pour `inform`. Présentateur : `roleOf` renvoie `family`, `familyLabel`, `familyStale` (grille « sujet » remplie sous une autre famille ou un ancien objectif) ; `PillarPage.editorialScore` et `InspectionData.editorial.score` valent `null` pour une page non notée (« Non notée » dans le tiroir, le tableau éditorial, les PDF ; exclue de `editorialMean`, de la répartition du tableau de bord et du conseil de synthèse) ; `editorial-sections.ts` : `outOfScore` pour les critères d'une page non notée, la cannibalisation estimée et le critère « sujet » non jugé ; `editorialCategories(editorial, role, family)` (aucune barre pour une page non notée). Interface : composant `page-role-family.tsx` (rôle modifiable avec son origine, famille en lecture seule), variante compacte dans la colonne « Rôle et famille » de Sous-pages, variante détaillée dans le tiroir (`editorial-search-panel.tsx`) ; colonne de tableau `m:family` (« Famille »). Recalcul du 09/11/2026 (`rescoreAudit`, big-happy.fr) : note éditoriale du site 70 → 65 ; `/` 93 → 80, `/a-propos/` 68 → 66, `/data-ia/` 44 → 46, `/creation/` 76 → 71, `/diffusion/` 69 → 63, `/contact/` 71 → non notée (grilles en ancien palier converti jusqu'à la prochaine analyse).

### Citabilité sans objet (contact, utilitaire)
`GeoScoringEngine` résout le rôle (manuel, puis celui de l'IA rangé dans `GeoEvaluation.role`, puis la détection) ; pour `contact` et `utility`, `aiCitability.applicable = false` : 40 pts hors dénominateur (`geoMeasuredPoints`), pas d'anomalie `LOW_AI_CITABILITY`. `rescoreEditorial` recalcule aussi le GEO, pour qu'une correction de rôle s'applique tout de suite. `replaceGeoIssues` conserve l'anomalie `AI_BOTS_POSSIBLY_FIREWALLED` (issue du test du domaine au crawl), qui disparaissait de l'accueil après l'analyse IA.

### Validation
Les mesures de variabilité, l'état de la calibration et l'essai de l'API SERP sont regroupés dans la section 5 de `docs/tableau-metriques.md`.

### Backlinks (onglet Backlinks, hors score)
- Port `BacklinkIndexPort` (`src/core/ports/backlink-index.ts`), adaptateur `CommonCrawlBacklinkIndex` (`src/adapters/secondary/backlinks/common-crawl-index.ts`) : DuckDB (`@duckdb/node-api` 1.5.6-r.1, module natif déclaré dans `serverExternalPackages`, chargé à la demande). Fichiers : `<BACKLINKS_DATA_DIR>/current.json` (version), `<version>/vertices.parquet` (`id`, `rev_domain`, `num_hosts`), `<version>/edges/part=N/` (liens `from_id`, `to_id`, partition `to_id % 256`). Domaine en notation inversée (`fr.edenis`).
- Préparation : `scripts/backlinks/build-index.ts` (`npm run backlinks:build [version] [--keep]`) ; dernière version lue sur `index.commoncrawl.org/graphinfo.json` ; téléchargement avec reprise (en-tête Range), le serveur coupant parfois la connexion.
- Vérification : `verifyReferringDomains` (`backlink-verifier.ts`), 20 domaines, 4 en parallèle, `SiteCrawler.fetchSinglePage` sur l'accueil puis 3 pages au plus (partenaires, références, crédits, mentions…).
- `AuditService.runCrawlPipeline` lance `collectBacklinks` au début du crawl et enregistre le `BacklinkReport` dans `Audit.backlinksRaw` en fin de phase 1. `launchAudit` lit le relevé de l'audit précédent avant sa suppression ; `compareReferringDomains` (`src/core/domain/backlinks.ts`) donne les domaines gagnés et perdus. Jamais d'échec du crawl : `UNAVAILABLE` (base absente) ou `ERROR`.
- Affichage : `components/audit/backlinks-view.tsx`, route `/projets/[projectId]/backlinks`, entrée « Backlinks » de la barre latérale ; encadré « Popularité du site » (hors score) dans `synthesis-view.tsx`. Libellés et chiffres partagés : `lib/backlink-labels.ts` (`releaseLabel`, `backlinkSummary`).
- Correctif lié : `page-extractor.ts` lit le texte d'un lien après `trim()` ; un lien autour d'une image (texte réduit aux espaces) prend enfin l'alt de l'image.
- **Liens précis** (09/11/2026, à la demande, hors audit ; rien n'est noté ni jugé par l'IA) :
  - Types (`types.ts`) : `DiscoveredBacklink` (page source, ancre et `BacklinkAnchorType`, `nofollow`, `sponsored`, `ugc`, `BacklinkLocation`, `externalLinksInContent`, `context`, `inCommonCrawl`, `foundBy`), `UnlinkedMention`, `BacklinkDiscovery` (`status` RUNNING, DONE, PARTIAL, ERROR ; `updatedAt` ; `searches` prévues, faites, pages demandées ; `pages` trouvées, lues, injoignables ; `links` ; `mentions`). Rangé dans **`BacklinkReport.discovery`**, donc dans `Audit.backlinksRaw` du dernier audit : pas de changement de schéma Prisma, mais le résultat ne passe pas d'un audit à l'autre (un nouvel audit repart sans).
  - Domaine `src/core/domain/backlink-discovery.ts` (pur, testé) : `planBacklinkSearches(domaine)` : le **nom de marque** (`brandVariants` : « big happy » et « bighappy », une seule requête si la marque n'a qu'un mot) entre guillemets, hors du site (`"big happy" -site:big-happy.fr`), défilé en lots de `SEARCH_CHUNK_PAGES` = 3 pages jusqu'à `MAX_PAGES_PER_QUERY` = 9, lots **entrelacés** entre les requêtes (un budget court lit d'abord le début de chacune). Un nom de domaine entre guillemets ou une recherche `site:domaine-référent` ont été essayés et abandonnés (essai du 09/11/2026 : 1 lien pour 17 recherches par domaine) ; `trimToBudget` ; `candidatesFromResults` (écarte le site audité et ses sous-domaines, `SKIPPED_HOSTS` : LinkedIn, Facebook, Instagram, X, YouTube, TikTok, Pinterest, Reddit, Google, Wikipédia ; doublons par `pageKeyOf`, 5 par domaine, 150 au total) ; `mentionsBrand` (nom de domaine ou marque en mots entiers, sans accent) ; `classifyLinkLocation` (balise parente la plus proche qui dit quelque chose : commentaires, pied de page, menu, colonne latérale, en-tête, `article` ou `main` ; classes lues seulement si sans ambiguïté : `widget` seul n'est plus une colonne latérale (blocs `elementor-widget-container`), `nav` seul n'est plus un menu (`nav-tabs`) ; sans repère, contenu si dans un paragraphe, une liste ou un titre) ; `classifyAnchor` ; `windowAround`.
  - Adaptateur `src/adapters/secondary/backlinks/backlink-page-reader.ts` : `readBacklinkPage` (adresses publiques http et https seulement, jamais localhost ni IP ; 12 s ; 3 Mo de texte) et `parseBacklinkPage` (Cheerio, testable sur du HTML écrit à la main : liens vers le domaine audité, `rel`, emplacement, ancre, liens externes du contenu principal hors menu, pied de page et colonne latérale, paragraphe autour du lien avec le repère `[[LIEN : ancre]]`, mention du nom du site sans lien ; une page du site audité n'est jamais une source).
  - Service `src/core/services/backlink-discovery-service.ts` : `BacklinkDiscoveryService.start(projet, { budget })` exige un relevé de backlinks `DONE` du dernier audit ; **même verrou que la mesure Google** (`jobRegistry.serpAlive()`, `startSerp`, `beatSerp`, `endSerp`) car les deux utilisent le même profil Chrome ; même budget (`resolveSerpBudget`, `remainingSearches`) et même compteur du jour (`AuditService.countSerpSearches`, devenue publique). Déroulé : un lot de 3 pages par appel (`provider.search(requête, { pages: 3, start })`, `start` jusqu'à 9 dans les deux fournisseurs) ; pause de 4 à 8 s entre deux appels réels ; une requête dont un lot rend moins de 10 résultats ou une page vide est **épuisée** : ses lots plus profonds sont sautés ; `SerpBlockedError` = arrêt, statut PARTIAL ; « Aucun résultat extrait » = fin des résultats, pas un échec (compte 1 page) ; 3 échecs de suite = arrêt, candidates, lecture à 4 en parallèle, raisons des pages injoignables comptées par motif (`pages.unreachableReasons`), mentions sans lien limitées à 60 ; enregistrement tous les 5 pages (`save` relit et réécrit seulement la clé `discovery`). Un travail RUNNING sans avancée depuis `SERP_STALE_MS` (15 min) est repris comme interrompu (`discoveryInterrupted` côté écran).
  - `scripts/serp/google-serp.mjs` : `waitForResults` rend `'empty'` quand Google annonce qu'il n'y a plus de résultat (« Aucun document ne correspond… »), la boucle s'arrête et garde ce qui a été lu, au lieu d'attendre 180 s puis de signaler un captcha.
  - Route `POST /api/projects/[projectId]/backlinks/discover` (corps `{ budget }`, 202 ou 409 avec la raison) ; le résultat se lit avec `GET /api/projects/[id]/audit` (sondage de 3 s déjà en place).
  - Écran : `components/audit/backlinks-discovery-panel.tsx` (bouton, avancement, tuiles, tableau, mentions), libellés dans `lib/backlink-labels.ts` (`LOCATION_LABEL`, `ANCHOR_TYPE_LABEL`, `discoverySummary`, `discoveryInterrupted`).
  - Tests : `tests/backlink-discovery.test.ts` (lancé par `npm run test:scoring`). Vérifié de bout en bout avec un faux fournisseur Google sur big-happy.fr : 3 recherches, 7 pages lues, 6 liens relevés (emplacement et ancre corrects) ; le résultat factice a ensuite été retiré de la base. **Aucune vraie recherche Google n'a encore été lancée.**

### Zones ciblées (`src/core/domain/zones.ts`)
- `GeoZone` (`GeoZoneKind` : commune, département, région, `pays` (code ISO à deux lettres), `lieu` (texte saisi, `cleanPlaceName` : 2 à 60 caractères, lettres, chiffres, espaces, apostrophes, tirets, points) ; `city` = ville de référence : la commune ou le chef-lieu, avec coordonnées, utilisée pour la couverture des adresses, **absente pour un pays ou un autre lieu**). `GEO_ZONE_KINDS` : types acceptés par les routes. `MAX_PROJECT_ZONES` = 3. `measurementZones` : zone propre de la page, sinon celles du projet, sinon `[undefined]`. `queryForZone` : nom de la zone ajouté à la fin de la recherche (sauf s'il y figure déjà). `zoneTag.city` = nom de la zone. `uuleFor` et `serperLocation` supprimés : plus de lieu simulé.
- `GeoApi` (`src/adapters/secondary/geo/geo-api.ts`) : `search` (code postal, numéro ou nom de département, nom de région, de ville ou de pays ; nom identique à la saisie en tête ; la saisie elle-même en dernier comme autre lieu, sauf saisie numérique ou nom déjà proposé). Pays : `countryList` (codes AA à ZZ nommés par `Intl.DisplayNames('fr')`, sans EU, EZ, UN, QO, ZZ, XA, XB, un code par nom), `searchCountries` (nom ou mot du nom qui commence par la saisie, 3 au plus). `placeNamesFor` et `zoneNamesFor` (audit-service) ignorent les pays : ils restent dans les recherches proposées. `addressInZone` : une zone pays couvre une adresse seulement si c'est « FR » et `resolve` (validation côté serveur, chef-lieu par `chefLieu`), un nouvel essai en cas d'erreur (l'API limite les appels rapprochés). Routes : `GET /api/geo/search?q=`, `PUT /api/projects/[id]/zones` (`{ zones: [{ kind, code }] }`), `PUT /api/projects/[id]/page-zone` (`{ url, zone | null }`).
- Stockage : `Project.zonesRaw` et `Project.pageZonesRaw` (clé `SiteCrawler.urlKey`). Un changement oublie `keptCandidates` (et `keptQuery` déduite) des pages stratégiques du dernier audit.
- IA : `QueryProposalInput.zones` (balise `<lieux_a_ne_pas_ecrire>`) ; consigne : aucune recherche avec un lieu. `stripPlaces` (autocomplete-relevance) retire zones, départements, régions, ville de la page, codes postaux et « (NN) » : dans `sanitizeCandidates`, la requête cible déduite (`analyzeEditorial`, hors requête saisie) et `serpQueriesOf` (`placeNamesFor`). Mesure : `SerpJob` requête × zone (indice `q * zones + z`), texte envoyé `queryForZone(query, zone)` stocké dans `SerpAnalysis.sentQuery` (`query` reste la requête sans lieu, pour les rapprochements), sans `location`, `SerpAnalysis.zone`, `SerpHistoryEntry.zone`, concurrents lus pour la requête visée dans la zone principale, `switchToMeasuredQuery` sur la zone principale.
- Interface : `local-zones-section.tsx` (un bloc depuis le 08/11/2026 : choix des zones, carte, rayon, puis `ZoneVisibilityDetails` de `local-visibility-section.tsx` ; remplace `zones-panel.tsx`, supprimé), `zone-picker.tsx`, `PageZoneControl` et positions par zone dans `positioning-view.tsx` ; `SubpageItem.zone` et `zoneSuggestion` (ville repérée par l'IA hors des zones).
- **Carte des zones** (hors barème) : `src/core/domain/geo-radius.ts` (`distanceKm` haversine, `communesInRadius` : préfiltre par latitude et longitude puis distance exacte, les plus peuplées d'abord, `MAX_LISTED_COMMUNES` = 8 et le total ; `clampRadius` 1 à 100 km, 20 par défaut ; `simplifyRing` / `simplifyGeometry` : coordonnées arrondies à 4 décimales, points plus proches que la tolérance retirés, anneaux fermés). `zoneBand(measures)` (`local-visibility.ts`) : top3, top10, top30, absent, unmeasured. Adaptateur `src/adapters/secondary/geo/geo-shapes.ts` : `contour(kind, code)` par le WFS de l'IGN Géoplateforme (`ADMINEXPRESS-COG-CARTO.LATEST:commune|departement|region`, filtre `code_insee`, tolérance 0,0005 / 0,003 / 0,01 degré : région d'Occitanie 795 Ko → 32 Ko), `communes()` (toutes les communes de l'API Géo, centre et population, liste compacte relue tous les 30 jours, gardée en mémoire), `locate(codePostal, ville)` (centre de la commune) ; cache disque `.data/geo/` (ignoré par git). Routes `GET /api/geo/contour?kind=&code=`, `GET /api/geo/nearby?lat=&lon=&radius=`, `GET /api/geo/locate?postalCode=&city=`. Présentateur : `LocalVisibility.headquarters` (adresse la plus fréquente, `siteAddressOf`). Interface : `zones-map.tsx` (Leaflet 1.9.4 importé côté navigateur, tuiles OpenStreetMap, classes CSS `zone-*`, `map-*` dans `globals.css`, couleurs `--viz-pos-*`, conteneur `isolate` pour garder les couches de Leaflet sous les menus). Rayon gardé dans `localStorage` (`auditly:rayon:<projet>`).

### Relevé de la requête visée (`serpForQuery`)
Le relevé Google utilisé (score, tiroir, synthèse, rapport) est celui de la requête visée actuelle : le relevé principal s'il porte sur elle, sinon une mesure de la même requête parmi `serpQueries` (candidate devenue cible), mêmes mots à un près dans les deux sens. Requête changée sans nouvelle mesure : aucun relevé (pas de position, de concurrents ni de questions de l'ancienne requête) ; dans Positionnement, l'ancien relevé reste visible avec la mention « Mesure de l'ancienne requête » (`SubpageItem.serpOutdatedQuery`).

### Format de réponse de l'IA
`OpenAiCompatibleProvider` essaie `json_schema`, puis `json_object`, puis `prompt` (aucun format imposé, schéma décrit dans le prompt : OmniRoute transmet mal `response_format` à gpt-oss). `LLM_RESPONSE_FORMAT` fixe le mode de départ.

### Visibilité locale (`src/core/domain/local-visibility.ts`)
- `parseAddress` (code postal et ville d'un texte), `zoneCoverage` (raisons `zone`, `title`, `h1`, `adresse`), `detectEstablishments` (code postal différent du code postal dominant), `zoneMeasures` (mesures DONE de la zone, visibles, meilleure position, pack). Pack local : `parseSerpFeatures` lit `localPackEntries` (fiches `[data-cid]`, nom, lien « Site Web » décodé ; Serper : `places`), `localPackRank` (`serp-analysis.ts`) place le site par domaine ou par nom de marque.
- Présentation : `AuditPresenter.toLocalVisibility` (`ProjectAuditData.localVisibility`) ; adresse lue dans `geo.napConsistency.detectedAddress` (pas de nouveau crawl) ; seule l'adresse d'un établissement compte pour la couverture. `withZone` propose la ville d'un établissement avec son code postal (`zoneSuggestionPostalCode`).
- Affichage : `local-visibility-section.tsx` (Positionnement), `LocalCard` (Synthèse), section « Visibilité par zone » du rapport PDF.

### Résultats Google interprétés (`components/audit/serp-insights.tsx`)
Affichés sous la ligne de la page dans Positionnement (« Voir les résultats ») et dans l'onglet « Positionnement » du tiroir d'inspection (élargi à `max-w-4xl`). `interpretSerp` (`src/core/domain/serp-insights.ts`) écrit la lecture à partir des mesures : visibilité d'ensemble, autre page du site à la place, qui occupe le Top 10 (`classifyResult` : votre site, concurrents directs, annuaires et plateformes, sites publics ; « dominée par des plateformes » à partir de 5), longueur face aux concurrents, sections manquantes, puis une priorité unique. Avis de l'IA à la demande (`POST /api/audits/[id]/pages/[pageId]/serp-opinion`, `llmGateway.serpOpinion`) à partir des seuls faits mesurés (`serpFacts`), enregistré dans `aiEvaluationRaw.serpOpinion` avec les dates des relevés : signalé périmé après une nouvelle mesure. Graphiques SVG sans bibliothèque (`serp-charts.tsx`) : échelle des positions 1 → 30 (toutes les mesures), Top 10 par type de site, page face aux concurrents (mots, sous-titres, sous-titres en questions ; `SubpageItem.headingStats`). Détail replié : résultats, concurrents lus, questions.

### Réécriture en Markdown et capture PageSpeed (09/11/2026)
- `rewriteOutline(rewrite, headings)` (`page-rewrite.ts`, pur, testé) : plan complet après réécriture. H1 proposé, puis chaque titre de la page (`contentHeadings`, bandeau de cookies écarté, H1 sautés) : un H2 dont le texte normalisé correspond à `sections[].current` devient la ligne réécrite (`current` gardé s'il change, `intro`, `why`), les autres gardent leur niveau (`kept`) ; H2 réécrits introuvables (audit sans titres enregistrés) ajoutés dans l'ordre de la proposition ; `newSections` en fin (`added`). `rewriteMarkdown` : `Title : …`, `Méta description : …`, puis `#` × niveau et ouvertures, blocs séparés par une ligne vide. Titres de la page exposés à l'interface : `PageDetails.headings` (lu dans `metricsRaw.content.headings`).
- `page-rewrite-panel.tsx` : grille `sm:grid-cols-[176px_1fr]` (capture `PageScreenshot compact` à gauche ; avertissements, snippet « Dans Google », requêtes reprises à droite), puis section « Page réécrite » : `OutlineRow` en grille `[2.5rem_1fr_auto]` (pastille `H1`…`H6` ; retrait `(niveau − 2) × 16 px` ; tailles par niveau ; pastille bleue pleine = réécrit, pointillée = à ajouter, grise + `py-2` = gardé ; ouverture `max-w-[62ch]` avec filet gauche ; lignes séparées par `divide-y`) ; survol partagé `Hover` (`{ keyword }` : pastille, mots allumés partout ; `{ block }` : requêtes reprises par le bloc) ; `[À COMPLÉTER …]` encadré bleu ; case Comparer (actuel barré, `why`) ; Copier en Markdown, copie d'un bloc au survol.
- Capture : `PageSpeedInsights.analyze(url)` renvoie `{ vitals, screenshots }` (`measure` garde son contrat) ; captures lues dans `lighthouseResult.audits['final-screenshot'].details` (premier écran, JPEG) et `lighthouseResult.fullPageScreenshot.screenshot` (page entière, WebP, 412 px de large ; 412 × 11 176 px et 190 Ko pour big-happy.fr/a-propos/). `ScreenshotStore` (`src/adapters/secondary/speed/screenshot-store.ts`) : fichiers `.data/pagespeed/<sha1 de l'URL>.final|full.<ext>` et `.json` (url, date, type, dimensions), hors base ; la dernière capture d'une adresse remplace la précédente. `measureCoreWebVitals` enregistre les captures des pages mesurées pendant l'audit. Route `app/api/audits/[auditId]/pages/[pageId]/screenshot` : GET `{ configured, meta }`, GET `?image=final|full` (image, `Cache-Control: private, max-age=300`), POST (nouvelle capture, 19 s mesurées ; seules les captures sont gardées, Core Web Vitals et note inchangés). `page-screenshot.tsx` : cadre de téléphone (`max-w-[340px]`, défilement `max-h-[640px]`), Page entière / Premier écran, Ouvrir, Reprendre, bouton Capturer si absente.

### Tiroir d'inspection simplifié (`page-inspection-sheet.tsx`)
- **En-tête compact et Contenu en trois vues** (09/11/2026) : en-tête sur deux lignes et les onglets (titre tronqué ; chemin, état HTTP, indexable, « i / n » ; icônes copier le lien, PDF, ↑ ↓, fermer ; onglets `overflow-x-auto` sans retour à la ligne), 142 px mesurés au lieu d'environ 245 (titre `line-clamp-2`, `px-5 pt-4`, onglets `text-sm`) ; pied retiré (copie du lien dans l'en-tête, touches dans les infobulles) ; contenu `p-5 space-y-5`, barre de vues opaque (`bg-card`, `sticky -top-5` : décalée du padding du conteneur). Onglet Contenu : état `contentView` (`EditorialPart` : `summary` | `keywords` | `rewrite`) gardé d'une page à l'autre, barre de vues `sticky top-0` ; `EditorialSearchPanel` prend `part` (résumé et ré-analyse, mots-clés, réécriture) ; `goToSection`, `?section=` et les renvois de « L'essentiel » vers Contenu repassent en vue `summary`. Badges : note, nombre de requêtes notées, réécriture « prête » ou « à refaire ».
- **Fiche côte à côte** (08/11/2026 ; corrections du 09/11/2026 ci-dessous) : `<aside aria-label="Fiche de la page">` fixe à droite (`lg:inset-y-3 lg:right-3`, largeur `--panel-width`), sans voile ni `aria-modal` sur écran large ; voile et plein écran en dessous de `lg`. `InspectionProvider` porte la largeur (`width`, `setWidth`, `auditly:fiche-largeur`, 560 px par défaut, `MIN_PANEL_WIDTH` 420, 70 % de l'écran au plus), la liste de l'écran (`navigation`, déclarée par `useInspectionNavigation(ids)` dans Sous-pages, Positionnement et SEO éditorial), `step(±1)` et `activeId` (page ouverte, sinon ligne choisie au clavier). Raccourcis globaux (hors saisie et hors fenêtre modale) : J / K, Entrée (ligne active, focus sur la page), Échap. `AppShell` donne au contenu une marge droite `--inspection-pad` (largeur + 12 px) quand la fiche est ouverte et replie le menu (rétabli à la fermeture s'il avait été replié pour la fiche). `CustomizableTable` : `rowActive` (classe `ct-row-active`), `onRowClick` (ignoré sur bouton, lien, champ, case, poignée, ou texte sélectionné), `data-row-id` (défilement jusqu'à la ligne). En-tête : chemin, « i / n », ↑ ↓, Exporter en PDF, fermer ; pied : copier `window.location.href` (porte `?inspect=…&tab=…`).
  - Corrections du 09/11/2026 : changement d'écran (`usePathname`) : la fiche se ferme, sauf si la nouvelle adresse porte `inspect` (onglet et section relus) ; la marge du contenu et le repli du menu dépendent de `panelPresent` (posé par la fiche quand elle est réellement affichée), donc un écran sans fiche (Tableau de bord) retrouve sa largeur et le menu déplié. Plus d'animation de la marge du contenu : le tableau se redessinait à chaque image (ombres et colonnes en retard pendant l'ouverture et l'étirement). `CustomizableTable` relit l'état du défilement à chaque rendu et quand sa largeur change (ombre de la colonne épinglée juste) et montre un fondu au bord droit quand des colonnes sont cachées à droite. Notes de « L'essentiel » en `repeat(auto-fit, minmax(150px, 1fr))` (pleine largeur de la fiche), état de la note (« À consolider ») sans retour à la ligne.
- Onglets : « L'essentiel » (ouvert par défaut, `inspection-essentials.tsx`), Contenu, Technique, Moteurs IA (masqué, GEO mis de côté), Positionnement ; notes sur 100 dans les onglets. Largeur réglable par une poignée à gauche (souris ou flèches du clavier), mémorisée (`auditly:inspection-width`, 820 px par défaut, 480 au minimum).
- « L'essentiel » : verdict selon le pilier le plus faible, trois notes cliquables, position Google, trois actions (alertes et points en jeu d'abord) avec un effort indicatif (quelques minutes, réécriture, développeur).
- Chaque pilier : une ligne de note (`PillarHeader`) à la place du bloc « Scores » et de ses barres ; « À corriger » ; en Technique, seuls les blocs avec un point à revoir sont affichés, les autres sur une ligne « Ce qui va bien ».
- Titres en français courant (`audit-presenter.ts`, `editorial-sections.ts`) : « Accès de Google à la page », « Titre principal et sous-titres », « Titre et description dans Google », « Vitesse d'affichage », « Liens internes vers la page », « Accès des moteurs IA », « Passages que l'IA peut citer », « Données structurées et coordonnées », « Réponse à la recherche visée », « Concurrence entre vos pages », « Mots de la recherche aux bons endroits ». En-tête : « Page accessible » ou « En erreur », « Visible dans Google » ou « Exclue de Google ».
- Positionnement : tableau à colonnes fixes sans défilement horizontal (colonne « Devant vous » retirée, reprise dans les résultats dépliés) ; graphique « page face aux concurrents » retiré.

### Ré-analyse après ajout d'une page stratégique ou changement de rôle
- `selectPillarsAndAnalyze` efface les anomalies de contenu de tout l'audit avant l'analyse : une page inchangée (même empreinte, analyse IA enregistrée) n'appelle pas l'IA mais passe par `rescoreEditorial`, qui recalcule score et anomalies. Elles disparaissaient auparavant.
- Le rôle choisi à la main entre dans l'empreinte `analyzedHash` : un changement de rôle relance l'IA à la prochaine analyse.
- Contact et utilitaire : les candidates ne sont pas reprises, et seule une requête de marque est gardée. `setPageRole` oublie requête déduite et candidates quand la page passe d'un rôle à recherches génériques à contact ou utilitaire, ou l'inverse.
- Audit déjà terminé une fois (`completedAt`) : une ré-analyse ne verrouille plus l'interface (`isLocked`), les résultats restent affichés ; `audit-provider` continue de suivre l'avancement (`running`) et l'en-tête affiche « Analyse IA en cours (N %) ».

### Rôle « Contenu informatif » et suggestions Google
- `PageRole` `informational` (« Contenu informatif (guide, FAQ) ») distinct d'`article` (« Article (daté, signé) ») : repéré par le balisage FAQPage, HowTo ou QAPage, ou l'adresse (guide, faq, questions, glossaire, comment-, qu-est-ce, definition, conseils, ressources, aide…), sauf contenu daté déclaré comme article. E-E-A-T hors score (bloc « Auteur, date et sources (hors score) », statuts en bleu) ; réponse directe et expérience vécue attendues comme pour un article. L'IA peut le corriger (code `informational` dans le prompt).
- `GoogleAutocomplete.fetchSuggestionsChecked` dit si Google a répondu ; `suggestionSeeds` (variantes sans les lieux, 3 puis 2 mots) ; `fetchSuggestionsFor` renvoie `status` (`FOUND`, `NONE`, `UNAVAILABLE`, `NOT_REQUESTED`) et la graine, rangés dans `SearchInsights.autocomplete`. Présentation : suggestions dès 1, intention dès 3 et graine proche de la requête, raison affichée sinon.

### Budget de recherches Google (`src/core/domain/serp-budget.ts`)
- `resolveSerpBudget` (par lancement 5 à 60, 20 par défaut ; par jour 10 à 300, 60 par défaut), `remainingSearches`, `prioritizeSearches` (requête visée de chaque page d'abord). Réglages dans `settings-provider.tsx` (`serpPerRun`, `serpPerDay`), envoyés avec `POST /api/audits/[id]/serp` (`budget`, `resume`).
- `SerpProviderPort.search` renvoie `requests` : pages de résultats réellement demandées (0 depuis le cache). `AuditService.runSerpJob` compte chaque requête dans `SerpUsage` (table `serp_usage`, un enregistrement par jour, tous projets) ; `GET /api/serp-usage` renvoie l'usage du jour.
- Statut `PENDING` de `SerpAnalysis` : budget atteint ou captcha ; `startSerpAnalysis(…, { resume: true })` ne mesure que ces recherches et garde les relevés faits.

### Export PDF et accessibilité
- **Rapport d'audit** (`components/audit/report-print-sheet.tsx`) : bouton « Exporter en PDF » des onglets, fenêtre `PdfExportModal` (`audit-header.tsx`) avec deux versions, « Rapport client » (couverture avec jauges, résumé, 5 priorités, pages stratégiques avec recherche visée et position, visibilité Google sur toutes les recherches mesurées, popularité) et « Rapport complet » (en plus : étapes de correction, 8 priorités, toutes les anomalies par gravité, glossaire). Impression du navigateur (« Enregistrer au format PDF »), titre du document = nom du fichier proposé. Texte réel et titres structurés (lisible par un lecteur d'écran), couleurs d'impression fixes contrastées sur blanc, note toujours écrite en plus de sa couleur. La fenêtre précédente simulait un téléchargement sans produire de fichier.
- **Fiche d'une page** (`page-print-sheet.tsx`, bouton « Exporter en PDF » du tiroir) : même présentation que le rapport. En-tête (page stratégique ou non, rôle), jauges des trois notes avec les points mesurés, « À traiter en priorité » (points des trois piliers, alertes d'abord, points en jeu), recherche Google (recherche visée et confiance, autres recherches, intention comparée à Google, positions mesurées), textes prêts à copier (Title et méta de la réécriture à jour, absents sans réécriture), identité de la page, anomalies triées par gravité avec étapes, puis détail de chaque pilier : constat, « À faire », constats avec statut écrit et source (Mesuré, Google, Estimation IA), 25 éléments listés au plus, balisage Schema.org à intégrer. Montée seulement le temps de l'impression, pour ne jamais s'imprimer avec le rapport d'audit. Éléments communs (couleurs, jauges, titres) : `print-kit.tsx`. Feuilles d'impression repérées par la classe `.print-sheet` (`globals.css`).
- **Mise en forme des exports** (refonte du 09/11/2026, mêmes données) : `print-kit.tsx` fournit deux jeux de couleurs par état, `good`/`mid`/`bad`/`info` pour les formes (traits, barres, jauges ; accent jaune `#eab308`, aussi `INK.brand`) et `*Text` plus sombres pour écrire dessus (`#854d0e` sur le jaune : le jaune seul ne passe pas sur blanc), `*Tint` pour les fonds de pastille ; `Chip` (pastille : un mot sur fond teinté, jamais la couleur seule), `Callout` (« À faire » : filet jaune), `ScoreBar` (note, barre et verdict écrit), `Gauge` (anneau plus épais, « sur 100 », pastille de verdict), `SectionTitle` (pastille numérotée jaune), `count(n, singulier, pluriel)` (0 et 1 au singulier). Rapport : couverture avec la note globale en grand, trois pastilles de lecture (80 et plus, 60 à 79, moins de 60), cartes de chiffres, priorités numérotées avec gravité, impact et pages en pastilles, tableaux à en-tête en petites capitales et lignes zébrées, liens de popularité en tableau (page source, ancre, suivi ou non). `globals.css` (`@media print`) : numéro de page « n / N » en pied (Chrome 131 et plus), jamais un titre seul en bas de page, en-tête de tableau répété sur chaque page, interligne 1,5. Vérifié par un PDF réel généré avec Chrome (rapport client, rapport complet, fiche de page).
- **Annonces d'avancement** (`components/a11y/progress-announcer.tsx`, monté dans le layout du projet) : zone `role="status"` invisible qui annonce l'exploration (paliers de 10 %), l'analyse IA (pages stratégiques terminées, `ProjectAuditData.analysis`), la mesure Google (recherches terminées) et la fin de chaque tâche.
- **Positions** : pastilles avec le groupe écrit (« Top 3 », « Page 1 », « Pages 2-3 », « Hors Top ») en plus de la couleur ; « Hors Top » en bleu (constat, pas erreur), y compris dans le résumé du tiroir éditorial.

### Périmètre d'exploration (`src/core/domain/crawl-scope.ts`)
- `CrawlScope` (`full`, `main`, `sitemaps`) résolu par `resolveCrawlScope` (plafond borné de 10 à 2 000 ; pages principales : 2 clics et 50 pages ; sitemaps vides : tout le site). Envoyé par le formulaire de lancement (`crawl-scope-picker.tsx`) avec le plafond des Paramètres (`settings-provider.tsx`, `maxCrawlPages`) ; enregistré dans `Project.crawlScope` (repris par la relance) et `Audit.crawlScopeRaw` (affiché par `describeCrawlScope` dans la synthèse et le rapport). Sitemaps filtrés sur le domaine audité.
- `GET /api/site-structure?domain=` : `SiteCrawler.listSitemaps` lit l'index et compte les pages de chaque sitemap, sans explorer.
- `SiteCrawler.crawlSite` : `allowedUrls` (pages des sitemaps choisis, `loadSitemapUrls(…, readAll)`) et `excludePath` (`isArchivePath`) limitent la file ; un lien hors périmètre rend le graphe partiel (`scopeCut`). Sitemaps choisis : profondeur > 3 ramenée à -1 (non mesurable).
- Paramètres : les deux réglages sont enregistrés ensemble (modifier l'un n'efface plus l'autre) ; saisie validée en quittant le champ.

### Accueil et page Projets
- Même présentation que la synthèse : titre sobre, carte « Lancer un audit » (`audit-launcher.tsx`, libellé visible et aide), tuiles de chiffres (`stat-card.tsx` : projets suivis, pages à choisir, projets à renforcer : note globale sous 60/100, `IMPROVE_BELOW` dans `dashboard-view.tsx`), tableau compact commun `components/projects/projects-list-table.tsx` (liste courte sur l'accueil, colonnes Technique / Contenu / Moteurs IA et actions Relancer / Supprimer sur la page Projets, 10 projets par page).
- Note globale : celle de l'audit (`Project.overall`, pondérée 40 / 35 / 25, ou 53,3 / 46,7 GEO mis de côté, identique à la synthèse) au lieu d'une moyenne simple des trois notes ; `null` avant la fin de l'analyse. Seuils de couleur alignés sur `scoreTone` (80 / 60), y compris dans la barre latérale ; note toujours écrite avec son niveau (`score-value.tsx`).
- Statuts en français avec icône (`status-badge.tsx`) : Exploration (%), Pages à choisir, Analyse IA en cours, Terminé, Échec. Un audit en attente du choix des pages ne s'affiche plus « Completed ».

### Zones chaudes mesurées
`measureHotZones` (`src/core/domain/scoring/hot-zones.ts`), appliqué dans `EditorialScoringEngine.withMeasurements` : part des mots porteurs de la requête cible (`contentTokens`, pluriel en s/x confondu) présents dans le Title (6), les 100 premiers mots (5) et les H2/H3 réunis (4), au prorata. Remplace le score de l'IA (`hotZonesOptimization.source = 'MEASURED'`, détail dans `zones`) ; l'IA ne fournit plus que `actionableAdvice`. Synonymes non reconnus.

### Barre d'actions sur une sélection (`components/table/selection-bar.tsx`, Sous-pages depuis le 08/11/2026)

- `SelectionBar` : bulle sombre collée en bas (`sticky bottom-5`, jamais de défilement horizontal ni de retour à la ligne : `w-max`, `flex-nowrap`). Place au repos calculée (`useLayoutEffect`, relue par `ResizeObserver` quand le contenu change de largeur, fiche ouverte ou étirée) : centrée, décalée à gauche juste assez pour que le plus long nom déplié (`[data-expand-label]`) tienne ; figée pendant le survol, la bulle ne grandit que vers la droite (corrigé le 09/11/2026 : centrée, elle se recentrait à chaque survol et l'icône glissait sous la souris ; fiche ouverte, elle passait sur deux lignes). Effacer, nombre d'éléments (sa précision `info` dans une bulle au-dessus, au survol ou au focus), actions secondaires en icône dont le nom se déplie (`ExpandingLabel` : grille `0fr → 1fr` animée, coupée par `motion-reduce` ; `ACTION_CLASS` pour les menus sur mesure `render`), action principale jaune toujours nommée. `SelectionAction` : libellé, icône, principale, indisponible avec sa raison au survol, en cours. Confirmation `SelectionConfirm` dans la barre avant une action coûteuse ; message `SelectionToast` (« Annuler », « Ouvrir le plan ») effacé après 7 s (`useSelectionToast`). Mesuré le 08/11/2026 sur Positionnement : 524 px au repos (au lieu d'environ 1 150 px avec les libellés), 605 px au survol d'une icône.
- `components/table/use-row-selection.tsx` : `useRowSelection` (glisser pour peindre, Maj + clic pour une plage selon l'ordre affiché, clavier) et `SelectionCheckbox`. `components/audit/use-page-bulk-actions.tsx` : `usePageBulkActions` (Fiches PDF et Ajouter au plan, partagés par Sous-pages, Positionnement et SEO éditorial ; `sheets` à placer dans la page).
- Positionnement : **Changer la zone** (`PUT /api/projects/[id]/page-zone` pour chaque page, zone choisie ou null), Fiches PDF, Ajouter au plan, **Mesurer dans Google** (ancien bouton « Analyser la sélection ») ; `?pages=id,id` coche les pages à l'arrivée. SEO éditorial : colonne fixe `select`, **Ré-analyser** (`POST …/editorial { force: true }` page après page), **Proposer une réécriture** (`POST …/rewrite { force: false }` pour les pages sans réécriture à jour), **Mesurer dans Google** (vers Positionnement), **Retirer des piliers** (`savePillars` des piliers restants, qui relance la relecture IA de cohérence). Plan d'action : `PATCH /api/projects/[id]/plan { ids, status?, note?, remove? }` → `FixPlanService.updateMany` (tâches ajoutées à la fin de la colonne cible dans leur ordre), `useFixPlan().updateMany` (affiché tout de suite) ; « Annuler » d'un déplacement groupé remet chaque tâche dans sa colonne d'avant.
- Sous-pages (`subpages-view.tsx`) : sélection sans plafond (le plafond `maxAiPages` ne vaut que pour l'analyse IA) ; case de sélection en `role="checkbox"`, glisser pour peindre (valeur prise sur la première case, arrêt au relâchement n'importe où), Maj + clic pour une plage de la page affichée, clavier par `click` sans pointeur. **Fiches PDF** : une `PagePrintSheet` par page sélectionnée (identifiant `page-print-sheet-<page>`), `.print-sheet + .print-sheet { break-before: page }`, titre du document « Fiches SEO <domaine> (N pages) <date> ». **Ajouter au plan** : anomalies de `globalIssues[].impactedUrls` des pages choisies → `useFixPlan(projet, { lazy: true }).addWithIds` (pas de lecture du plan à l'ouverture, qui y ajouterait les anomalies prioritaires), annulation par `undoAdd` (tâches repassées en REMOVED). `POST /api/projects/[id]/plan` renvoie `{ added, ids }`.

### Plan d'action (`/projets/[id]/plan`, depuis le 08/11/2026)

- Table `fix_tasks` (modèle Prisma `FixTask`, ajoutée par `prisma db push`, sans perte) : une ligne par anomalie et par page, clé unique `(projectId, code, pageKey)` ; `pageKey` = `pageKeyOf(url)` (`src/core/domain/fix-plan.ts`, reprise par `SiteCrawler.urlKey`), vide pour une anomalie du site entier ; `title`, `pillar`, `severity`, `recommendation` du dernier relevé ; `status` TODO, DOING, DONE ou REMOVED (retirée du plan, gardée pour ne pas revenir seule) ; `position` dans la colonne ; `source` AUTO, MANUAL ou CUSTOM (tâche libre, voir plus bas) ; `note` (500 caractères) ; `doneAt`.
- Domaine `fix-plan.ts` : `pageKeyOf`, `FIX_STATUSES`, `FIX_STATUS_LABEL`, `verificationOf` (tâche × audit de référence : `still-detected` si terminée **avant** la fin d'un audit qui relève encore l'anomalie, `not-detected` si ouverte, créée avant l'audit et plus relevée, `page-missing` si la page n'a pas été explorée, rien si l'audit n'a pas analysé ce pilier), `reorderColumn`.
- Service `src/core/services/fix-plan-service.ts` : `load(projet, priorityOf)` (audit de référence = le dernier `COMPLETED` ou `AWAITING_AI_SELECTION`, ce dernier ne vérifiant que le technique ; anomalies GEO ignorées tant que `GEO_ENABLED` est faux ; création des tâches AUTO pour les anomalies dont `priorityOf` rend 0 (impact fort) ou 1 (moyen), triées par impact puis gravité, en fin de « À corriger »), `add(projet, [{ code, url }])` (MANUAL, d'après le dernier audit ; une tâche retirée revient en « À corriger »), `update(projet, tâche, { status, beforeId, note })` (renumérotation de la colonne), `remove` (REMOVED).
- Routes `GET|POST /api/projects/[projectId]/plan` (`priorityOf` calculé par `lib/issue-impact.ts` ; le `POST` accepte `{ items }` pour les anomalies ou `{ custom: { title, details?, urls? } }` pour une tâche libre), `PATCH|DELETE /api/projects/[projectId]/plan/[taskId]`.
- **Tâches libres** (depuis le 09/11/2026, sans changement de schéma) : `FixPlanService.addCustom(projet, { title, details?, urls? })` crée une ligne `source = 'CUSTOM'`, `pillar = 'CUSTOM'` (`CUSTOM_PILLAR`), `severity = 'INFO'`, `code = 'CUSTOM:<uuid>'` (`CUSTOM_CODE_PREFIX`, un code unique par tâche : la clé `(projectId, code, pageKey)` ne peut pas entrer en conflit), `recommendation` = les détails (1000 caractères), titre de 160 caractères. Une tâche par adresse donnée (au plus 100, doublons écartés, `https://` ajouté si absent, `Adresse invalide : …` sinon) ; sans adresse, une seule tâche sans page (`pageKey` vide, affichée « Sans page »). Les tâches arrivent **en haut** de « À corriger » (positions sous le minimum de la colonne, pour rester visibles au-delà des 30 cartes affichées). `load` ne calcule aucune vérification pour une tâche `CUSTOM` (`verification = null`) ; le titre et la gravité ne sont jamais remplacés par un relevé d'audit. Retrait : `REMOVED`, comme les autres.
- Interface : `components/audit/fix-plan-view.tsx` (colonnes, glisser-déposer HTML5, boutons de déplacement, note, filtres, interrupteur **Par page / Par anomalie** gardé dans `localStorage` sous `plan-view`, filtre « Libres »), `fix-plan-group.tsx` (`GroupCard`, `NewTaskButton`), `fix-plan-shared.ts` (libellés, `pageLabel`, `isCustom`), `use-fix-plan.ts` (mises à jour affichées tout de suite, relecture en cas d'échec, `statusOf(code, url)`, `addCustom`), boutons d'ajout dans `global-issues-view.tsx` (`AddIssueToPlan`) et `individual-issue-view.tsx`, entrée « Plan d'action » de la barre latérale.
- **Vue « Par anomalie »** : affichage seul, rien n'est enregistré de plus. `groupColumn` regroupe, **dans chaque colonne**, les tâches de même `code` (2 pages ou plus ; une tâche seule et les tâches libres restent des cartes ordinaires) ; le groupe prend la place de sa première tâche. La carte groupe dit « N pages » (et « N ici, M dans le plan » si l'anomalie a des tâches dans une autre colonne), additionne les constats du dernier audit (« N pages encore relevées » avec Rouvrir, « N pages plus relevées » avec Passer en Terminée, qui ne déplacent que ces pages), se déplie sur la liste des pages (case, ouverture du tiroir, déplacement ou retrait page par page). Boutons, glisser-déposer (dépôt à la fin de la colonne) et case de sélection du groupe agissent sur toutes ses tâches de la colonne (`moveTasks`, avec « Annuler ») ; la case est partielle (« mixed ») si une partie seulement est cochée, et la barre d'actions s'applique ensuite aux tâches cochées.

### Tableau personnalisable (`components/table/`, Sous-pages depuis le 08/11/2026)

- Logique pure `lib/table-layout.ts` (testée) : `TableColumn` (id, libellé, largeur, bornes, `fixed` pour la case de sélection), `TableLayout` (`order` de toutes les colonnes mobiles, `hidden`, `pinned`, `widths` ; une ancienne `density` enregistrée est ignorée), `defaultLayout`, `mergeLayout` (disposition enregistrée remise d'aplomb : colonnes inconnues retirées, nouvelles ajoutées à la fin, largeurs bornées 72 à 640 px par défaut, une colonne mobile au moins visible), `visibleColumns` (fixes, puis épinglées, puis les autres), `groupOf` et `moveColumn` (déplacement au sein du groupe épinglé ou non), `toggleHidden` (une colonne masquée est détachée), `togglePinned`, `stickyOffsets`, `layoutSummary`.
- `use-table-layout.ts` : état et enregistrement dans `localStorage` (`auditly:tableau:<clé>`, ici `sous-pages`), lu après le premier rendu, écrit **seulement** à chaque changement fait par l'utilisateur (un effet d'écriture au montage, joué deux fois en développement par React, écrasait la disposition enregistrée) ; phrase `announcement` pour une zone `aria-live`.
- `customizable-table.tsx` : `CustomizableTable<T>` (colonnes `ColumnSpec<T>` : en-tête, cellule, `rowHeader`). Glisser un en-tête (événements pointeur, seuil 4 px) : cellules de la colonne déplacées par `transform` avec la classe `col-lifted`, cible calculée sur le milieu des colonnes du groupe, trait de dépôt ; à la fin `api.move`. Animation des autres colonnes par FLIP (`Element.animate`, 220 ms, coupée si `prefers-reduced-motion`). Largeur : poignée `data-resize` au bord droit (double clic ou Entrée : `autoFit`, largeur du contenu le plus large). Colonnes collées à gauche (`position: sticky`, décalage `stickyOffsets`), fond opaque et teinte de ligne partagée (`--row-tint`), ombre de la dernière quand le tableau défile. Clavier sur un en-tête : ← →, Alt + ← → (déplacer), Maj + ← → (16 px), E, M, Entrée, Échap (annule un glisser). Styles `.ct-*` et `.col-lifted` dans `globals.css`.
- `table-layout-controls.tsx` : `TableLayoutToolbar` (menu Colonnes en `Popover` de `@base-ui/react`, Réinitialiser ; densité des lignes retirée le 08/11/2026, écart jugé trop faible) et `TableLayoutFooter` (résumé, raccourcis, zone `role="status"`).
- Sous-pages : `SUBPAGE_COLUMNS` dans `subpages-view.tsx` (en-têtes en français : « Statut HTTP », « Détails »). Positionnement : `POSITIONING_COLUMNS` (`positioning-view.tsx`, résultats Google par `expandedRow`, contenu collé à gauche et large comme la vue, mesurée par `ResizeObserver`). SEO éditorial : `EDITORIAL_COLUMNS` (`seo-editorial-view.tsx`). Clés d'enregistrement : `sous-pages`, `positionnement`, `seo-editorial`. Largeurs par défaut de Positionnement et SEO éditorial ajustées à 1 070 px (carte d'un écran de 1 440 px, sans défilement).
- **Métriques ajoutables** (`components/table/page-metrics.tsx`) : `usePageSources(audit)` (par identifiant de page : `subpages`, `pillarPages`, `inspections`, et le nombre d'anomalies par gravité tiré de `globalIssues[].impactedUrls`) ; `usePageMetricColumns(audit, idOf, exclude)` renvoie le catalogue (identifiants `m:…`, `group`, `defaultHidden`, `description` en infobulle du menu) plus une colonne par critère éditorial rencontré dans l'audit (`m:edito:<nom>`, % des points de `inspection.editorial.categories`). Chaque tableau exclut les métriques qu'il montre déjà. Aucune requête en plus ; donnée absente : « — » ; couleurs seulement pour les écarts mesurés (vert, rouge). `TableColumn` gagne `group`, `defaultHidden`, `description` ; `defaultLayout` masque les colonnes `defaultHidden` ; `mergeLayout` masque les colonnes apparues depuis l'enregistrement si elles le sont par défaut. `useTableLayout` relit la disposition enregistrée quand la liste des colonnes change (les critères éditoriaux n'existent qu'une fois l'audit chargé : sans relecture, une colonne choisie était perdue au rechargement). Menu `TableLayoutToolbar` : recherche (sans accents), « Colonnes du tableau » puis les groupes ; en-têtes sur deux lignes au plus ; fond opaque des colonnes collées seulement quand le tableau défile (`.ct-table.is-scrolled`).

### Requêtes notées (`src/core/domain/scoring/query-set.ts`)
`buildQuerySet({ target, research, candidates, override, brandOnly })` (4 requêtes en automatique, `MAX_MANUAL_QUERY_SET` = 6 choisies à la main, comme la mesure Google ; colonne « Notée » du bloc « Mots-clés et volumes » et tableau « Requêtes notées », qui ne liste que les requêtes notées, plus celles ajoutées à la main avant enregistrement) : contact ou utilitaire, requête de marque seule ; `RawPageData.querySetOverride` (`metricsRaw.querySetOverride`, route `POST /api/audits/[auditId]/pages/[pageId]/queries`, `AuditService.setQuerySet`, recalcul sans IA) ; vrais volumes (`research.provider` non simulé et sans erreur) : 4 lignes à volume > 0 au plus, sans variante proche (`isSameQuery` dans les deux sens, `swapsOneWord`) ; sinon requête cible et candidates `suggestedByGoogle`, poids égaux. `cappedWeights` : part du volume plafonnée à 50 % (75 % à deux), surplus redistribué. `withMeasurements` calcule `evaluation.querySet` (`QuerySetMeasure` : `coverage` par `measureHotZones`, `intent` par `checks.intentByQuery` sinon `checks.intent` pour la requête cible, `cannibal` par `cannibalFromSerp` sur `serpForQuery(query, serp, serps)`, `position`). `criterionPoints` : intention = `weightedAverage` des requêtes jugées, couverture = Σ poids × couverture, concurrence = moyenne pondérée (mesure Google, sinon estimation) ; `calculate(page, eval, serp, serps)` reçoit tous les relevés (`serpQueries`). `queryConfirmed` : au moins une requête `confirmed`. Grilles : `answered()` ignore une grille sans aucune case reconnue (ancienne note gardée) ; `answerOf()` accepte « intent.need ». Prompt v10 : bloc `<requetes_notees>`, `checks.intentByQuery`, forme JSON donnée en exemple ; `withoutGroup` retire les préfixes. `analyzeEditorial` cherche les mots-clés (`buildKeywordResearch`) **avant** l'IA et lui envoie les requêtes du groupe (requête cible sans lieu). Présentateur : `editorial.querySet`, `querySetManual`, `querySet` des listes ; interface `components/audit/query-set-panel.tsx` ; Positionnement les coche (« Notée »). La réécriture prend la requête la plus lourde comme principale.
