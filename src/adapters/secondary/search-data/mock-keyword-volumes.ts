import type { KeywordIdeasResult, KeywordVolume, KeywordVolumePort } from '@/core/ports/keyword-volume';

/** Paliers de volume proches de ceux affichés par Keyword Planner */
const STEPS = [10, 20, 30, 50, 70, 90, 140, 210, 320, 480, 720, 1000, 1300, 1900, 2400, 3600, 5400, 8100];
const IDEA_SUFFIXES = ['prix', 'avis', 'devis', 'comparatif'];
const COMPETITION = ['LOW', 'MEDIUM', 'HIGH'] as const;

/** Empreinte stable d'un texte (FNV-1a) : le même mot-clé donne toujours les mêmes chiffres */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Source de démonstration en attendant l'accès à Keyword Planner : volumes INVENTÉS, stables d'un appel à l'autre,
 * plus faibles pour les mots-clés longs. Sert seulement à tester l'écran ; tout ce qu'elle produit est marqué simulé.
 * Activée par KEYWORD_VOLUME_PROVIDER=mock.
 */
export class MockKeywordVolumes implements KeywordVolumePort {
  public readonly id = 'mock';

  public async ideas(seeds: string[], options: { limit?: number } = {}): Promise<KeywordIdeasResult> {
    const keywords = [...new Set(seeds.map((seed) => seed.trim().toLowerCase()).filter(Boolean))];
    const ideas = keywords
      .slice(0, 3)
      .flatMap((keyword) => IDEA_SUFFIXES.map((suffix) => `${keyword} ${suffix}`))
      .filter((idea) => !keywords.includes(idea))
      .map((idea) => this.volume(idea))
      .sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0));
    return { seeds: keywords.map((keyword) => this.volume(keyword)), ideas: ideas.slice(0, options.limit ?? 50) };
  }

  private volume(keyword: string): KeywordVolume {
    const h = hash(keyword);
    const words = keyword.split(/\s+/).length;
    const step = Math.max(0, Math.min(STEPS.length - 1, (h % STEPS.length) - (words - 2) * 3));
    const average = STEPS[step];
    const slope = ((h >> 8) % 7) - 3;
    const monthly = Array.from({ length: 12 }, (_, month) =>
      Math.max(0, Math.round(average * (1 + (slope * (month - 5.5)) / 40 + (((h >> month) % 5) - 2) / 20)))
    );
    return { keyword, avgMonthlySearches: average, competition: COMPETITION[(h >> 4) % 3], monthly };
  }
}
