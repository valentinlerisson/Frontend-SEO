import { spawn } from 'node:child_process';
import path from 'node:path';

const PROCESS_TIMEOUT_MS = 45_000;

/**
 * Types Schema.org lus après exécution du JavaScript de la page (scripts/render/schema-types.mjs, Chrome sans fenêtre).
 * Retourne null si le rendu échoue : le score Schema.org reste alors celui du HTML initial.
 */
export class RenderedSchema {
  private static readonly script = path.join(process.cwd(), 'scripts', 'render', 'schema-types.mjs');

  static read(url: string): Promise<string[] | null> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [this.script, url], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, PROCESS_TIMEOUT_MS);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return resolve(null);
        try {
          const payload = JSON.parse(stdout) as { types?: unknown };
          resolve(Array.isArray(payload.types) ? payload.types.filter((type): type is string => typeof type === 'string') : null);
        } catch {
          resolve(null);
        }
      });
    });
  }
}
