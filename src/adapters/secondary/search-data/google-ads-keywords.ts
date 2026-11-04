import { KeywordVolumeUnavailableError, type KeywordIdeasResult, type KeywordVolume, type KeywordVolumePort } from '@/core/ports/keyword-volume';

/** Français et France (constantes Google Ads) */
const LANGUAGE_FR = 'languageConstants/1002';
const GEO_FRANCE = 'geoTargetConstants/2250';
const MAX_SEEDS = 20;

interface IdeaMetrics {
  avgMonthlySearches?: string;
  competition?: string;
  monthlySearchVolumes?: { year?: string; month?: string; monthlySearches?: string }[];
}

interface IdeaResult {
  text?: string;
  keywordIdeaMetrics?: IdeaMetrics;
  keywordMetrics?: IdeaMetrics;
  closeVariants?: string[];
}

/**
 * Volumes de recherche par l'API Google Ads (Keyword Planner). API officielle : il faut un jeton développeur, un client
 * OAuth, un jeton de rafraîchissement (scripts/google-ads/auth.mjs) et l'identifiant du compte Google Ads.
 * Sans configuration complète, `fromEnv` renvoie null et l'analyse continue sans volumes.
 */
export class GoogleAdsKeywords implements KeywordVolumePort {
  public readonly id = 'google-ads';
  private accessToken: { value: string; expires: number } | null = null;

  constructor(
    private readonly config: {
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      developerToken: string;
      customerId: string;
      loginCustomerId?: string;
      version: string;
    }
  ) {}

  public static fromEnv(env: NodeJS.ProcessEnv = process.env): GoogleAdsKeywords | null {
    const { GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID } = env;
    if (!GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET || !GOOGLE_ADS_REFRESH_TOKEN || !GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_CUSTOMER_ID) return null;
    return new GoogleAdsKeywords({
      clientId: GOOGLE_ADS_CLIENT_ID,
      clientSecret: GOOGLE_ADS_CLIENT_SECRET,
      refreshToken: GOOGLE_ADS_REFRESH_TOKEN,
      developerToken: GOOGLE_ADS_DEVELOPER_TOKEN,
      customerId: GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, ''),
      loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '') || undefined,
      version: env.GOOGLE_ADS_API_VERSION || 'v26'
    });
  }

  public async ideas(seeds: string[], options: { url?: string; limit?: number } = {}): Promise<KeywordIdeasResult> {
    const keywords = [...new Set(seeds.map((seed) => seed.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_SEEDS);
    if (keywords.length === 0) return { seeds: [], ideas: [] };
    const common = { language: LANGUAGE_FR, geoTargetConstants: [GEO_FRANCE], keywordPlanNetwork: 'GOOGLE_SEARCH' };

    const ideasFor = (seed: object) =>
      this.call<{ results?: IdeaResult[] }>('generateKeywordIdeas', { ...common, pageSize: options.limit ?? 50, ...seed });
    let [historical, ideas] = await Promise.all([
      this.call<{ results?: IdeaResult[] }>('generateKeywordHistoricalMetrics', { ...common, keywords }),
      ideasFor(options.url ? { keywordAndUrlSeed: { keywords, url: options.url } } : { keywordSeed: { keywords } })
    ]);
    // Aucune idée avec l'adresse de la page (fréquent sur un petit site) : nouvel essai avec les seuls mots-clés
    if (options.url && !ideas.results?.length) ideas = await ideasFor({ keywordSeed: { keywords } });

    const seedVolumes = (historical.results ?? []).map((result) => toVolume(result, result.keywordMetrics));
    const known = new Set(seedVolumes.flatMap((volume) => [volume.keyword, ...(volume.closeVariants ?? [])]));
    return {
      seeds: seedVolumes,
      ideas: (ideas.results ?? [])
        .map((result) => toVolume(result, result.keywordIdeaMetrics))
        .filter((volume) => volume.keyword && !known.has(volume.keyword))
        .sort((a, b) => (b.avgMonthlySearches ?? -1) - (a.avgMonthlySearches ?? -1))
    };
  }

  private async call<T>(method: string, body: unknown, attempt = 1): Promise<T> {
    const { version, customerId, developerToken, loginCustomerId } = this.config;
    // Coupure réseau (« fetch failed ») : un nouvel essai après une seconde
    const response = await fetch(`https://googleads.googleapis.com/${version}/customers/${customerId}:${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'developer-token': developerToken,
        ...(loginCustomerId ? { 'login-customer-id': loginCustomerId } : {}),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    }).catch(async (err) => {
      if (attempt >= 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return null;
    });
    if (!response) return this.call<T>(method, body, attempt + 1);
    const data = (await response.json().catch(() => ({}))) as { error?: { message?: string; details?: unknown[] } };
    if (!response.ok) throw new KeywordVolumeUnavailableError(describeError(response.status, data.error));
    return data as T;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expires > Date.now() + 60_000) return this.accessToken.value;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token'
      }),
      signal: AbortSignal.timeout(10_000)
    });
    const data = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !data.access_token) {
      throw new KeywordVolumeUnavailableError(`Connexion Google refusée (${data.error ?? response.status}) : relancer scripts/google-ads/auth.mjs`);
    }
    this.accessToken = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
  }
}

function toVolume(result: IdeaResult, metrics: IdeaMetrics | undefined): KeywordVolume {
  const monthly = (metrics?.monthlySearchVolumes ?? []).map((month) => Number(month.monthlySearches ?? 0));
  const competition = metrics?.competition;
  return {
    keyword: (result.text ?? '').toLowerCase(),
    avgMonthlySearches: metrics?.avgMonthlySearches !== undefined ? Number(metrics.avgMonthlySearches) : null,
    ...(competition === 'LOW' || competition === 'MEDIUM' || competition === 'HIGH' ? { competition } : {}),
    ...(monthly.length ? { monthly } : {}),
    ...(result.closeVariants?.length ? { closeVariants: result.closeVariants.map((variant) => variant.toLowerCase()) } : {})
  };
}

/** Message lisible pour les refus courants (jeton développeur non approuvé, compte non lié) */
function describeError(status: number, error?: { message?: string; details?: unknown[] }): string {
  const raw = JSON.stringify(error?.details ?? error ?? {});
  if (raw.includes('DEVELOPER_TOKEN_NOT_APPROVED') || raw.includes('CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION')) return 'Jeton développeur Google Ads limité aux comptes de test : demander l’accès de base dans le centre API';
  if (raw.includes('DEVELOPER_TOKEN_PROHIBITED')) return 'Jeton développeur refusé pour ce projet Google Cloud';
  if (raw.includes('USER_PERMISSION_DENIED')) return 'Compte Google sans accès à ce compte Google Ads (vérifier GOOGLE_ADS_LOGIN_CUSTOMER_ID)';
  if (raw.includes('CUSTOMER_NOT_ENABLED')) return 'Compte Google Ads non activé (facturation à configurer)';
  return `Google Ads a refusé la demande (HTTP ${status}) : ${error?.message ?? raw.slice(0, 300)}`;
}
