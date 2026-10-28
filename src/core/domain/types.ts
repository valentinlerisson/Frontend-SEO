export type AuditStatus =
  | 'IDLE'
  | 'QUEUED'
  | 'CRAWLING_TECH'
  | 'AWAITING_AI_SELECTION'
  | 'ANALYZING_AI'
  | 'COMPLETED'
  | 'FAILED';

export type PillarType = 'TECH' | 'EDITORIAL' | 'GEO';

export type IssueSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

/** Rôle d'une page : adapte les attentes éditoriales (voir scoring/page-role.ts) */
export type PageRole = 'home' | 'brand' | 'contact' | 'offer' | 'case' | 'article' | 'hub' | 'utility';

/** Indices lus dans le HTML pour déterminer le rôle d'une page */
export interface RoleSignals {
  ogType?: string;
  articleElements: number;
  hasPublishedMeta: boolean;
  /** La page est liée depuis le contenu d'une liste : de réalisations (case) ou d'articles (article) */
  hubChild?: 'case' | 'article';
}

export interface Issue {
  id: string;
  pillar: PillarType;
  severity: IssueSeverity;
  code: string;
  title: string;
  description: string;
  recommendation: string;
  stepsToResolve: string[];
  affectedUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface CoreWebVitals {
  /** secondes (ex. 2.1) ; absent : non mesuré */
  lcp?: number;
  /** millisecondes (ex. 180) ; absent : non mesuré (données de terrain insuffisantes) */
  inp?: number;
  /** score (ex. 0.05) ; absent : non mesuré */
  cls?: number;
  /** Origine de chaque mesure : utilisateurs réels (field) ou laboratoire (lab) */
  source?: Partial<Record<'lcp' | 'inp' | 'cls', 'field' | 'lab'>>;
}

/** Coordonnées lues sur la page entière (pied de page compris) et dans son JSON-LD */
export interface NapSignals {
  /** Téléphones français normalisés (10 chiffres) */
  phones: string[];
  addresses: { postalCode: string; city: string; text: string }[];
  schema?: { phone?: string; postalCode?: string; city?: string; name?: string };
}

export interface RawPageData {
  url: string;
  path: string;
  httpStatus: number;
  depth: number;
  isPillar: boolean;
  isIndexable: boolean;
  /** undefined : non mesuré par le crawl (le moteur n'attribue alors aucun point et n'alerte pas) */
  isBlockedByRobotsTxt?: boolean;
  /** undefined : non mesuré par le crawl */
  inSitemap?: boolean;
  canonicalUrl?: string;
  /** Contenu brut de la balise meta robots (ex: "noindex, follow") */
  robotsMeta?: string;
  /** URL finale après redirection(s), si différente de l'URL demandée */
  finalUrl?: string;
  title?: string;
  metaDescription?: string;
  h1?: string;
  h1Count: number;
  headings: { level: number; text: string }[];
  headingHierarchyValid: boolean;
  headingHierarchyErrors: string[];
  wordCount: number;
  inlinksCount: number;
  outlinksCount: number;
  /** Liens sortants de la page (<a href>), dans l'ordre du document */
  links: { href: string; text: string; internal: boolean; nofollow: boolean }[];
  /** Chemins des pages explorées qui pointent vers cette page */
  inlinkSources?: string[];
  images: { src: string; alt?: string; hasAlt: boolean }[];
  imagesTotal: number;
  imagesWithAlt: number;
  hasSsl: boolean;
  /** Nombre de redirections suivies jusqu'à la réponse finale (compté saut par saut) */
  redirectHops: number;
  /** Codes HTTP de chaque redirection traversée (ex. [301, 302]) */
  redirectStatuses?: number[];
  /** links : atteinte en suivant les liens depuis l'accueil ; sitemap : seulement listée dans le sitemap */
  discoveredVia?: 'links' | 'sitemap';
  /**
   * true : le crawl a suivi tous les liens trouvés (graphe complet), les liens entrants et les pages orphelines
   * sont mesurés ; false : crawl tronqué (limite de pages), ces mesures sont partielles
   */
  linkGraphComplete?: boolean;
  coreWebVitals?: CoreWebVitals;
  /** Durée réelle de la requête HTTP (fetch + lecture du corps), en millisecondes */
  responseTimeMs?: number;
  /** Échec réseau (timeout, DNS, connexion refusée) : aucune réponse HTTP n'a été reçue */
  fetchError?: string;
  hasSchemaOrg: boolean;
  schemaTypes: string[];
  first100Words: string;
  hasAuthor: boolean;
  hasPublicationDate: boolean;
  externalAuthoritativeLinksCount: number;
  /** Coordonnées détectées (téléphone, adresse), pour la cohérence NAP du site */
  nap?: NapSignals;
  roleSignals?: RoleSignals;
  /** Rôle corrigé à la main par l'utilisateur : prioritaire sur la détection */
  roleOverride?: PageRole;
  bodyText: string;
  /** Diagnostics éditoriaux objectifs, calculés au crawl sur le contenu principal (hors nav, header, footer) */
  editorialSignals?: EditorialSignals;
}

export interface EditorialSignals {
  freshness: {
    currentYear: number;
    /** Années révolues (au moins 2 ans) trouvées dans le Title, le H1 ou le texte, avec l'extrait environnant */
    outdatedMentions: { year: number; excerpt: string; zone: 'TITLE' | 'H1' | 'CONTENT' }[];
    /** Date de dernière mise à jour (ISO) si la page en déclare une */
    lastUpdated?: string;
  };
  readability: {
    paragraphCount: number;
    avgParagraphWords: number;
    /** Paragraphes de plus de 100 mots */
    longParagraphs: number;
    sentenceCount: number;
    /** Part des phrases de plus de 25 mots (0 - 1) */
    longSentenceRatio: number;
    listCount: number;
    tableCount: number;
  };
  inContentLinks: {
    total: number;
    internal: number;
    external: number;
    genericAnchors: number;
    /** 60 premiers liens du contenu principal */
    links: { href: string; text: string; internal: boolean; generic: boolean }[];
  };
  /** Contenu masqué tant que l'utilisateur n'a pas accepté des cookies tiers */
  consentGated: boolean;
  /** Chiffres-clés cités (ex. « 26 établissements »), pour détecter des incohérences entre pages */
  facts: { counts: { label: string; value: number }[] };
}

/** Qualité éditoriale jugée par le LLM (expérience vécue, gain d'information, réassurance) */
export interface ContentQualityInsights {
  firstHandExperience: {
    detected: boolean;
    confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    /** Courts extraits de la page prouvant un vécu */
    evidence: string[];
    advice: string;
  };
  informationGain: {
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    hasOriginalData: boolean;
    hasConcreteCases: boolean;
    /** Passages génériques qui n'apportent rien de nouveau */
    genericFluff: string[];
    mentionsLimits: boolean;
    advice: string;
  };
}

export interface TechScoreResult {
  score: number; // 0 - 100
  /** Points de critères non mesurés par le crawl, exclus du dénominateur du score */
  unmeasuredPoints?: number;
  breakdown: {
    coreWebVitals: number; // 0 - 25
    architecture: number; // 0 - 20
    crawlability: number; // 0 - 15
    securityAndHttp: number; // 0 - 15
    htmlStructure: number; // 0 - 15
    metadataAndMedia: number; // 0 - 10
  };
  issues: Issue[];
}

export interface EditorialEvaluation {
  intentMatch: {
    detectedIntent: 'INFORMATIONAL' | 'TRANSACTIONAL' | 'COMMERCIAL' | 'NAVIGATIONAL';
    score: number; // 0 - 20
    critique: string;
    actionableAdvice: string;
  };
  cannibalizationRisk: {
    score: number; // 0 - 20
    /** SERP : mesurée sur les résultats Google de la requête cible (prime sur l'estimation de l'IA) */
    source?: 'AI' | 'SERP';
    competingConcepts: string[];
    /** URL de la page pilier avec laquelle le recoupement est identifié (absente : aucun conflit exploitable) */
    competingUrl?: string;
    /** Requête que les deux pages semblent viser */
    sharedQuery?: string;
    /** Mesuré : la page auditée est absente des résultats, mais une autre page du site y sort */
    otherPageRanks?: boolean;
    critique: string;
    actionableAdvice: string;
  };
  hotZonesOptimization: {
    score: number; // 0 - 15
    titleKeywordPresent: boolean;
    h1KeywordPresent: boolean;
    first100WordsKeywordPresent: boolean;
    /** Requête (ou variante) présente dans les sous-titres H2 et H3 */
    subheadingsKeywordPresent?: boolean;
    actionableAdvice: string;
    /** MEASURED : calculé par le code sur la requête cible ; AI : estimation (ancienne analyse ou heuristique) */
    source?: 'MEASURED' | 'AI';
    /** Points par zone et mots de la requête absents (mesure du code) */
    zones?: {
      title: { points: number; max: number; missing: string[] };
      first100Words: { points: number; max: number; missing: string[] };
      subheadings: { points: number; max: number; missing: string[] };
    };
  };
  primaryContentTldr: {
    score: number; // 0 - 15
    hasDirectAnswer: boolean;
    critique: string;
    actionableAdvice: string;
  };
  /** Points réellement mesurés (critères sans objet ou non mesurables exclus) sur le total de 100 */
  coverage?: { measured: number; total: number };
  /** Citabilité par les moteurs de réponse IA, jugée dans la même requête que l'analyse éditoriale (GEO, 40 pts) */
  citability?: {
    score: number; // 0 - 40
    extractableBlocksCount: number;
    hasDirectDefinitions: boolean;
    hasVerifiableFacts: boolean;
    quotablePassages: string[];
    critique: string;
    actionableAdvice: string;
    /** Grille vérifiée par le code (passages, définition, fait chiffré, sous-titres en questions) */
    checks?: { passages: number; definition: boolean; fact: boolean; questionHeadings: number };
  };
  semanticDepth: {
    score: number; // 0 - 20
    recognizedEntities: string[];
    missingKeyEntities: string[];
    actionableAdvice: string;
  };
  eeatSignals: {
    score: number; // 0 - 10
    hasAuthor: boolean;
    hasPublicationDate: boolean;
    hasSources: boolean;
    actionableAdvice: string;
  };
  /** Diagnostic de lecture, exclu du score sur 100 */
  readability: {
    score: number; // 0 - 5
    critique: string;
    actionableAdvice: string;
  };
  quickWins: string[];
  /** Module éditorial V1 : requête cible, données de recherche, snippet, content gaps, ancrage local */
  search?: SearchInsights;
  /** Expérience vécue, gain d'information et réassurance (analyse LLM) */
  quality?: ContentQualityInsights;
  /** Rôle jugé par l'IA (corrige la détection automatique si le contenu montre clairement autre chose) */
  role?: PageRole;
  roleReason?: string;
}

export type SearchIntent = 'INFORMATIONAL' | 'TRANSACTIONAL' | 'COMMERCIAL' | 'NAVIGATIONAL';

export interface SearchInsights {
  targetQuery: {
    query: string;
    intent: SearchIntent;
    /** AUTO : déduite par l'IA ; MANUAL : saisie par l'utilisateur (prioritaire à chaque ré-analyse) */
    source: 'AUTO' | 'MANUAL';
    /**
     * MANUAL : saisie ; CONFIRMED : déduite mais retrouvée dans Google (suggestions ou résultats mesurés) ;
     * INFERRED : déduite de la page sans confirmation, donc biaisée en faveur de la page (calculé par le moteur)
     */
    confidence?: 'MANUAL' | 'CONFIRMED' | 'INFERRED';
    /** La requête elle-même (ou quasi identique) est proposée par Google Autocomplete : c'est une vraie recherche */
    suggestedByGoogle?: boolean;
    /** Requête déduite lors d'une analyse précédente et conservée (contenu inchangé), au lieu d'être redéduite */
    kept?: boolean;
  };
  /** Vraies requêtes d'internautes ; l'IA n'invente pas cette liste */
  autocomplete: {
    suggestions: string[];
    source: 'GOOGLE_AUTOCOMPLETE' | 'UNAVAILABLE';
  };
  snippet: {
    /** 0 - 100 : attractivité du Title et de la méta description pour le CTR */
    score: number;
    titleCritique: string;
    metaCritique: string;
    suggestedTitle: string;
    suggestedMeta: string;
    /** Mots propres des suggestions absents du contenu de la page : à vérifier avant publication */
    unverifiedTerms?: string[];
  };
  contentGaps: {
    missingSections: string[];
    missingEntities: string[];
    /** AI_ESTIMATE : estimation du LLM, à remplacer par SERP (Top 10 réel) via SerpProviderPort */
    source: 'AI_ESTIMATE' | 'SERP';
  };
  local: {
    isLocalBusiness: boolean;
    city: string | null;
    hasLocalSignals: boolean;
    advice: string;
  };
  /** Indices tirés des suggestions Google Autocomplete (vraies requêtes) sur l'intention de recherche */
  intentEvidence?: {
    total: number;
    dominant: SearchIntent | null;
    counts: Partial<Record<SearchIntent, number>>;
    examples: string[];
  };
  analyzedBy: { engine: 'LLM' | 'HEURISTIC'; model?: string; provider?: string };
}

/** Données transmises au LLM pour une page pilier (Title, meta, Hn et ~1000 premiers mots) */
export interface EditorialAnalysisInput {
  url: string;
  domain: string;
  role: PageRole;
  title?: string;
  metaDescription?: string;
  h1?: string;
  headings: { level: number; text: string }[];
  excerpt: string;
  wordCount: number;
  signals: {
    hasAuthor: boolean;
    hasPublicationDate: boolean;
    externalAuthoritativeLinksCount: number;
    schemaTypes: string[];
  };
  /** Requête saisie par l'utilisateur ; absente : l'IA la déduit */
  manualQuery?: string;
  /** Suggestions Google Autocomplete (vraies requêtes) */
  suggestions: string[];
  /** Autres pages piliers du site, pour juger la cannibalisation */
  siblingPages: { url: string; title?: string; h1?: string }[];
  /** Requête déduite conservée d'une analyse précédente : l'IA la garde comme cible, sans la redéduire */
  fixedQuery?: string;
  /** Identifiant unique sans effet sur l'analyse : rend chaque appel différent pour contourner tout cache (variabilité) */
  nonce?: string;
}

export interface GeoEvaluation {
  /** Rôle corrigé par l'IA (analyse éditoriale) : décide si la citabilité s'applique */
  role?: PageRole;
  aiBotsAccessibility: {
    score: number; // 0 - 25
    gptBotAllowed: boolean;
    claudeBotAllowed: boolean;
    perplexityBotAllowed: boolean;
    critique: string;
    actionableAdvice: string;
  };
  llmsTxtStandard: {
    score: number; // 0 - 5
    exists: boolean;
    isValidFormat: boolean;
    critique: string;
    actionableAdvice: string;
  };
  aiCitability: {
    score: number; // 0 - 40
    extractableBlocksCount: number;
    hasDirectDefinitions: boolean;
    critique: string;
    actionableAdvice: string;
    /** AI : jugée par l'IA sur le contenu (pages piliers) ; HEURISTIC : estimation par le nombre de sous-titres */
    source?: 'AI' | 'HEURISTIC';
    /** Contient des faits vérifiables (chiffres, noms, dates) que l'on peut citer */
    hasVerifiableFacts?: boolean;
    /** Passages copiés de la page, citables tels quels par un moteur de réponse */
    quotablePassages?: string[];
    /** false : page de contact ou utilitaire, la citabilité est sans objet et ses 40 pts sortent du dénominateur */
    applicable?: boolean;
    /** Grille vérifiée par le code (passages, définition, fait chiffré, sous-titres en questions) */
    checks?: { passages: number; definition: boolean; fact: boolean; questionHeadings: number };
  };
  authoritySources: {
    score: number; // 0 - 5
    externalAuthoritativeLinksCount: number;
    critique: string;
    actionableAdvice: string;
  };
  schemaOrgLdJson: {
    /** Types lus après exécution du JavaScript de la page (absents du HTML initial) */
    renderedWithJs?: boolean;
    score: number; // 0 - 20
    hasValidSchema: boolean;
    schemaTypes: string[];
    critique: string;
    actionableAdvice: string;
  };
  napConsistency: {
    score: number; // 0 - 15
    /** false : aucune coordonnée sur le site, critère exclu du score */
    measured?: boolean;
    /** false : pas de JSON-LD de coordonnées sur la page, les 5 pts de cohérence sortent du dénominateur */
    consistencyMeasured?: boolean;
    detectedName: string | null;
    detectedAddress: string | null;
    detectedPhone: string | null;
    isConsistent: boolean;
    actionableAdvice: string;
    /** Manque de coordonnées à signaler sur cette page (page d'accueil seulement : le critère est jugé sur le site) */
    reportMissing?: boolean;
  };
  llmReadinessSummary: string;
  quickWins: string[];
}

/** Page pilier résumée pour la relecture de cohérence du site */
export interface SiteCoherencePage {
  url: string;
  role: PageRole;
  title?: string;
  h1?: string;
  metaDescription?: string;
  targetQuery?: string;
  intent?: SearchIntent;
  excerpt: string;
}

export interface SiteCoherenceInput {
  domain: string;
  pages: SiteCoherencePage[];
}

/** Incohérence relevée entre plusieurs pages piliers */
export interface SiteCoherenceFinding {
  type: 'INTENT_OVERLAP' | 'MISSING_PAGE_TYPE' | 'ROLE_MISMATCH' | 'OTHER';
  /** URL exactes de la liste ; vide si le constat concerne le site entier */
  pages: string[];
  title: string;
  explanation: string;
  recommendation: string;
}

/** Résultat organique d'une recherche Google */
export interface SerpResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  /** Liens annexes affichés sous le résultat (pour le domaine audité seulement) */
  sitelinks?: { title: string; url: string }[];
  /** URL déduite de l'adresse affichée par Google (redirection non suivie) : à prendre avec réserve */
  urlApproximate?: boolean;
}

/** Page concurrente du Top lue pour comparer sa structure à celle de la page analysée */
export interface SerpCompetitorPage {
  position: number;
  url: string;
  domain: string;
  title?: string;
  wordCount: number;
  /** Titres H2 et H3 de la page */
  headings: string[];
}

/** Analyse de la SERP de la requête cible d'une page pilier (résultat mesuré, hors score) */
/** Relevé de position conservé dans le temps (une entrée par analyse SERP terminée) */
export interface SerpHistoryEntry {
  date: string;
  query: string;
  /** Fournisseur du relevé (browser, serper) : deux fournisseurs ne mesurent pas dans les mêmes conditions */
  provider?: string;
  pagePosition: number | null;
  sitelinkOf: number | null;
  ownPosition: number | null;
}

/** Éléments de la page de résultats relevés pour information (hors score) */
export interface SerpFeatures {
  /** Bloc de fiches d'établissements (pack local) présent */
  localPack: boolean;
  /** Questions du bloc « Autres questions posées » */
  peopleAlsoAsk: string[];
}

export interface SerpAnalysis {
  status: 'RUNNING' | 'DONE' | 'BLOCKED' | 'ERROR';
  /** Pack local et questions : relevés sur la première page de résultats */
  features?: SerpFeatures;
  /** Nombre de résultats organiques lus (profondeur du relevé) */
  depth?: number;
  /** Fournisseur du relevé : browser (Chrome local) ou serper (API) ; absent = browser */
  provider?: string;
  /** Re-test fait car la position s'écartait de plus de 3 rangs du relevé précédent : rangs de la 1re mesure et d'avant */
  retest?: { firstRank: number | null; previousRank: number | null };
  message?: string;
  query: string;
  fetchedAt?: string;
  results: SerpResult[];
  /** Meilleure position du domaine ; null : absent des résultats récupérés */
  ownPosition: number | null;
  /** Position de cette page précise, si elle sort seule dans les résultats */
  pagePosition: number | null;
  /** Position du résultat sous lequel cette page apparaît en lien annexe (sitelink) */
  pageSitelinkOf: number | null;
  /** Pages du site présentes dans les résultats (deux ou plus : cannibalisation avérée) */
  ownUrls: { position: number; url: string }[];
  competitors: SerpCompetitorPage[];
  gaps: { missingSections: string[]; competitorAvgWords: number | null };
  intent: { dominant: SearchIntent | null; counts: Partial<Record<SearchIntent, number>> };
  snippetBenchmark: { avgTitleLength: number | null; avgSnippetLength: number | null };
}
