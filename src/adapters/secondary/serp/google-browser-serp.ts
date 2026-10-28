import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SerpFeatures, SerpResult } from '@/core/domain/types';
import { SerpBlockedError, type SerpProviderPort } from '@/core/ports/serp-provider';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Délai maximal d'une recherche : le navigateur attend jusqu'à 180 s qu'un captcha soit résolu à la main */
const PROCESS_TIMEOUT_MS = 300_000;

type Payload = { query: string; fetchedAt: string; results: SerpResult[]; features?: SerpFeatures };

/**
 * Résultats Google via un Chrome local visible (scripts/serp/google-serp.mjs, patchright) et un profil
 * persistant dédié. Cache disque de 24 h par requête. Usage local et espacé : un captcha se résout à la main
 * dans la fenêtre. Variables : SERP_PROFILE_DIR (défaut ./.serp-profile), SERP_PAGES.
 */
export class GoogleBrowserSerp implements SerpProviderPort {
  readonly id = 'browser';
  private readonly script = path.join(process.cwd(), 'scripts', 'serp', 'google-serp.mjs');
  private readonly cacheDir = path.join(process.cwd(), '.cache', 'serp');

  async search(
    query: string,
    options: { pages?: number; start?: number; domain?: string; fresh?: boolean } = {}
  ): Promise<{ results: SerpResult[]; features?: SerpFeatures }> {
    const pages = Math.max(1, Math.min(3, options.pages ?? (Number(process.env.SERP_PAGES) || 1)));
    const start = Math.max(0, Math.min(2, options.start ?? 0));
    const domain = (options.domain ?? '').toLowerCase().replace(/^www\./, '');
    const cacheFile = this.cacheFile(query, pages, domain, start);

    const cached = options.fresh ? null : await this.readCache(cacheFile);
    if (cached) return { results: cached.results, features: cached.features };

    const payload = await this.run(query, pages, domain, start);
    // Une recherche sans aucun résultat extrait n'est pas une mesure : on ne la met pas en cache
    if (payload.results.length === 0) throw new Error('Aucun résultat extrait de la page Google');
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(payload));
    return { results: payload.results, features: payload.features };
  }

  private cacheFile(query: string, pages: number, domain: string, start: number): string {
    const key = createHash('sha1')
      .update(`${query.toLowerCase().replace(/\s+/g, ' ').trim()}|${pages}|${domain}${start > 0 ? `|${start}` : ''}`)
      .digest('hex');
    return path.join(this.cacheDir, `${key}.json`);
  }

  private async readCache(file: string): Promise<Payload | null> {
    try {
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
      return JSON.parse(await fs.readFile(file, 'utf-8')) as Payload;
    } catch {
      return null;
    }
  }

  private run(query: string, pages: number, domain: string, start: number): Promise<Payload> {
    const profile = process.env.SERP_PROFILE_DIR || path.join(process.cwd(), '.serp-profile');

    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [this.script, query, '--pages', String(pages), '--start', String(start), '--profile', profile, '--timeout', '180', '--debug-dir', 'debug', ...(domain ? ['--domain', domain] : [])],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false }
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Recherche Google interrompue : délai dépassé'));
      }, PROCESS_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Impossible de lancer la recherche Google : ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 2) return reject(new SerpBlockedError());
        if (code !== 0) {
          return reject(new Error(`Recherche Google en échec : ${stderr.trim().split('\n').pop() || `code ${code}`}`));
        }
        try {
          resolve(JSON.parse(stdout) as Payload);
        } catch {
          reject(new Error('Réponse de la recherche Google illisible'));
        }
      });
    });
  }
}
