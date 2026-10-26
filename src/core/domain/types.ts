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
  lcp: number; // in seconds (e.g. 2.1)
  inp: number; // in milliseconds (e.g. 180)
  cls: number; // score (e.g. 0.05)
}

export interface RawPageData {
  url: string;
  path: string;
  httpStatus: number;
  depth: number;
  isPillar: boolean;
  isIndexable: boolean;
  isBlockedByRobotsTxt: boolean;
  inSitemap: boolean;
  canonicalUrl?: string;
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
  images: { src: string; alt?: string; hasAlt: boolean }[];
  imagesTotal: number;
  imagesWithAlt: number;
  hasSsl: boolean;
  redirectHops: number;
  coreWebVitals?: CoreWebVitals;
  hasSchemaOrg: boolean;
  schemaTypes: string[];
  first100Words: string;
  hasAuthor: boolean;
  hasPublicationDate: boolean;
  externalAuthoritativeLinksCount: number;
  bodyText: string;
}

export interface TechScoreResult {
  score: number; // 0 - 100
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
    competingConcepts: string[];
    critique: string;
    actionableAdvice: string;
  };
  hotZonesOptimization: {
    score: number; // 0 - 15
    titleKeywordPresent: boolean;
    h1KeywordPresent: boolean;
    first100WordsKeywordPresent: boolean;
    actionableAdvice: string;
  };
  primaryContentTldr: {
    score: number; // 0 - 15
    hasDirectAnswer: boolean;
    critique: string;
    actionableAdvice: string;
  };
  semanticDepth: {
    score: number; // 0 - 15
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
  readability: {
    score: number; // 0 - 5
    critique: string;
    actionableAdvice: string;
  };
  quickWins: string[];
}

export interface GeoEvaluation {
  aiBotsAccessibility: {
    score: number; // 0 - 25
    gptBotAllowed: boolean;
    claudeBotAllowed: boolean;
    perplexityBotAllowed: boolean;
    critique: string;
    actionableAdvice: string;
  };
  llmsTxtStandard: {
    score: number; // 0 - 25
    exists: boolean;
    isValidFormat: boolean;
    critique: string;
    actionableAdvice: string;
  };
  aiCitability: {
    score: number; // 0 - 20
    extractableBlocksCount: number;
    hasDirectDefinitions: boolean;
    critique: string;
    actionableAdvice: string;
  };
  authoritySources: {
    score: number; // 0 - 10
    externalAuthoritativeLinksCount: number;
    critique: string;
    actionableAdvice: string;
  };
  schemaOrgLdJson: {
    score: number; // 0 - 10
    hasValidSchema: boolean;
    schemaTypes: string[];
    critique: string;
    actionableAdvice: string;
  };
  napConsistency: {
    score: number; // 0 - 10
    detectedName: string | null;
    detectedAddress: string | null;
    detectedPhone: string | null;
    isConsistent: boolean;
    actionableAdvice: string;
  };
  llmReadinessSummary: string;
  quickWins: string[];
}
