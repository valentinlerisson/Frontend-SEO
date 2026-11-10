import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PsiScreenshot, PsiScreenshots } from './pagespeed';

/**
 * Captures PageSpeed Insights gardées sur le disque (`.data/pagespeed/`, ignoré par git), une par adresse de page :
 * la dernière mesure remplace la précédente. Hors base de données : une page entière pèse plusieurs centaines de Ko.
 */
const DIR = path.join(process.cwd(), '.data', 'pagespeed');

export type ScreenshotKind = 'final' | 'full';

export type ScreenshotImageMeta = { type: string; width?: number; height?: number };

export type ScreenshotMeta = {
  url: string;
  capturedAt: string;
  final?: ScreenshotImageMeta;
  full?: ScreenshotImageMeta;
};

const keyOf = (url: string) => createHash('sha1').update(url).digest('hex');
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

function decode(image: PsiScreenshot): { type: string; bytes: Buffer } | null {
  const match = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=\s]+)$/.exec(image.dataUrl);
  return match ? { type: match[1], bytes: Buffer.from(match[2], 'base64') } : null;
}

export class ScreenshotStore {
  public static async save(url: string, screenshots: PsiScreenshots): Promise<ScreenshotMeta | null> {
    const key = keyOf(url);
    const meta: ScreenshotMeta = { url, capturedAt: new Date().toISOString() };
    await mkdir(DIR, { recursive: true });
    for (const kind of ['final', 'full'] as const) {
      const image = screenshots[kind];
      const decoded = image ? decode(image) : null;
      if (!image || !decoded) continue;
      await writeFile(path.join(DIR, `${key}.${kind}.${EXTENSION[decoded.type]}`), decoded.bytes);
      meta[kind] = { type: decoded.type, width: image.width, height: image.height };
    }
    if (!meta.final && !meta.full) return null;
    await writeFile(path.join(DIR, `${key}.json`), JSON.stringify(meta));
    return meta;
  }

  public static async meta(url: string): Promise<ScreenshotMeta | null> {
    try {
      return JSON.parse(await readFile(path.join(DIR, `${keyOf(url)}.json`), 'utf-8')) as ScreenshotMeta;
    } catch {
      return null;
    }
  }

  public static async image(url: string, kind: ScreenshotKind): Promise<{ type: string; bytes: Buffer } | null> {
    const meta = await this.meta(url);
    const image = meta?.[kind];
    if (!image) return null;
    try {
      return { type: image.type, bytes: await readFile(path.join(DIR, `${keyOf(url)}.${kind}.${EXTENSION[image.type]}`)) };
    } catch {
      return null;
    }
  }
}
