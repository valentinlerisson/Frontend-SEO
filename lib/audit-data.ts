export type AuditStatus = 'crawling' | 'completed'

export type PillarPage = {
  id: string
  url: string
  path: string
  title: string
  targetKeyword: string
  isAutoDetectedKeyword?: boolean
  editorialScore: number // out of 100
  intentMatchScore: number // out of 20
  hotZonesScore: number // out of 15
  cannibalizationStatus: 'none' | 'conflict'
  cannibalizationTarget?: string
  geoScore: number // out of 100
  aiAccessibility: boolean // OUI / NON
  citability: 'Elevée' | 'Moyenne' | 'Faible'
  schemaOrgPresent: boolean // Présent / Manquant
  techScore: number
  httpStatus: number
  responseTime: string
  indexable: boolean
  follow: boolean
}

export type SubpageItem = {
  id: string
  url: string
  path: string
  title: string
  httpStatus: number
  statusLabel: string
  wordCount: number
  wordCountStatus: 'good' | 'warning' | 'critical' // green (>500), yellow (400-500), red (<400)
  depth: string // 'Niv 0' | 'Niv 1' | 'Niv 2'
  inlinks: number
  targetKeyword: string
  isPillar: boolean
  indexable: boolean
  responseTime: string
}

export type GlobalIssueCategory = 'all' | 'tech' | 'structure' | 'content'
export type IssueSeverity = 'critical' | 'warning' | 'passed'

export type GlobalIssue = {
  id: string
  title: string
  category: 'Tech. & Meta' | 'Structure' | 'Content'
  categoryKey: 'tech' | 'structure' | 'content'
  severity: IssueSeverity
  impactCount?: number
  impactSummary?: string
  description?: string
  recommendation?: string
  previewItems?: {
    path: string
    note: string
    severity: 'critical' | 'warning' | 'passed'
  }[]
  impactedUrls?: {
    id: string
    path: string
    fullUrl: string
    title: string
    wordCount?: number
    depth: string
    inlinks: number
  }[]
}

export type InspectionData = {
  pageId: string
  title: string
  url: string
  httpStatus: number
  indexable: boolean
  follow: boolean
  responseTime: string
  tech: {
    score: number
    categories: { name: string; score: number }[]
    priorities: { type: 'alert' | 'optimization'; text: string }[]
    accordions: {
      title: string
      scoreText: string
      items: { text: string; status: 'valid' | 'warning' | 'error' }[]
    }[]
  }
  editorial: {
    score: number
    targetKeyword: string
    isForcedTarget: boolean
    categories: { name: string; score: number }[]
    priorities: { type: 'alert' | 'optimization'; text: string }[]
    accordions: {
      title: string
      scoreText: string
      aiReasoning: string
      items: { text: string; status: 'valid' | 'warning' | 'error' }[]
    }[]
  }
  geo: {
    score: number
    categories: { name: string; score: number }[]
    priorities: { type: 'alert' | 'optimization'; text: string }[]
    accordions: {
      title: string
      scoreText: string
      aiReasoning: string
      items: { text: string; status: 'valid' | 'warning' | 'error' }[]
    }[]
  }
}

export type ProjectAuditData = {
  projectId: string
  domain: string
  projectName: string
  crawlStats: {
    crawledPages: number
    totalPages: number
    isCrawling: boolean
  }
  scores: {
    global: number
    tech: number
    editorial: number
    geo: number
  }
  kpis: {
    criticalIssuesCount: number
    warningsCount: number
    goodPracticesCount: number
    editorialMean: number
    cannibalizationConflicts: number
    intentMatchGlobal: number
    geoMean: number
    llmsTxtStatus: 'Present' | 'Manquant'
    citabilityMean: number
  }
  pillarPages: PillarPage[]
  subpages: SubpageItem[]
  globalIssues: GlobalIssue[]
  inspections: Record<string, InspectionData>
}

export const bigHappyAuditData: ProjectAuditData = {
  projectId: 'big-happy',
  domain: 'bighappy.fr',
  projectName: 'Big Happy',
  crawlStats: {
    crawledPages: 26,
    totalPages: 87,
    isCrawling: true,
  },
  scores: {
    global: 78,
    tech: 84,
    editorial: 62,
    geo: 84,
  },
  kpis: {
    criticalIssuesCount: 3,
    warningsCount: 12,
    goodPracticesCount: 20,
    editorialMean: 78,
    cannibalizationConflicts: 1,
    intentMatchGlobal: 85,
    geoMean: 68,
    llmsTxtStatus: 'Manquant',
    citabilityMean: 55,
  },
  pillarPages: [
    {
      id: 'accueil',
      url: 'https://bighappy.fr/accueil',
      path: '/accueil',
      title: 'Agence marketing & communication digitale Toulouse | Big Happy',
      targetKeyword: 'agence marketing toulouse 31',
      isAutoDetectedKeyword: false,
      editorialScore: 92,
      intentMatchScore: 19,
      hotZonesScore: 14,
      cannibalizationStatus: 'none',
      geoScore: 92,
      aiAccessibility: true,
      citability: 'Elevée',
      schemaOrgPresent: true,
      techScore: 94,
      httpStatus: 200,
      responseTime: '0.48 s',
      indexable: true,
      follow: true,
    },
    {
      id: 'wine-and-spirit',
      url: 'https://bighappy.fr/wine-and-spirit/',
      path: '/wine&spirit',
      title: 'Agence Communication Vin & Spiritueux | Big Happy',
      targetKeyword: 'agence vin',
      isAutoDetectedKeyword: true,
      editorialScore: 64,
      intentMatchScore: 12,
      hotZonesScore: 5,
      cannibalizationStatus: 'conflict',
      cannibalizationTarget: '/diffusion',
      geoScore: 64,
      aiAccessibility: false,
      citability: 'Moyenne',
      schemaOrgPresent: false,
      techScore: 97,
      httpStatus: 200,
      responseTime: '0.74 s',
      indexable: true,
      follow: true,
    },
    {
      id: 'a-propos',
      url: 'https://bighappy.fr/a-propos',
      path: '/a-propos',
      title: 'A propos de Big Happy | Equipe et Valeurs',
      targetKeyword: 'Equipe BigHappy',
      isAutoDetectedKeyword: false,
      editorialScore: 42,
      intentMatchScore: 8,
      hotZonesScore: 5,
      cannibalizationStatus: 'none',
      geoScore: 42,
      aiAccessibility: true,
      citability: 'Faible',
      schemaOrgPresent: true,
      techScore: 88,
      httpStatus: 200,
      responseTime: '0.52 s',
      indexable: true,
      follow: true,
    },
  ],
  subpages: [
    {
      id: 'accueil',
      url: 'https://bighappy.fr/',
      path: '/ (Accueil)',
      title: 'Big Happy — Agence Conseil & Création',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 363,
      wordCountStatus: 'critical',
      depth: 'Niv 2',
      inlinks: 32,
      targetKeyword: 'Nativement H1',
      isPillar: true,
      indexable: true,
      responseTime: '0.48 s',
    },
    {
      id: 'wine-and-spirit',
      url: 'https://bighappy.fr/wine-and-spirit/',
      path: '/wine&spirit',
      title: 'Agence Communication Vin & Spiritueux | Big Happy',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 653,
      wordCountStatus: 'good',
      depth: 'Niv 1',
      inlinks: 5,
      targetKeyword: 'Peut être vide ou remplis',
      isPillar: true,
      indexable: true,
      responseTime: '0.74 s',
    },
    {
      id: 'a-propos',
      url: 'https://bighappy.fr/a-propos',
      path: '/a-propos',
      title: 'A propos | Notre Histoire',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 1200,
      wordCountStatus: 'good',
      depth: 'Niv 1',
      inlinks: 18,
      targetKeyword: 'Si vide ia see only content',
      isPillar: true,
      indexable: true,
      responseTime: '0.52 s',
    },
    {
      id: 'contact',
      url: 'https://bighappy.fr/contact',
      path: '/contact',
      title: 'Contactez-nous | Big Happy',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 300,
      wordCountStatus: 'critical',
      depth: 'Niv 1',
      inlinks: 3,
      targetKeyword: 'Nativement H1',
      isPillar: false,
      indexable: true,
      responseTime: '0.41 s',
    },
    {
      id: 'actualites',
      url: 'https://bighappy.fr/actualites',
      path: '/actualités',
      title: 'Actualités & Insights Marketing',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 235,
      wordCountStatus: 'critical',
      depth: 'Niv 1',
      inlinks: 3,
      targetKeyword: 'Nativement H1',
      isPillar: false,
      indexable: true,
      responseTime: '0.62 s',
    },
    {
      id: 'actualites-seo-2026',
      url: 'https://bighappy.fr/actualites/seo-2026',
      path: '/actualités/seo-2026',
      title: 'Les enjeux du SEO & GEO en 2026',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 1200,
      wordCountStatus: 'good',
      depth: 'Niv 0',
      inlinks: 3,
      targetKeyword: 'Nativement H1',
      isPillar: false,
      indexable: true,
      responseTime: '0.55 s',
    },
    {
      id: 'actualites-seo',
      url: 'https://bighappy.fr/actualites/seo',
      path: '/actualités/seo',
      title: 'Stratégie de référencement naturel',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 437,
      wordCountStatus: 'warning',
      depth: 'Niv 0',
      inlinks: 14,
      targetKeyword: 'Nativement H1',
      isPillar: false,
      indexable: true,
      responseTime: '0.59 s',
    },
    {
      id: 'actualites-data',
      url: 'https://bighappy.fr/actualites/data',
      path: '/actualités/data',
      title: 'Pilotage par la Data et tracking',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 412,
      wordCountStatus: 'warning',
      depth: 'Niv 0',
      inlinks: 14,
      targetKeyword: 'Nativement H1',
      isPillar: false,
      indexable: true,
      responseTime: '0.49 s',
    },
    {
      id: 'actualites-rs',
      url: 'https://bighappy.fr/actualites/rs',
      path: '/actualités/rs',
      title: 'Réseaux Sociaux & Social Ads',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 462,
      wordCountStatus: 'warning',
      depth: 'Niv 0',
      inlinks: 14,
      targetKeyword: 'Nativement H1',
      isPillar: false,
      indexable: true,
      responseTime: '0.51 s',
    },
    {
      id: 'diffusion',
      url: 'https://bighappy.fr/diffusion',
      path: '/diffusion',
      title: 'Campagnes d’acquisition et diffusion',
      httpStatus: 200,
      statusLabel: '200 OK',
      wordCount: 580,
      wordCountStatus: 'good',
      depth: 'Niv 1',
      inlinks: 8,
      targetKeyword: 'Acquisition digitale',
      isPillar: false,
      indexable: true,
      responseTime: '0.67 s',
    },
  ],
  globalIssues: [
    {
      id: 'title-missing',
      title: 'Balises <title> manquantes, dupliquées ou trop longues.',
      category: 'Tech. & Meta',
      categoryKey: 'tech',
      severity: 'critical',
      impactCount: 4,
      description: 'La balise <title> est le signal SEO on-page le plus direct. Des titres absents ou dupliqués diluent le signal et nuisent au CTR dans les SERP.',
      recommendation: 'Assurez-vous que chaque page possède un titre unique de 50 à 60 caractères contenant le mot-clé principal.',
    },
    {
      id: 'meta-description',
      title: 'Méta-descriptions absentes ou dupliquées.',
      category: 'Tech. & Meta',
      categoryKey: 'tech',
      severity: 'critical',
      impactCount: 7,
      description: 'L’absence de méta-description laisse Google générer un snippet automatique souvent tronqué ou peu incitatif.',
      recommendation: 'Rédigez une méta-description attractive de 140 à 160 caractères incitant au clic pour chaque page indexable.',
    },
    {
      id: 'h1-hierarchy',
      title: 'Hiérarchie des titres (H1 manquant/multiple, sauts H2-H4).',
      category: 'Structure',
      categoryKey: 'structure',
      severity: 'critical',
      impactCount: 6,
      description: 'Plusieurs H1 ou des sauts de hiérarchie structurelle perturbent la compréhension de la page par les robots de crawl et les agents IA.',
      recommendation: 'Conservez un seul H1 par page et respectez une cascade ordonnée sans sauter de niveau (H1 -> H2 -> H3).',
    },
    {
      id: 'broken-links',
      title: 'Liens internes brisés ou ancres de liens vides.',
      category: 'Structure',
      categoryKey: 'structure',
      severity: 'critical',
      impactCount: 2,
      description: 'Les liens brisés (4xx) gaspillent le budget de crawl et dégradent l’expérience utilisateur.',
      recommendation: 'Corrigez immédiatement les URL de destination ou mettez en place des redirections 301 définitives.',
    },
    {
      id: 'orphan-pages',
      title: 'Pages orphelines (présentes uniquement dans le sitemap XML).',
      category: 'Structure',
      categoryKey: 'structure',
      severity: 'warning',
      impactCount: 5,
      description: 'Ces pages ne reçoivent aucun lien interne depuis l’arborescence du site, ce qui freine leur découverte et leur transfert de PageRank.',
      recommendation: 'Liez ces pages stratégiques depuis vos pages piliers ou vos catégories de niveau supérieur.',
    },
    {
      id: 'thin-content',
      title: 'Thin content (pages contenant moins de 500 mots).',
      category: 'Content',
      categoryKey: 'content',
      severity: 'warning',
      impactCount: 34,
      impactSummary: '34 URL thin content',
      description:
        "Les pages contenant moins de 500 mots ont de grandes chances d'être considérées comme du 'contenu pauvre' par Google, ce qui pénalise leur indexation et leur positionnement. Visez au moins 500 à 800 mots de contenu qualitatif.",
      recommendation: 'Enrichissez le corpus textuel avec des définitions claires, des données chiffrées et des sections autonomes.',
      previewItems: [
        { path: 'big-happy/accueil', note: 'Contain 363 words', severity: 'critical' },
        { path: 'big-happy/a-propos', note: 'Contain 432 words', severity: 'warning' },
        { path: 'big-happy/strategie', note: 'Contain 416 words', severity: 'warning' },
      ],
      impactedUrls: [
        { id: 'accueil', path: '/ (Accueil)', fullUrl: 'https://bighappy.fr/', title: 'Accueil', wordCount: 363, depth: 'Niv 2', inlinks: 32 },
        { id: 'contact', path: '/contact', fullUrl: 'https://bighappy.fr/contact', title: 'Contact', wordCount: 300, depth: 'Niv 1', inlinks: 8 },
        { id: 'actualites', path: '/actualités', fullUrl: 'https://bighappy.fr/actualites', title: 'Actualités', wordCount: 235, depth: 'Niv 1', inlinks: 14 },
        { id: 'actualites-seo', path: '/actualités/seo', fullUrl: 'https://bighappy.fr/actualites/seo', title: 'Actualités SEO', wordCount: 437, depth: 'Niv 0', inlinks: 14 },
        { id: 'actualites-data', path: '/actualités/data', fullUrl: 'https://bighappy.fr/actualites/data', title: 'Actualités Data', wordCount: 412, depth: 'Niv 0', inlinks: 14 },
        { id: 'actualites-rs', path: '/actualités/rs', fullUrl: 'https://bighappy.fr/actualites/rs', title: 'Actualités RS', wordCount: 462, depth: 'Niv 0', inlinks: 14 },
      ],
    },
    {
      id: 'alt-tags-ok',
      title: 'Aucune balise alt vide',
      category: 'Structure',
      categoryKey: 'structure',
      severity: 'passed',
      impactCount: 0,
      description: 'Toutes les images crawlées disposent d’un attribut alt descriptif, garantissant l’accessibilité et le référencement image.',
      recommendation: 'Maintenir cette bonne pratique lors des prochains ajouts de médias.',
    },
    {
      id: 'best-practices-detected',
      title: '4 bonnes pratiques détectées',
      category: 'Structure',
      categoryKey: 'structure',
      severity: 'passed',
      impactCount: 0,
      description: 'Certificat SSL valide, compression GZIP/Brotli activée, balisage canonical conforme et structure responsive Mobile-First.',
      recommendation: 'Rien à signaler, socle technique sain.',
    },
  ],
  inspections: {
    'wine-and-spirit': {
      pageId: 'wine-and-spirit',
      title: 'Agence Communication Vin & Spiritueux | Big Happy',
      url: 'https://bighappy.fr/wine-and-spirit/',
      httpStatus: 200,
      indexable: true,
      follow: true,
      responseTime: '0.74 s',
      tech: {
        score: 97,
        categories: [
          { name: 'Meta information', score: 100 },
          { name: 'Page quality', score: 100 },
          { name: 'Page structure', score: 97 },
          { name: 'Links', score: 85 },
          { name: 'Server', score: 84 },
          { name: 'External factors', score: 15 },
        ],
        priorities: [
          { type: 'alert', text: 'Le fichier robots.txt est introuvable ou mal configuré.' },
          { type: 'optimization', text: 'Améliorez le temps de réponse de la page (0.74 s).' },
        ],
        accordions: [
          {
            title: '1. Meta data',
            scoreText: '97%',
            items: [
              { text: 'Titre présent et bien calibré (58 caractères)', status: 'valid' },
              { text: 'Méta description unique et optimisée', status: 'valid' },
              { text: 'Absence de balises Open Graph (og:image, og:description)', status: 'warning' },
            ],
          },
          {
            title: '2. Page structure',
            scoreText: '97%',
            items: [
              { text: 'Un unique H1 détecté', status: 'valid' },
              { text: 'Hiérarchie des titres (H2-H6) respectée', status: 'valid' },
              { text: "Présence d'images sans attribut alt (2 images manquantes)", status: 'warning' },
            ],
          },
          {
            title: '3. Link structure',
            scoreText: '85%',
            items: [
              { text: 'Maillage interne cohérent (5 inlinks contextuels)', status: 'valid' },
              { text: 'Aucun lien brisé interne (code 200)', status: 'valid' },
              { text: 'Absence de liens sortants vers des sources autoritaires', status: 'warning' },
            ],
          },
          {
            title: '4. Server configuration',
            scoreText: '84%',
            items: [
              { text: 'Protocole HTTPS et certificat SSL valides', status: 'valid' },
              { text: 'Temps de réponse TTFB améliorable (0.74s > 0.4s cible)', status: 'warning' },
              { text: 'Compression des assets et cache navigateur configurés', status: 'valid' },
            ],
          },
        ],
      },
      editorial: {
        score: 84,
        targetKeyword: 'audit seo technique',
        isForcedTarget: true,
        categories: [
          { name: 'Intent Match', score: 100 },
          { name: 'Cannibalisation', score: 100 },
          { name: 'Zones Chaudes', score: 80 },
          { name: 'Contenu Primaire', score: 60 },
          { name: 'Couverture Sémantique', score: 95 },
          { name: 'E-E-A-T', score: 40 },
          { name: 'Lisibilité', score: 100 },
        ],
        priorities: [
          { type: 'alert', text: 'Aucun auteur identifié et aucune date de mise à jour visible (Critère E-E-A-T).' },
          { type: 'optimization', text: 'La définition principale est enfouie au 3ème écran, remontez-la en introduction.' },
        ],
        accordions: [
          {
            title: '1. Intent Match & Cannibalisation',
            scoreText: '20/20',
            aiReasoning:
              "Le contenu répond parfaitement à l'intention de recherche transactionnelle/commerciale liée à 'audit seo technique'. L'analyse confirme la clarté du positionnement et l'absence totale de concurrence sémantique avec d'autres pages du domaine.",
            items: [
              { text: 'Intention comprise et traitée', status: 'valid' },
              { text: 'Absence de conflits', status: 'valid' },
            ],
          },
          {
            title: '2. Zones Chaudes Stratégiques',
            scoreText: '12/15',
            aiReasoning:
              "Le mot-clé principal est parfaitement intégré dans le <title> et le <H1>. Cependant, il est absent des 100 premiers mots de l'introduction narrative.",
            items: [
              { text: 'Présence dans le <title>', status: 'valid' },
              { text: 'Présence dans le <H1>', status: 'valid' },
              { text: 'Présence dans les 100 premiers mots', status: 'error' },
            ],
          },
          {
            title: '3. Contenu Primaire & Réponse Directe',
            scoreText: '9/15',
            aiReasoning:
              "La proposition de valeur est qualitative mais nécessite de scroller sous le hero slider pour accéder aux explications concrètes de l'offre.",
            items: [
              { text: 'Réponse immédiate visible sans scroller (TL;DR)', status: 'warning' },
              { text: 'Appel à l’action (CTA) principal visible', status: 'valid' },
            ],
          },
          {
            title: '4. Couverture Sémantique & Entités',
            scoreText: '14/15',
            aiReasoning:
              "Densité équilibrée du terme principal (1,8%) et champ lexical riche couvrant les notions d'appellations, de packaging vinicole et d'image de marque.",
            items: [
              { text: 'Densité équilibrée du mot-clé (≤ 2,5%)', status: 'valid' },
              { text: 'Richesse des entités sémantiques connexes', status: 'valid' },
            ],
          },
          {
            title: '5. Signaux E-E-A-T',
            scoreText: '4/10',
            aiReasoning:
              "Le contenu ne mentionne pas explicitement les signatures des experts de l'agence ni de date de révision éditoriale récente.",
            items: [
              { text: 'Expertise et auteur identifié avec biographie', status: 'error' },
              { text: 'Date de publication ou mise à jour visible', status: 'error' },
            ],
          },
          {
            title: '6. Lisibilité',
            scoreText: '5/5',
            aiReasoning:
              "Paragraphes aérés de moins de 45 mots, syntaxe fluide et vocabulaire accessible aux décideurs marketing.",
            items: [
              { text: 'Structure aérée (< 50 mots par paragraphe)', status: 'valid' },
              { text: 'Phrases claires et score Flesch > 65', status: 'valid' },
            ],
          },
        ],
      },
      geo: {
        score: 80,
        categories: [
          { name: 'Autorisations IA', score: 100 },
          { name: 'Standard /llms.txt', score: 0 },
          { name: 'Citabilité (Passages)', score: 65 },
          { name: 'Preuves & Sources', score: 50 },
          { name: 'Entité Schema.org', score: 100 },
          { name: 'Cohérence NAP', score: 100 },
        ],
        priorities: [
          { type: 'alert', text: 'Le fichier /llms.txt est manquant à la racine du site.' },
          { type: 'optimization', text: 'Ajoutez des listes à puces factuelles sous les H2 pour faciliter l’extraction.' },
        ],
        accordions: [
          {
            title: '1. Accessibilité & Standards',
            scoreText: '25/50',
            aiReasoning:
              "Les directives robots.txt sont bien configurées pour laisser passer les crawlers IA. Cependant, l'absence d'un fichier /llms.txt prive les agents IA d'un résumé structuré des offres de l'agence.",
            items: [
              { text: 'Autorisation GPTBot, ClaudeBot, PerplexityBot', status: 'valid' },
              { text: 'Fichier /llms.txt présent et valide', status: 'error' },
            ],
          },
          {
            title: '2. Citabilité & Passage Ranking',
            scoreText: '13/20',
            aiReasoning:
              "Les sections H2/H3 sont auto-porteuses (elles ont du sens hors contexte). Néanmoins, le texte est très narratif : l'ajout d'une synthèse factuelle améliorerait la probabilité de citation directe par Perplexity et Google AI Overviews.",
            items: [
              { text: 'Sections autonomes (Passage Ranking)', status: 'valid' },
              { text: 'Listes à puces et tableaux directement extractibles', status: 'warning' },
            ],
          },
          {
            title: '3. Autorité, Preuves & Sources',
            scoreText: '15/30',
            aiReasoning:
              "Données chiffrées présentes mais manquant de références explicites vers des sources d'autorité externes vérifiables.",
            items: [
              { text: 'Présence de données factuelles chiffrées', status: 'valid' },
              { text: 'Liens externes vers des sources d’autorité', status: 'warning' },
              { text: 'Microdonnées Schema.org (Organization) complètes', status: 'valid' },
            ],
          },
        ],
      },
    },
  },
}

export function getInspectionDataForPage(pageId: string): InspectionData {
  if (bigHappyAuditData.inspections[pageId]) {
    return bigHappyAuditData.inspections[pageId]
  }

  // Find subpage or create dynamic inspection data
  const sub = bigHappyAuditData.subpages.find((p) => p.id === pageId) || {
    id: pageId,
    title: pageId.charAt(0).toUpperCase() + pageId.slice(1),
    url: `https://bighappy.fr/${pageId}`,
    path: `/${pageId}`,
    httpStatus: 200,
    responseTime: '0.52 s',
    wordCount: 420,
    isPillar: false,
    indexable: true,
    targetKeyword: 'marketing digital',
  }

  const isLowWords = (sub.wordCount || 0) < 500

  return {
    pageId: sub.id,
    title: sub.title,
    url: sub.url,
    httpStatus: 200,
    indexable: true,
    follow: true,
    responseTime: sub.responseTime || '0.52 s',
    tech: {
      score: isLowWords ? 76 : 94,
      categories: [
        { name: 'Meta information', score: 90 },
        { name: 'Page quality', score: isLowWords ? 45 : 95 },
        { name: 'Page structure', score: 92 },
        { name: 'Links', score: 80 },
        { name: 'Server', score: 85 },
        { name: 'External factors', score: 30 },
      ],
      priorities: [
        ...(isLowWords
          ? [
              {
                type: 'alert' as const,
                text: `Contenu pauvre détecté (${sub.wordCount} mots). Google pénalise les pages avec moins de 500 mots.`,
              },
            ]
          : []),
        { type: 'optimization' as const, text: `Améliorez le temps de réponse TTFB (${sub.responseTime || '0.52 s'}).` },
      ],
      accordions: [
        {
          title: '1. Meta data',
          scoreText: '90%',
          items: [
            { text: `Balise title présente : "${sub.title}"`, status: 'valid' },
            { text: 'Méta description unique et conforme', status: 'valid' },
            { text: 'Balises Open Graph complètes', status: 'valid' },
          ],
        },
        {
          title: '2. Page structure & quality',
          scoreText: isLowWords ? '65%' : '92%',
          items: [
            { text: 'Balise H1 unique détectée', status: 'valid' },
            { text: 'Hiérarchie des sous-titres H2-H6 respectée', status: 'valid' },
            {
              text: isLowWords
                ? `Volume de texte insuffisant : ${sub.wordCount} mots (< 500 mots)`
                : `Volume de texte satisfaisant : ${sub.wordCount} mots`,
              status: isLowWords ? 'error' : 'valid',
            },
          ],
        },
        {
          title: '3. Link structure',
          scoreText: '80%',
          items: [
            { text: 'Maillage interne entrant actif', status: 'valid' },
            { text: 'Absence d’erreurs 404', status: 'valid' },
          ],
        },
        {
          title: '4. Server configuration',
          scoreText: '85%',
          items: [
            { text: 'Protocole HTTPS et SSL valides', status: 'valid' },
            { text: `Temps de réponse de la page : ${sub.responseTime || '0.52 s'}`, status: 'warning' },
          ],
        },
      ],
    },
    editorial: {
      score: 72,
      targetKeyword: sub.targetKeyword || 'marketing digital',
      isForcedTarget: false,
      categories: [
        { name: 'Intent Match', score: 85 },
        { name: 'Cannibalisation', score: 100 },
        { name: 'Zones Chaudes', score: 70 },
        { name: 'Contenu Primaire', score: 65 },
        { name: 'Couverture Sémantique', score: 80 },
        { name: 'E-E-A-T', score: 50 },
        { name: 'Lisibilité', score: 90 },
      ],
      priorities: [
        { type: 'alert' as const, text: 'Enrichir les données d’autorité et mentions d’auteurs.' },
        { type: 'optimization' as const, text: 'Structurer le premier écran pour fournir une réponse directe.' },
      ],
      accordions: [
        {
          title: '1. Intent Match & Cannibalisation',
          scoreText: '18/20',
          aiReasoning: `Analyse sémantique pour la requête "${sub.targetKeyword || 'marketing digital'}". L’intention de recherche est bien comprise.`,
          items: [
            { text: 'Intention de recherche comprise', status: 'valid' },
            { text: 'Absence de cannibalisation détectée', status: 'valid' },
          ],
        },
      ],
    },
    geo: {
      score: 65,
      categories: [
        { name: 'Autorisations IA', score: 100 },
        { name: 'Standard /llms.txt', score: 0 },
        { name: 'Citabilité (Passages)', score: 60 },
        { name: 'Preuves & Sources', score: 40 },
        { name: 'Entité Schema.org', score: 80 },
        { name: 'Cohérence NAP', score: 90 },
      ],
      priorities: [
        { type: 'alert' as const, text: 'Fichier /llms.txt manquant à la racine.' },
        { type: 'optimization' as const, text: 'Ajouter des listes à puces factuelles pour faciliter l’extraction IA.' },
      ],
      accordions: [
        {
          title: '1. Accessibilité & Standards IA',
          scoreText: '25/50',
          aiReasoning: 'Le site autorise les robots IA dans le robots.txt, mais l’absence de /llms.txt limite la transmission des données de synthèse.',
          items: [
            { text: 'Autorisations GPTBot, ClaudeBot, PerplexityBot', status: 'valid' },
            { text: 'Fichier /llms.txt présent et valide', status: 'error' },
          ],
        },
      ],
    },
  }
}

export function getProjectAudit(projectId: string): ProjectAuditData {
  if (projectId === 'big-happy' || projectId === 'bighappy' || projectId === 'bighappy.fr') {
    return bigHappyAuditData
  }
  // Fallback dynamic generator for other project IDs
  return {
    ...bigHappyAuditData,
    projectId,
    projectName: projectId.charAt(0).toUpperCase() + projectId.slice(1).replace(/-/g, ' '),
    domain: `${projectId}.fr`,
  }
}

