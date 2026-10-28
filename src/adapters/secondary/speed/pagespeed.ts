import type { CoreWebVitals } from '@/core/domain/types';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const REQUEST_TIMEOUT_MS = 90_000;

type CruxMetric = { percentile?: number };
type PsiResponse = {
  loadingExperience?: { metrics?: Record<string, CruxMetric> };
  lighthouseResult?: { audits?: Record<string, { numericValue?: number }> };
};

/**
 * Core Web Vitals via l'API Google PageSpeed Insights, en mobile. Les données de terrain (utilisateurs réels,
 * CrUX) sont préférées quand elles existent ; à défaut, mesure de laboratoire pour le LCP et le CLS.
 * L'INP n'existe qu'en données de terrain : il reste absent pour les sites à faible trafic.
 */
export class PageSpeedInsights {
  public static isConfigured(): boolean {
    return Boolean(process.env.PAGESPEED_API_KEY);
  }

  public static async measure(url: string): Promise<CoreWebVitals | null> {
    const params = new URLSearchParams({
      url,
      strategy: 'mobile',
      category: 'performance',
      key: process.env.PAGESPEED_API_KEY ?? ''
    });

    try {
      const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        console.warn(`[PageSpeed] ${url} -> HTTP ${response.status}`);
        return null;
      }
      const data = (await response.json()) as PsiResponse;
      const field = data.loadingExperience?.metrics ?? {};
      const lab = data.lighthouseResult?.audits ?? {};
      const source: NonNullable<CoreWebVitals['source']> = {};
      const vitals: CoreWebVitals = { source };

      const fieldLcp = field.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
      const labLcp = lab['largest-contentful-paint']?.numericValue;
      if (typeof fieldLcp === 'number') {
        vitals.lcp = Math.round((fieldLcp / 1000) * 100) / 100;
        source.lcp = 'field';
      } else if (typeof labLcp === 'number') {
        vitals.lcp = Math.round((labLcp / 1000) * 100) / 100;
        source.lcp = 'lab';
      }

      // Le percentile CrUX du CLS est exprimé ×100 (12 = 0,12)
      const fieldCls = field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
      const labCls = lab['cumulative-layout-shift']?.numericValue;
      if (typeof fieldCls === 'number') {
        vitals.cls = Math.round(fieldCls) / 100;
        source.cls = 'field';
      } else if (typeof labCls === 'number') {
        vitals.cls = Math.round(labCls * 1000) / 1000;
        source.cls = 'lab';
      }

      const fieldInp = field.INTERACTION_TO_NEXT_PAINT?.percentile;
      if (typeof fieldInp === 'number') {
        vitals.inp = Math.round(fieldInp);
        source.inp = 'field';
      }

      return vitals.lcp === undefined && vitals.cls === undefined && vitals.inp === undefined ? null : vitals;
    } catch (err: any) {
      console.warn(`[PageSpeed] ${url} -> ${err?.message ?? err}`);
      return null;
    }
  }
}
