import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { BacklinkIndexPort } from '@/core/ports/backlink-index';

/**
 * Domaines référents lus dans le graphe de domaines de Common Crawl, préparé par `npm run backlinks:build` :
 *   <BACKLINKS_DATA_DIR>/current.json            { "release": "cc-main-2026-aug-sep-oct" }
 *   <BACKLINKS_DATA_DIR>/<release>/vertices.parquet   id, rev_domain, num_hosts
 *   <BACKLINKS_DATA_DIR>/<release>/edges/part=N/       liens from_id -> to_id, partitionnés par to_id % 256
 * Une recherche ne lit qu'une partition (moins d'une seconde mesurée sur 1,8 milliard de liens).
 */
export const BACKLINK_PARTITIONS = 256;

export function backlinksDataDir(): string {
  return process.env.BACKLINKS_DATA_DIR || path.join(process.cwd(), '.data', 'commoncrawl');
}

/** Domaine en notation inversée du graphe : « big-happy.fr » devient « fr.big-happy » */
export function reverseDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '').split('.').reverse().join('.');
}

export class CommonCrawlBacklinkIndex implements BacklinkIndexPort {
  constructor(private readonly dataDir: string = backlinksDataDir()) {}

  release(): string | undefined {
    try {
      const current = JSON.parse(readFileSync(path.join(this.dataDir, 'current.json'), 'utf-8')) as { release?: string };
      return current.release || undefined;
    } catch {
      return undefined;
    }
  }

  isAvailable(): boolean {
    const release = this.release();
    return Boolean(release && existsSync(path.join(this.dataDir, release, 'vertices.parquet')));
  }

  async referringDomains(domain: string) {
    const release = this.release();
    if (!release) throw new Error('Base Common Crawl absente : lancez npm run backlinks:build');
    const dir = path.join(this.dataDir, release).replace(/\\/g, '/');
    const vertices = `${dir}/vertices.parquet`;

    // Module natif chargé à la demande : l'application démarre même sans lui
    const { DuckDBInstance } = await import('@duckdb/node-api');
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      const target = (
        await connection.runAndReadAll(`SELECT id FROM read_parquet('${vertices}') WHERE rev_domain = $1`, [
          reverseDomain(domain)
        ])
      ).getRowObjectsJS()[0];
      if (!target) return null;
      const id = BigInt(target.id as bigint | number);
      const partition = `${dir}/edges/part=${id % BigInt(BACKLINK_PARTITIONS)}/*.parquet`;
      const rows = (
        await connection.runAndReadAll(
          `SELECT v.rev_domain AS rev_domain, v.num_hosts AS num_hosts
           FROM read_parquet('${partition}') e JOIN read_parquet('${vertices}') v ON v.id = e.from_id
           WHERE e.to_id = $1 AND e.from_id <> $1
           ORDER BY v.num_hosts DESC, v.rev_domain`,
          [id]
        )
      ).getRowObjectsJS();
      return {
        release,
        domains: rows.map((row) => ({
          domain: String(row.rev_domain).split('.').reverse().join('.'),
          hosts: Number(row.num_hosts)
        }))
      };
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  }
}
