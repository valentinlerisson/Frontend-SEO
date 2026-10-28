/**
 * Prépare la base locale des backlinks à partir du graphe de domaines Common Crawl (une fois par version du graphe).
 *
 *   npm run backlinks:build                                   (dernière version publiée)
 *   npm run backlinks:build -- cc-main-2026-aug-sep-oct       (version précise)
 *   npm run backlinks:build -- --keep                         (garde les fichiers téléchargés)
 *
 * Étapes : téléchargement des sommets (≈ 0,9 Go) et des liens (≈ 7,1 Go), reprise en cas de coupure ; conversion en
 * Parquet, liens partitionnés par domaine cible (to_id % 256) pour qu'une recherche ne lise qu'une partition ;
 * écriture de current.json ; suppression des fichiers téléchargés. Mesuré : ≈ 5 min de téléchargement, ≈ 25 min de
 * conversion, ≈ 7 Go sur le disque. Dossier : BACKLINKS_DATA_DIR, sinon .data/commoncrawl dans le projet.
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DuckDBInstance } from '@duckdb/node-api';
import { BACKLINK_PARTITIONS, backlinksDataDir } from '@/adapters/secondary/backlinks/common-crawl-index';

const BASE = 'https://data.commoncrawl.org/projects/hyperlinkgraph';

async function latestRelease(): Promise<string> {
  const response = await fetch('https://index.commoncrawl.org/graphinfo.json');
  if (!response.ok) throw new Error(`Liste des versions indisponible (HTTP ${response.status})`);
  const releases = (await response.json()) as { id: string }[];
  if (!releases[0]?.id) throw new Error('Aucune version du graphe publiée');
  return releases[0].id;
}

/** Téléchargement avec reprise (en-tête Range) : le serveur coupe parfois la connexion en cours de route */
async function download(url: string, file: string) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const start = existsSync(file) ? statSync(file).size : 0;
    try {
      const response = await fetch(url, { headers: start > 0 ? { Range: `bytes=${start}-` } : {} });
      if (response.status === 416) return; // déjà complet
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      if (start > 0 && response.status !== 206) throw new Error('Reprise refusée par le serveur');
      const total = Number(response.headers.get('content-length') ?? 0) + start;
      console.log(`  ${path.basename(file)} : ${(start / 2 ** 30).toFixed(2)} / ${(total / 2 ** 30).toFixed(2)} Gio`);
      await pipeline(Readable.fromWeb(response.body as any), createWriteStream(file, { flags: start > 0 ? 'a' : 'w' }));
      if (statSync(file).size >= total) return;
    } catch (err: any) {
      console.warn(`  coupure (${err?.message ?? err}), reprise ${attempt}/20`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error(`Téléchargement impossible : ${url}`);
}

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const release = args.find((arg) => !arg.startsWith('--')) ?? (await latestRelease());
  const root = backlinksDataDir();
  const dir = path.join(root, release);
  mkdirSync(dir, { recursive: true });
  console.log(`Version ${release} -> ${dir}`);

  const vertices = path.join(dir, 'vertices.txt.gz');
  const edges = path.join(dir, 'edges.txt.gz');
  let t = Date.now();
  await download(`${BASE}/${release}/domain/${release}-domain-vertices.txt.gz`, vertices);
  await download(`${BASE}/${release}/domain/${release}-domain-edges.txt.gz`, edges);
  console.log(`Téléchargement : ${Math.round((Date.now() - t) / 1000)} s`);

  const posix = (file: string) => file.replace(/\\/g, '/');
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await connection.run(`SET temp_directory='${posix(path.join(dir, 'tmp'))}'`);
  await connection.run('SET preserve_insertion_order=false');

  t = Date.now();
  await connection.run(`
    COPY (
      SELECT column0 AS id, column1 AS rev_domain, column2 AS num_hosts
      FROM read_csv('${posix(vertices)}', delim='\\t', header=false,
                    columns={'column0': 'BIGINT', 'column1': 'VARCHAR', 'column2': 'INTEGER'})
    ) TO '${posix(path.join(dir, 'vertices.parquet'))}' (FORMAT parquet, COMPRESSION zstd)`);
  console.log(`Domaines : ${Math.round((Date.now() - t) / 1000)} s`);

  t = Date.now();
  await connection.run(`
    COPY (
      SELECT column0 AS from_id, column1 AS to_id, column1 % ${BACKLINK_PARTITIONS} AS part
      FROM read_csv('${posix(edges)}', delim='\\t', header=false,
                    columns={'column0': 'BIGINT', 'column1': 'BIGINT'})
    ) TO '${posix(path.join(dir, 'edges'))}' (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (part), OVERWRITE_OR_IGNORE)`);
  console.log(`Liens : ${Math.round((Date.now() - t) / 1000)} s`);
  connection.closeSync();
  instance.closeSync();

  rmSync(path.join(dir, 'tmp'), { recursive: true, force: true });
  if (!keep) {
    rmSync(vertices, { force: true });
    rmSync(edges, { force: true });
  }
  writeFileSync(path.join(root, 'current.json'), JSON.stringify({ release, builtAt: new Date().toISOString() }, null, 2));
  console.log(`Base prête : ${release}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
