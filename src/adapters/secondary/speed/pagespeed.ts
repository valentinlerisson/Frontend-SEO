import type { CoreWebVitals } from '@/core/domain/types';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const REQUEST_TIMEOUT_MS = 90_000;

type CruxMetric = { percentile?: number };
type PsiImage = { data?: string; width?: number; height?: number };
type PsiResponse = {
  loadingExperience?: { metrics?: Record<string, CruxMetric> };
  lighthouseResult?: {
    audits?: Record<string, { numericValue?: number; details?: { type?: string } & PsiImage }>;
    /** Page entière, capturée en vue mobile */
    fullPageScreenshot?: { screenshot?: PsiImage };
  };
};

/** Image renvoyée par PageSpeed Insights : adresse `data:` (JPEG ou WebP, base64) et dimensions en pixels */
export type PsiScreenshot = { dataUrl: string; width?: number; height?: number };

/** Captures d'une mesure : premier écran affiché (fin du chargement) et page entière, en vue mobile */
export type PsiScreenshots = { final?: PsiScreenshot; full?: PsiScreenshot };

const imageOf = (image?: PsiImage): PsiScreenshot | undefined =>
  image?.data?.startsWith('data:image/') ? { dataUrl: image.data, width: image.width, height: image.height } : undefined;

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
    return (await this.analyze(url)).vitals;
  }

  /** Une mesure PageSpeed : Core Web Vitals et captures de la page (vue mobile) */
  public static async analyze(url: string): Promise<{ vitals: CoreWebVitals | null; screenshots: PsiScreenshots | null }> {
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
        return { vitals: null, screenshots: null };
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

      const final = imageOf(lab['final-screenshot']?.details);
      const full = imageOf(data.lighthouseResult?.fullPageScreenshot?.screenshot);
      return {
        vitals: vitals.lcp === undefined && vitals.cls === undefined && vitals.inp === undefined ? null : vitals,
        screenshots: final || full ? { final, full } : null
      };
    } catch (err: any) {
      console.warn(`[PageSpeed] ${url} -> ${err?.message ?? err}`);
      return { vitals: null, screenshots: null };
    }
  }
}
