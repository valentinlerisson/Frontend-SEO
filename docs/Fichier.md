# BIGAPP SEO & GEO — SPÉCIFICATIONS TECHNIQUES, ARCHITECTURE BACKEND ET MODÈLE DE SCORING EXHAUSTIF

> **Statut du document** : Document de référence absolu (Source of Truth) pour la conception et l'implémentation du backend d'audit SEO & GEO.  
> **Auteur** : Lead Software Architect & SEO Engineer  
> **Dernière mise à jour** : 2026-10-26  

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
   - **Phase 2 (Semi-Automatisée - IA)** : Le consultant sélectionne manuellement entre **10 et 20 pages piliers** dans l'interface Subpages. Dès confirmation, la queue BullMQ déclenche l'évaluation sémantique Claude 3.5 Sonnet par lots (Éditorial & GEO). L'audit passe ensuite au statut `COMPLETED`.

5. **Protection Stricte des Coûts API LLM & Gating Visuel** :
   - L'analyse Claude 3.5 Sonnet est **strictement réservée aux pages piliers** (`isPillar: true`).
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
 [ ANALYZING_AI ] ── (Passerelle Vercel AI SDK / Claude 3.5 Sonnet par lot)
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
| **Passerelle IA** | **Vercel AI SDK (`@ai-sdk/anthropic`)** | Modèle cible : `claude-3-5-sonnet-latest`. Formatage des sorties structurées via `generateObject({ schema: zodSchema })`. Possibilité de repli transparent sur `gemini-1.5-pro`. |
| **Performance Web** | **Google PageSpeed Insights REST API** | Métriques Core Web Vitals lab & field réelles (LCP, INP, CLS) avec profil d'émulation Mobile 4G. |
| **Temps Réel UI** | **Server-Sent Events (SSE)** | Flux uni-directionnel natif HTTP/2 permettant à la barre de progression front-end de refléter le statut du crawl et de l'IA en temps réel. |

---

## 4. CARTOGRAPHIE DES MÉTRIQUES, SCORING & GUIDES DE RÉSOLUTION ACTIONNABLES

Chaque critère est défini par son **barème**, sa **méthode de mesure**, sa **sévérité en cas d'échec**, son **commentaire pédagogique explicatif**, et sa **résolution étape par étape** directement exploitable par l'utilisateur.

---

### 4.1 Pilier Technique (100 Pts — Déterministe / Robot)

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
│ 5. Structure HTML & Balisage │ 15 pts │ Parseur DOM Cheerio            │
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

#### 5. Structure HTML & Hiérarchie des Titres (15 Pts) — Collecte : Cheerio DOM

##### A. Balise `<h1>` Unique et Conforme — 8 pts
- **Barème** : Exactement un `<h1>` pertinent : **8 pts** | Multiples `<h1>` : **3 pts** | Aucun `<h1>` ou vide : **0 pt**
- **Sévérité si dégradé** : `CRITICAL` si absent, `WARNING` si multiple.
- **Commentaire affiché** :
  > *"{diagnostic : Aucun H1 détecté / Plusieurs balises H1 détectées ({count})}. Le titre H1 doit être l'indicateur thématique suprême de la page."*
- **Résolution étape par étape** :
  1. Conserver un seul et unique `<h1>` par document HTML, placé en haut du corps principal (`main`).
  2. Formuler un H1 concis (entre 15 et 65 caractères) contenant le mot-clé principal de la page.
  3. Rétrograder les autres éléments stylés en H1 vers des balises `<h2>` ou de simples classes CSS de présentation.

##### B. Hiérarchie des Sous-Titres (H2 à H6) — 7 pts
- **Barème** : Hiérarchie logique sans saut : **7 pts** | 1 à 2 sauts mineurs : **3 pts** | Désordre structurel ou absence de H2 : **0 pt**
- **Sévérité si dégradé** : `WARNING`.
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
│ 3. Zones Chaudes SEO         │ 15 pts │ Title, H1, URL, 100 1ers mots  │
│ 4. Contenu Primaire & TL;DR  │ 15 pts │ Réponse directe d'entrée       │
│ 5. Richesse Sémantique & EEAT│ 15 pts │ Entités nommées & profondeur   │
│ 6. Signaux de Confiance      │ 10 pts │ Auteur visible, sources, date  │
│ 7. Lisibilité & Structure    │ 5 pts  │ Score Flesch, paragraphes      │
└──────────────────────────────┴────────┴────────────────────────────────┘
```

#### 1. Search Intent Match (20 Pts)
- **Barème** : Alignement parfait (20 pts) | Partiel (10 pts) | En désaccord / Trompeur (0 pt)
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
- **Barème** : 4 pts Title + 4 pts H1 + 4 pts Slug URL + 3 pts Premier paragraphe
- **Commentaire affiché** :
  > *"Le mot-clé principal n'est pas positionné dans les zones à forte pondération algorithmique (absent de : {missingZones})."*
- **Résolution étape par étape** :
  1. Insérer le terme cible au plus près du début de la balise Title et du titre H1.
  2. Nettoyer le slug d'URL pour le rendre lisible et concis (`/mot-cle-principal/`).
  3. Mentionner le sujet clé dès les 100 premiers mots du corps de texte.

#### 4. Contenu Primaire & Réponse Directe (TL;DR) (15 Pts)
- **Barème** : Réponse immédiate structurée (15 pts) | Réponse noyée (7 pts) | Contenu dilué (0 pt)
- **Commentaire affiché** :
  > *"La page manque d'un résumé exécutif ou d'une réponse claire en entrée. L'internaute doit scroller excessivement pour trouver l'information clé."*
- **Résolution étape par étape** :
  1. Ajouter un encadré 'En résumé' ou 'Ce qu'il faut retenir' (TL;DR) juste après le titre H1.
  2. Formuler une réponse claire de 2 à 3 phrases répondant immédiatement à la problématique.

#### 5. Couverture Sémantique & Entités Nommées (15 Pts)
- **Barème** : Entités riches & co-occurrences pertinentes (15 pts) | Lexique basique (7 pts) | Texte pauvre (0 pt)
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

#### 7. Lisibilité & Clarté Typographique (5 Pts)
- **Barème** : Flesch > 60 et paragraphes courts (5 pts) | Lecture dense (2 pts) | Blocs indigestes (0 pt)
- **Commentaire affiché** :
  > *"Le texte comporte des blocs de paragraphes trop longs et un indice de lisibilité Flesch trop sévère pour une lecture sur écran mobile."*
- **Résolution étape par étape** :
  1. Limiter les paragraphes à 3 ou 4 lignes maximum.
  2. Utiliser des listes à puces et mettre en gras les termes essentiels pour faciliter la lecture en diagonale.

---

### 4.3 Pilier GEO — Generative Engine Optimization (100 Pts — IA / Robot)

```
┌────────────────────────────────────────────────────────────────────────┐
│                      PILIER GEO — 100 POINTS                           │
├──────────────────────────────┬────────┬────────────────────────────────┤
│ CRITÈRE GEO                  │ POINTS │ ÉVALUATION                     │
├──────────────────────────────┼────────┼────────────────────────────────┤
│ 1. Accessibilité Bots IA     │ 25 pts │ Test robots.txt (GPT/ClaudeBot)│
│ 2. Fichier /llms.txt Valide  │ 25 pts │ Requête racine HTTP 200 & MD   │
│ 3. Citabilité & Passage Rank │ 20 pts │ Blocs autonomes, listes, FAQ   │
│ 4. Données d'Autorité & Liens│ 10 pts │ Liens externes vers sources    │
│ 5. Données Structurées JSON-LD│ 10 pts│ Schéma.org valide et typé      │
│ 6. Cohérence NAP & Identité  │ 10 pts │ Name, Address, Phone constants │
└──────────────────────────────┴────────┴────────────────────────────────┘
```

#### 1. Accessibilité Robots IA (`robots.txt`) (25 Pts)
- **Barème** : GPTBot (10 pts) + ClaudeBot (10 pts) + PerplexityBot (5 pts)
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

#### 2. Standard `/llms.txt` & Documentation Markdown (25 Pts)
- **Barème** : Fichier présent en HTTP 200 (15 pts) + Qualité et exhaustivité markdown (10 pts)
- **Commentaire affiché** :
  > *"Aucun fichier `/llms.txt` n'est détecté à la racine de votre domaine. Ce standard émergeant permet aux LLM de comprendre instantanément votre offre sans devoir parser l'intégralité du HTML."*
- **Résolution étape par étape** :
  1. Créer un fichier texte nommé `llms.txt` à la racine de votre site (`https://votre-site.com/llms.txt`).
  2. Rédiger une synthèse Markdown claire décrivant votre mission d'entreprise, vos produits phares et la liste des liens vers vos pages piliers.

#### 3. Citabilité & Passage Ranking (20 Pts)
- **Barème** : Blocs modulaires & réponses concises (20 pts) | Citabilité moyenne (10 pts) | Texte linéaire sans accroche (0 pt)
- **Commentaire affiché** :
  > *"Le contenu n'est pas découpé en passages autonomes citables. Les modèles génératifs peinent à extraire des citations courtes et précises pour leurs réponses synthétiques."*
- **Résolution étape par étape** :
  1. Formuler des intertitres H2/H3 sous forme de questions directes posées par votre cible.
  2. Faire suivre chaque question d'un paragraphe autonome de 40 à 60 mots apportant une définition factuelle et sans ambiguïté.
  3. Ajouter des tableaux comparatifs synthétiques ou des listes ordonnées.

#### 4. Données d'Autorité & Sources Externes (10 Pts)
- **Barème** : $\ge 2$ liens externes autoritaires (10 pts) | 1 lien (5 pts) | Aucun lien externe (0 pt)
- **Commentaire affiché** :
  > *"La page n'étaye aucune de ses affirmations par des liens externes vers des sources de données reconnues. Les moteurs IA privilégient les contenus vérifiables."*
- **Résolution étape par étape** :
  1. Citer et lier au moins 2 sources tierces faisant autorité (études officielles, livres blancs universitaires, statistiques de référence).
  2. Configurer les liens externes en `rel="noopener"`.

#### 5. Données Structurées Schéma.org JSON-LD (10 Pts)
- **Barème** : Schéma complet et sans erreur (10 pts) | Schéma incomplet (5 pts) | Aucun schéma détecté (0 pt)
- **Commentaire affiché** :
  > *"Absence de données structurées JSON-LD valides (`Organization`, `Article`, `FAQPage`). Les moteurs IA ne peuvent pas valider avec certitude les entités de la page."*
- **Résolution étape par étape** :
  1. Intégrer un script `<script type="application/ld+json">` dans le `<head>`.
  2. Pour un article : baliser `Article` ou `BlogPosting` avec `author`, `datePublished` et `publisher`.
  3. Pour une FAQ : implémenter le schéma `FAQPage` avec chaque question/réponse.

#### 6. Cohérence NAP (Name, Address, Phone) & Identité (10 Pts)
- **Barème** : Coordonnées uniformes et conformes (10 pts) | Données partielles (5 pts) | Discordances détectées (0 pt)
- **Commentaire affiché** :
  > *"Les coordonnées de contact (Nom d'entreprise, Adresse postale, Téléphone) présentent des discordances entre les pages du site ou ne concordent pas avec les mentions légales."*
- **Résolution étape par étape** :
  1. Standardiser la typographie exacte du nom commercial, de l'adresse et du numéro de téléphone sur toutes les pages (header, footer, page contact).
  2. Renseigner ces mêmes données dans le schéma JSON-LD `LocalBusiness` ou `Organization`.

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
