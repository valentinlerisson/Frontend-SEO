import type { KeywordVolumePort } from '@/core/ports/keyword-volume';
import { GoogleAdsKeywords } from './google-ads-keywords';
import { MockKeywordVolumes } from './mock-keyword-volumes';

/**
 * Source des volumes choisie par KEYWORD_VOLUME_PROVIDER : `google-ads`, `mock` (volumes inventés, pour tester
 * l'écran) ou `none`. Non renseignée : Google Ads s'il est configuré, sinon aucune source.
 */
export function keywordVolumeProvider(env: NodeJS.ProcessEnv = process.env): KeywordVolumePort | null {
  const choice = env.KEYWORD_VOLUME_PROVIDER?.trim().toLowerCase();
  if (choice === 'none') return null;
  if (choice === 'mock') return new MockKeywordVolumes();
  return GoogleAdsKeywords.fromEnv(env);
}
