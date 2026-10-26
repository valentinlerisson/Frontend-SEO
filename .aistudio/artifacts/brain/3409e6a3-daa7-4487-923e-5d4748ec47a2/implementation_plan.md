# Plan d'implémentation : Fichier maître de spécifications et d'architecture Backend (Fichier.md)

Ce plan détaille la création du document de référence exhaustif `Fichier.md` destiné à guider le développement du backend d'audit SEO/GEO (robot de crawl, moteurs d'analyse IA, base de données et calculs de scoring).

---

## 1. Objectifs & Cadre
1. **Document unique de vérité (`Fichier.md`)** consolidant :
   - Le **cahier des charges fonctionnel** (règles métier, cycle de vie en 2 phases, politiques d'écrasement cascade).
   - L'**architecture technique hexagonale** (Domain, Application, Infrastructure, Presentation) garantissant l'indépendance de la logique métier.
   - La **stack technologique** validée : Node.js/TypeScript, PostgreSQL + Prisma ORM, BullMQ + Redis, Crawlee + Cheerio, Vercel AI SDK (Claude 3.5 Sonnet prioritaire / fallback).
   - Le **système de scoring précis à 100 points par pilier** (Technique, Éditorial, GEO) avec formules mathématiques et seuils de pénalité.
   - La **cartographie exhaustive des métriques** extractibles par robot (crawleur HTTP) et par analyse sémantique IA.
   - La **liste des Skills & Adapters recommandés** pour la phase d'implémentation backend.

---

## 2. Structure détaillée de `Fichier.md`

### Section I — Cahier de Spécifications des Fonctionnalités
- **Invariants Métier Non-Négociables** :
  - *Zéro Historique* : Écrasement en cascade (`onDelete: Cascade`) par projet à chaque nouveau crawl.
  - *100% Mobile-First* : User-Agent Googlebot Smartphone, API PageSpeed Insights mobile exclusive.
  - *Cycle en 2 Phases* :
    1. Phase 1 : Crawl local BFS (max 500 pages) -> statut `AWAITING_AI_SELECTION`.
    2. Phase 2 : Sélection consultant de 10 à 20 pages piliers -> Analyse LLM -> statut `COMPLETED`.
  - *Protection des Coûts API* : Verrouillage IA des pages non-piliers (badge d'accès verrouillé dans l'UI).
  - *Pénalité Bloquante* : 4xx/5xx ou `noindex` = score Éditorial et GEO fixés à 0 d'office.
- **Workflow & États de l'Audit** :
  - `IDLE` -> `QUEUED` -> `CRAWLING_TECH` -> `AWAITING_AI_SELECTION` -> `ANALYZING_AI` -> `COMPLETED` / `FAILED`.

### Section II — Architecture du Projet (Hexagonale & Clean Architecture)
- **Domain Layer (`src/core/domain/`)** :
  - Entités pures : `Project`, `Audit`, `Page`, `Metric`, `Issue`, `Score`.
  - Value Objects : `HttpStatus`, `CrawlDepth`, `CoreWebVitals`, `SemanticScore`.
  - Moteurs de scoring purs et déterministes sans dépendance I/O.
- **Application Layer (`src/core/application/`)** :
  - Ports entrants (Use Cases) : `StartCrawlUseCase`, `SelectPillarsUseCase`, `ExecuteAiAnalysisUseCase`, `ExportAuditReportUseCase`.
  - Ports sortants (Interfaces) : `CrawlerPort`, `AiAnalysisPort`, `AuditRepositoryPort`, `QueuePort`, `SpeedAuditPort`.
- **Infrastructure Layer (`src/infrastructure/`)** :
  - `repositories/prisma/` : Implémentation Prisma avec schéma relationnel PostgreSQL.
  - `crawler/crawlee/` : Configuration Crawlee CheerioCrawler (Googlebot Smartphone, détection canonique, hiérarchie DOM, liens internes).
  - `ai/ai-gateway/` : Vercel AI SDK avec client Claude 3.5 Sonnet et structured outputs (Zod schema).
  - `queue/bullmq/` : Workers Redis isolés pour la phase 1 (crawl) et la phase 2 (LLM batch).
  - `speed/pagespeed/` : Intégration Google PageSpeed Insights REST API.
- **Presentation / API Layer (`src/presentation/` & Next.js App Router)** :
  - Routes d'API `/api/audits/*` connectées au front-end existant.

### Section III — Stacks Technologiques & Rôles
- Runtime : Node.js (LTS) / TypeScript strict.
- Persistance : PostgreSQL + Prisma ORM (avec migrations versionnées).
- Queue asynchrone : BullMQ + Redis (gestion des retries, rate-limits, états en temps réel).
- Moteur d'extraction web : Crawlee (`CheerioCrawler` + `PlaywrightCrawler` de repli pour JS lourd).
- Gateway LLM : Vercel AI SDK (`@ai-sdk/anthropic` + `@ai-sdk/google` en fallback).
- Parsing & Sélecteurs : Cheerio, htmlparser2.

### Section IV — Métriques Exhaustives & Algorithme de Scoring (100 Pts / Pilier)
1. **Pilier Technique (100 pts - Déterministe)** :
   - *Core Web Vitals* (25 pts) : LCP (10 pts), INP (8 pts), CLS (7 pts).
   - *Architecture & Maillage* (20 pts) : Profondeur de clic ≤ 3 (10 pts), Absence de pages orphelines (10 pts).
   - *Crawlabilité & Indexation* (15 pts) : robots.txt valide (5 pts), sitemap accessible (5 pts), canonique auto-référente/conforme (5 pts).
   - *Sécurité & Codes HTTP* (15 pts) : HTTPS/SSL (5 pts), Absence d'erreurs 4xx/5xx (5 pts), Absence de boucles de redirection (5 pts).
   - *Structure HTML & Balisage* (15 pts) : H1 unique (8 pts), Respect hiérarchique H2-H6 sans sauts (7 pts).
   - *Métadonnées & Médias* (10 pts) : Title/Meta description calibrées (5 pts), Images avec attribut `alt` ≥ 90% (5 pts).
2. **Pilier Éditorial (100 pts - LLM / Vercel AI SDK)** :
   - *Intent Match* (20 pts) : Alignement intention de recherche utilisateur vs contenu délivré.
   - *Absence de cannibalisation sémantique* (20 pts) : Unicité du ciblage par rapport aux autres pages piliers.
   - *Optimisation des zones chaudes* (15 pts) : Présence du sujet principal dans Title, H1, slug URL et 100 premiers mots.
   - *Contenu primaire / TL;DR / Réponse directe* (15 pts) : Clarté et densité informationnelle d'entrée.
   - *Couverture sémantique & Entités nommées* (15 pts) : Profondeur lexicale et entités Wikidata/Google Knowledge Graph.
   - *Signaux E-E-A-T* (10 pts) : Présence auteur qualifié, sources, date de mise à jour.
   - *Lisibilité & Structure de lecture* (5 pts) : Score Flesch-Kincaid > 60, paragraphes digestes.
3. **Pilier GEO (100 pts - LLM / Vercel AI SDK)** :
   - *Accessibilité aux bots IA* (25 pts) : Règles d'autorisation explicites dans `robots.txt` pour GPTBot (10 pts), ClaudeBot (10 pts), PerplexityBot (5 pts).
   - *Standard `/llms.txt`* (25 pts) : Présence, format markdown synthétique et disponibilité à la racine.
   - *Citabilité & Passage Ranking* (20 pts) : Structuration en blocs autonomes extractibles (H2/H3, listes, tableaux, définitions claires).
   - *Données d'autorité & Sources externes* (10 pts) : Liens pointant vers des sources factuelles d'autorité (≥ 2 liens fiables).
   - *Schéma.org JSON-LD* (10 pts) : Typage structuré Organization, Article, LocalBusiness, FAQPage valide.
   - *Cohérence NAP (Name, Address, Phone)* (10 pts) : Uniformité stricte des coordonnées locales sur le site.
- **Score Global du Projet** : Moyenne pondérée des 3 piliers avec condition de non-régression.

### Section V — Skills & Modules Backend Recommandés
- `crawlee-scraper` : Configuration d'extraction rapide, gestion de la mémoire, limitation de débit et rotation d'IP.
- `prisma-schema-design` : Schéma de base de données relationnelle optimisé avec relations en cascade et index.
- `bullmq-job-orchestrator` : Modèle de workers décorrélés pour crawler et analyseur IA avec communication temps réel via SSE (Server-Sent Events) ou WebSockets.
- `ai-prompt-evaluator` : Définition des prompts système Zod structurés pour Claude 3.5 Sonnet avec calcul de confiance.
