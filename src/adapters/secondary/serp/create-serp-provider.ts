import type { SerpProviderPort } from '@/core/ports/serp-provider';
import { GoogleBrowserSerp } from './google-browser-serp';
import { SerperApiSerp } from './serper-api-serp';

/**
 * Fournisseur de résultats Google choisi par SERP_PROVIDER :
 * - `browser` (défaut) : Chrome local, gratuit, contraire aux conditions d'utilisation de Google, usage personnel ;
 * - `serper` : API Serper.dev (SERPER_API_KEY), payante, à utiliser si l'application est fournie à des tiers.
 */
export function createSerpProvider(): SerpProviderPort {
  const choice = (process.env.SERP_PROVIDER ?? 'browser').trim().toLowerCase();
  if (choice === 'serper') {
    const key = process.env.SERPER_API_KEY;
    if (!key) throw new Error('SERP_PROVIDER=serper mais SERPER_API_KEY est absente');
    return new SerperApiSerp(key);
  }
  return new GoogleBrowserSerp();
}
