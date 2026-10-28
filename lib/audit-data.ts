import type { PageRole, SearchInsights, SerpAnalysis, SerpHistoryEntry } from '@/core/domain/types'

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
  cannibalizationStatus: 'none' | 'partial' | 'conflict'
  /** Chemin de la page pilier concurrente */
  cannibalizationTarget?: string
  /** Requête commune estimée */
  cannibalizationQuery?: string
  geoScore: number // out of 100
  aiAccessibility: boolean // OUI / NON
  citability: 'Elevée' | 'Moyenne' | 'Faible'
  schemaOrgPresent: boolean // Présent / Manquant
  techScore: number
  httpStatus: number
  responseTime: string
  indexable: boolean
  follow: boolean
  role: PageRole
  roleLabel: string
  /** Origine du rôle : détection automatique, avis de l'IA ou correction manuelle */
  roleSource: 'manual' | 'ai' | 'auto'
  /** Raison donnée par l'IA quand elle corrige le rôle */
  roleReason?: string
  /** Analyse de la SERP de la requête cible (positionnement mesuré), si elle a été lancée */
  serp?: SerpAnalysis
  /** Relevés de position précédents (conservés d'un audit à l'autre) */
  serpHistory?: SerpHistoryEntry[]
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
  /** Rôle de la page (accueil, marque, contact, offre, article) */
  role: PageRole
  roleLabel: string
  roleSource: 'manual' | 'ai' | 'auto'
  roleReason?: string
  /** Score technique de la page, sur 100 */
  techScore: number
  /** Analyse de la SERP de la requête de la page, si elle a été lancée (piliers ou non) */
  serp?: SerpAnalysis
  /** Relevés de position précédents (conservés d'un audit à l'autre) */
  serpHistory?: SerpHistoryEntry[]
}

export type GlobalIssueCategory = 'all' | 'tech' | 'structure' | 'content'
export type IssueSeverity = 'critical' | 'warning' | 'passed'

/** Données brutes d'une page, utilisées pour contextualiser les anomalies et la fiche d'export */
export type PageDetails = {
  httpStatus: number
  responseTime: string
  /** URL finale si la page redirige */
  redirectUrl?: string
  title?: string
  metaDescription?: string
  h1?: string
  wordCount: number
  depthLevel: number
  inlinks: number
  /** Directive meta robots détectée (ex: "noindex, follow") */
  robots?: string
  /** URL canonical déclarée */
  canonical?: string
  /** Fichiers des images sans attribut alt */
  imagesWithoutAlt?: string[]
  /** Chemins des pages explorées qui pointent vers cette page */
  inlinkSources?: string[]
}

/** Balisage Schema.org suggéré pour les signaux E-E-A-T */
export type SchemaSnippet = {
  type: string
  /** Objet JSON-LD formaté, sans balise <script> */
  json: string
  /** Champs « [À COMPLÉTER] » restant à renseigner */
  placeholders: string[]
  /** Un balisage de ce type existe déjà sur la page */
  alreadyPresent: boolean
  /** true quand l'anomalie E-E-A-T est levée : le bloc est alors mis en avant */
  recommended: boolean
}

/** Élément détaillé (image, lien, page source) rattaché à un indicateur du tiroir d'inspection */
export type InspectionDetail = {
  label: string
  note?: string
  href?: string
  tag?: string
  status?: 'valid' | 'warning' | 'error'
}

export type InspectionItemData = {
  text: string
  /** `info` : constat neutre ou estimation à confirmer (bleu), jamais une erreur */
  status: 'valid' | 'warning' | 'error' | 'info'
  /** Origine du constat : mesuré sur la page, lu dans Google, ou estimé par l'IA */
  source?: 'measured' | 'google' | 'ai'
  /** Liste des éléments comptés par l'indicateur (ex. les 6 images, les 49 liens sortants) */
  details?: InspectionDetail[]
}

export type SearchIntentLabel = 'INFORMATIONAL' | 'COMMERCIAL' | 'TRANSACTIONAL' | 'NAVIGATIONAL'

/**
 * Bloc détaillé de l'onglet SEO éditorial. `group` : critère noté (scored), ce que montre Google (google)
 * ou diagnostic hors score (diagnostic). L'ordre du tableau est fixe : lib/issue-routing.ts y renvoie par indice.
 */
export type EditorialAccordion = {
  title: string
  scoreText: string
  aiReasoning: string
  items: InspectionItemData[]
  group?: 'scored' | 'google' | 'diagnostic'
  /** Points obtenus et en jeu (critères notés) */
  points?: { earned: number; max: number }
  /** Constat en une phrase */
  verdict?: string
  /** Action concrète à mener, si le bloc a un point à traiter */
  action?: string
  /** Bloc sans objet pour cette page : non affiché, l'indice reste réservé */
  hidden?: boolean
}

export type IssuePillar = 'TECH' | 'EDITORIAL' | 'GEO'

/** Impact sur le classement Google ; `geo` : visibilité dans les moteurs de réponse IA */
export type ImpactLevel = 'high' | 'medium' | 'low' | 'geo'

/** Conseil de synthèse tiré des analyses des pages piliers */
export type SynthesisAdvice = {
  headline: string
  points: { label: string; text: string }[]
  /** Précision sur la fiabilité du conseil (ex. analyse heuristique, IA indisponible) */
  note?: string
}

export type GlobalIssue = {
  id: string
  /** Pilier d'origine de l'anomalie (sert au routage vers l'onglet du tiroir d'inspection) */
  pillar: IssuePillar
  /** Code stable de l'anomalie (sert au routage vers l'accordéon du tiroir d'inspection) */
  code: string
  title: string
  category: 'Tech. & Meta' | 'Structure' | 'Content'
  categoryKey: 'tech' | 'structure' | 'content'
  severity: IssueSeverity
  /** Impact sur le classement Google, utilisé pour trier et prioriser */
  impact: ImpactLevel
  impactCount?: number
  impactSummary?: string
  description?: string
  recommendation?: string
  /** Étapes pour corriger l'anomalie (tirées de la première occurrence) */
  steps?: string[]
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
    details: PageDetails
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
  details: PageDetails
  tech: {
    score: number
    /** Points réellement mesurés sur 100 (critères non mesurés ou sans objet exclus) */
    coverage?: { measured: number; total: number }
    categories: { name: string; score: number }[]
    /** `section` : indice de l'accordéon détaillé concerné, pour y renvoyer */
    priorities: { type: 'alert' | 'optimization'; text: string; section?: number; affectsScore?: boolean; maxPoints?: number | null }[]
    accordions: {
      title: string
      scoreText: string
      items: InspectionItemData[]
    }[]
  }
  editorial: {
    score: number
    coverage?: { measured: number; total: number }
    targetKeyword: string
    /** true : requête saisie par l'utilisateur ; false : déduite par l'IA */
    isForcedTarget: boolean
    /** Rôle retenu pour la page et son origine */
    role: PageRole
    roleLabel: string
    roleSource: 'manual' | 'ai' | 'auto'
    roleReason?: string
    /** Moteur ayant produit l'analyse ; HEURISTIC = repli local (clé API absente ou erreur du modèle) */
    engine?: { engine: 'LLM' | 'HEURISTIC'; error?: string }
    /** Données de recherche et livrables prêts à l'emploi (absents en analyse heuristique) */
    search?: SearchInsights
    categories: { name: string; score: number }[]
    /** `section` : indice de l'accordéon détaillé concerné, pour y renvoyer */
    priorities: { type: 'alert' | 'optimization'; text: string; section?: number; affectsScore?: boolean; maxPoints?: number | null }[]
    /** Comparaison de l'intention de la page avec ce que montrent les recherches Google */
    intentSummary?: {
      page: SearchIntentLabel
      google?: SearchIntentLabel
      googleSource?: 'serp' | 'autocomplete'
      verdict: string
      status: 'valid' | 'warning' | 'info'
    }
    /** Confiance dans la requête cible : saisie, confirmée par Google, ou seulement déduite de la page */
    queryConfidence?: 'MANUAL' | 'CONFIRMED' | 'INFERRED'
    /** Requête déduite conservée d'une analyse précédente (contenu inchangé) */
    queryKept?: boolean
    /** Position mesurée dans Google pour la requête cible */
    position?: { badge: string; detail: string; status: 'valid' | 'warning' | 'info'; measuredOn?: string }
    accordions: EditorialAccordion[]
  }
  geo: {
    score: number
    coverage?: { measured: number; total: number }
    categories: { name: string; score: number }[]
    /** `section` : indice de l'accordéon détaillé concerné, pour y renvoyer */
    priorities: { type: 'alert' | 'optimization'; text: string; section?: number; affectsScore?: boolean; maxPoints?: number | null }[]
    accordions: {
      title: string
      scoreText: string
      aiReasoning: string
      items: InspectionItemData[]
      /** Balisage Schema.org à intégrer (accordéon Schema.org & NAP) */
      schemaSnippet?: SchemaSnippet
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
  /** Statut brut de l'audit en base (QUEUED, CRAWLING_TECH, AWAITING_AI_SELECTION, ANALYZING_AI, COMPLETED, FAILED) */
  status: string
  /** true tant que l'audit n'est pas COMPLETED : scores éditorial, GEO et global verrouillés */
  isLocked: boolean
  scores: {
    global: number | null
    tech: number
    editorial: number | null
    geo: number | null
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
  /** Conseil de synthèse (absent tant que les piliers ne sont pas analysés) */
  advice: SynthesisAdvice | null
  subpages: SubpageItem[]
  globalIssues: GlobalIssue[]
  inspections: Record<string, InspectionData>
}
