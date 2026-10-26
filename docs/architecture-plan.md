# PLAN D'ARCHITECTURE ET SPÉCIFICATIONS TECHNIQUES DU PROJET BIGAPP

> **Document de référence architectural** : Consolidation des principes directeurs, de l'architecture hexagonale et des règles de scoring pour l'application d'audit SEO & GEO.

---

## 1. Principes Directeurs & Invariants Métier

1. **Architecture Hexagonale Stricte (Ports & Adapters)** :
   - Le noyau de domaine (`src/core/domain/`) est 100% agnostique : aucune dépendance vers Prisma, Next.js, React, Crawlee ou des bibliothèques réseau/I/O.
   - Les moteurs de calcul de scores (`TechScoringEngine`, `EditorialScoringEngine`, `GeoScoringEngine`, `GlobalScoringEngine`) sont des fonctions pures et déterministes.
   - Les adaptateurs primaires (`src/adapters/primary/`) reçoivent les requêtes utilisateur (contrôleurs API, Presenters UI).
   - Les adaptateurs secondaires (`src/adapters/secondary/`) encapsulent les effets de bord et l'infrastructure externe :
     - `database/prisma.ts` : Persistance relationnelle (SQLite dev / PostgreSQL prod).
     - `crawler/` : Extraction HTTP Mobile-First (User-Agent Googlebot Smartphone).
     - `llm/` : Passerelle IA unifiée multi-modèles pour l'évaluation sémantique.

2. **Politique du Zéro-Historique ("Cascade Overwrite")** :
   - Un projet ne conserve qu'**un seul audit actif** à un instant T.
   - Tout nouvel audit déclenché sur un domaine existant supprime atomiquement en cascade (`onDelete: Cascade`) les données du crawl précédent.

3. **100% Mobile-First Impératif** :
   - User-Agent de crawl fixé sur Googlebot Smartphone.
   - Audits de performance axés exclusivement sur la stratégie mobile.

4. **Cycle de Vie d'un Audit en 2 Phases** :
   - **Phase 1 (Technique & Structure)** : Crawl local BFS -> détection des pages, métriques brutes et HTTP -> calcul du score technique -> passage au statut `AWAITING_AI_SELECTION`.
   - **Phase 2 (Analyse IA Approfondie)** : Sélection par le consultant de 10 à 20 pages piliers -> évaluation sémantique Éditorial & GEO -> finalisation au statut `COMPLETED`.

5. **Invariants 4xx / 5xx / NoIndex** :
   - Si une page répond avec un code HTTP >= 400 ou est marquée en `noindex`, ses scores Éditorial, GEO, Intent Match (/20) et Zones Chaudes (/15) sont strictement forcés à 0.

---

## 2. Arborescence du Projet

```text
├── app/                              # Next.js App Router (Couche Présentation)
│   ├── api/                          # Endpoints REST (/api/projects, /api/audits)
│   ├── dashboard/                    # Vues Dashboard & lancement d'audits
│   ├── projects/ & projets/          # Consultation des projets & audits
├── components/                       # Composants React de présentation
│   ├── audit/                        # Vues d'audit (synthèse, sous-pages, GEO, éditorial, tiroir)
│   ├── dashboard/                    # Widgets et tableaux de bord
│   └── providers/                    # Contextes React (AuditProvider, ProjectsProvider)
├── docs/                             # Documentation centralisée du projet
│   ├── architecture-plan.md          # Présent document d'architecture consolidé
│   ├── Fichier.md                    # Spécifications exhaustives des métriques
│   ├── fonctionnalites_par_page.md   # Spécifications fonctionnelles par écran
│   └── structure_et_logique_frontend.md # Directives d'interface et d'expérience
├── lib/                              # Contrats de types UI et utilitaires partagés
│   ├── audit-data.ts                 # Types stricts attendus par les vues React
│   ├── prisma.ts                     # Réexport du client Prisma
│   └── projects.ts                   # Types projets et scores UI
├── prisma/                           # Schéma ORM et migrations
│   └── schema.prisma                 # Modèles Project, Audit, Page, Issue
└── src/
    ├── adapters/
    │   ├── primary/
    │   │   └── presenters/           # AuditPresenter : mapping hexagonal Domaine/BDD -> DTO UI
    │   └── secondary/
    │       ├── crawler/              # SiteCrawler, PageExtractor (Googlebot Smartphone)
    │       ├── database/             # Client Prisma (connexion persistance)
    │       └── llm/                  # Passerelle LLM multi-modèles (AI SDK / Gemini)
    └── core/
        ├── domain/
        │   ├── scoring/              # Moteurs purs (Tech, Editorial, Geo, Global)
        │   └── types.ts              # Entités et Value Objects purs du domaine
        └── services/
            └── audit-service.ts      # Cas d'usage applicatifs (orchestration du pipeline)
```

---

## 3. Cartographie du Scoring (100 Pts / Pilier)

| Pilier | Type | Pondération Pilier | Métriques Clés |
| :--- | :--- | :--- | :--- |
| **Technique** | Déterministe (Robot) | 100 points | Core Web Vitals (25%), Profondeur & Liens (20%), Statuts HTTP (20%), Indexabilité & Balises (20%), HTTPS & Assets (15%) |
| **Éditorial** | Sémantique (LLM) | 100 points | Search Intent Match (/20), Zones Chaudes (/15), Qualité & Tonalité (/30), Sémantique & Structure (/35) |
| **GEO** | Moteurs Génératifs | 100 points | Citabilité IA (/30), Factualité & Structure (/30), Accessibilité Robots IA (/20), Schema.org & Entités (/20) |

---

## 4. Normalisation des Échelles dans le Presenter

Le `AuditPresenter` effectue la transformation des données de persistance vers les formats exacts attendus par l'UI :
- `intentMatchScore` : calculé strictement sur une échelle de **0 à 20** : `Math.round((score / 100) * 20)`
- `hotZonesScore` : calculé strictement sur une échelle de **0 à 15** : `Math.round((score / 100) * 15)`
- `editorialScore`, `geoScore`, `techScore` : pourcentages stricts **0 à 100%**
- Sécurisation absolue : remplacement des `undefined` par des tableaux vides `[]`
