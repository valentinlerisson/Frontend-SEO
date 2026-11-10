import { prisma } from '@/adapters/secondary/database/prisma';
import { createSerpProvider } from '@/adapters/secondary/serp/create-serp-provider';
import { readBacklinkPage } from '@/adapters/secondary/backlinks/backlink-page-reader';
import type { BacklinkDiscovery, BacklinkReport, DiscoveredBacklink, UnlinkedMention } from '../domain/types';
import { SerpBlockedError, type SerpProviderPort } from '../ports/serp-provider';
import { brandVariants } from '../domain/scoring/autocomplete-relevance';
import { SEARCH_CHUNK_PAGES, candidatesFromResults, planBacklinkSearches, trimToBudget, type BacklinkCandidate } from '../domain/backlink-discovery';
import { remainingSearches, resolveSerpBudget, type SerpBudget } from '../domain/serp-budget';
import { SERP_STALE_MS, jobRegistry } from './job-registry';
import { AuditService } from './audit-service';

/** Pages candidates lues en parallèle, et échecs de recherche de suite avant d'arrêter */
const READ_CONCURRENCY = 4;
const MAX_CONSECUTIVE_FAILURES = 3;
/** Mentions sans lien gardées : le nom de marque est parfois porté par d'autres entreprises, la liste peut être longue */
const MAX_MENTIONS = 60;

const parse = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** La recherche a eu lieu mais Google n'a rien renvoyé (domaine sans page qui cite le site) : un résultat, pas un échec */
const isEmptyResult = (err: unknown) => String((err as Error)?.message ?? '').startsWith('Aucun résultat extrait');

/**
 * Recherche des liens précis, lancée à la demande (à part de l'audit) : requêtes Google sur les domaines référents de
 * Common Crawl et sur le nom du site, puis lecture en direct des pages trouvées. Le résultat est rangé dans le relevé
 * de backlinks du dernier audit (`BacklinkReport.discovery`). Les recherches suivent le budget de la mesure Google et
 * partagent son verrou : une seule recherche Google à la fois (même navigateur, même profil).
 */
export class BacklinkDiscoveryService {
  public static async start(
    projectRef: string,
    options: { budget?: Partial<SerpBudget>; provider?: SerpProviderPort; reader?: typeof readBacklinkPage } = {}
  ): Promise<{ started: boolean; reason?: string; searches: number; remainingToday: number }> {
    const none = (reason: string, remainingToday = 0) => ({ started: false, reason, searches: 0, remainingToday });
    const project = await prisma.project.findFirst({ where: { OR: [{ id: projectRef }, { domain: projectRef }] }, select: { id: true, domain: true } });
    if (!project) throw new Error('Projet introuvable');
    const audit = await prisma.audit.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, backlinksRaw: true }
    });
    const report = parse<BacklinkReport>(audit?.backlinksRaw);
    if (!audit || !report || report.status !== 'DONE') {
      return none('Les backlinks de cet audit ne sont pas encore relevés : attendez la fin de l’exploration.');
    }
    if (jobRegistry.serpAlive()) return none('Une recherche Google est déjà en cours (mesure des pages ou liens précis).');
    const previous = report.discovery;
    if (previous?.status === 'RUNNING' && Date.now() - Date.parse(previous.updatedAt) < SERP_STALE_MS) {
      return none('Une recherche des liens précis est déjà en cours.');
    }

    const budget = resolveSerpBudget(options.budget);
    const usedToday = await AuditService.serpUsageToday();
    const remaining = remainingSearches(budget, 0, usedToday);
    if (remaining < 1) {
      return none(`Budget du jour atteint (${budget.perDay} recherches Google) : reprenez demain ou augmentez-le dans les Paramètres.`);
    }
    const plan = trimToBudget(planBacklinkSearches(project.domain), remaining);
    if (plan.length === 0) {
      return none(`Budget insuffisant (${SEARCH_CHUNK_PAGES} pages de résultats au moins) : il reste ${remaining} recherche(s) Google aujourd’hui.`, remaining);
    }

    const provider = options.provider ?? createSerpProvider();
    const now = new Date().toISOString();
    const discovery: BacklinkDiscovery = {
      status: 'RUNNING',
      startedAt: now,
      updatedAt: now,
      provider: provider.id,
      searches: { planned: plan.length, done: 0, requests: 0 },
      pages: { found: 0, read: 0, unreachable: 0 },
      links: [],
      mentions: []
    };
    await this.save(audit.id, discovery);

    jobRegistry.startSerp();
    this.run({ auditId: audit.id, domain: project.domain, report, plan, provider, budget, usedToday, discovery, reader: options.reader ?? readBacklinkPage })
      .catch(async (err) => {
        console.error('[BacklinkDiscovery] Recherche interrompue :', err);
        await this.save(audit.id, { ...discovery, status: 'ERROR', message: String(err?.message ?? err).slice(0, 300), finishedAt: new Date().toISOString() });
      })
      .finally(() => jobRegistry.endSerp());

    return { started: true, searches: plan.length, remainingToday: remaining };
  }

  private static async run(input: {
    auditId: string;
    domain: string;
    report: BacklinkReport;
    plan: ReturnType<typeof planBacklinkSearches>;
    provider: SerpProviderPort;
    budget: SerpBudget;
    usedToday: number;
    discovery: BacklinkDiscovery;
    reader: typeof readBacklinkPage;
  }) {
    const { auditId, domain, report, plan, provider, budget, discovery, reader } = input;
    let usedToday = input.usedToday;
    let usedInRun = 0;
    let requested = false;
    const pause = () => new Promise((resolve) => setTimeout(resolve, 4000 + Math.random() * 4000));
    const save = async () => {
      discovery.updatedAt = new Date().toISOString();
      jobRegistry.beatSerp();
      await this.save(auditId, discovery);
    };

    // 1. Recherches Google
    const batches: { results: import('../domain/types').SerpResult[]; foundBy: BacklinkCandidate['foundBy'] }[] = [];
    let stopped: string | null = null;
    let failures = 0;
    // Requêtes dont Google n'a plus de résultat : leurs lots suivants (plus profonds) sont sautés
    const exhausted = new Set<string>();
    for (const search of plan) {
      if (exhausted.has(search.query)) {
        discovery.searches.done++;
        continue;
      }
      if (remainingSearches(budget, usedInRun, usedToday) < search.pages) {
        stopped = `Budget de recherches Google atteint (${budget.perRun} par lancement, ${budget.perDay} par jour) : relancez plus tard ou augmentez-le dans les Paramètres.`;
        break;
      }
      const count = async (requests: number) => {
        usedInRun += requests;
        usedToday += requests;
        if (requests > 0) requested = true;
        await AuditService.countSerpSearches(requests);
        discovery.searches.requests = usedInRun;
      };
      try {
        if (requested) await pause();
        const found = await provider.search(search.query, { pages: search.pages, start: search.start });
        await count(found.requests);
        batches.push({ results: found.results, foundBy: 'brand-search' });
        // Un lot incomplet (moins d'une page de résultats) est le dernier de cette requête
        if (found.results.length < 10) exhausted.add(search.query);
        failures = 0;
      } catch (err: any) {
        // Page vide : fin des résultats de cette requête (une seule page a été chargée) ; autre échec : il a pu partir vers Google
        await count(isEmptyResult(err) ? 1 : search.pages);
        if (isEmptyResult(err)) exhausted.add(search.query);
        if (err instanceof SerpBlockedError) {
          stopped = 'Captcha ou blocage de Google : la recherche s’arrête ici, relancez-la plus tard. Les pages déjà trouvées sont lues.';
          break;
        }
        if (!isEmptyResult(err)) {
          failures++;
          console.error(`[BacklinkDiscovery] Recherche « ${search.query} » en échec : ${err?.message ?? err}`);
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            stopped = `Trois recherches de suite ont échoué (${String(err?.message ?? err).slice(0, 120)}) : la recherche s’arrête ici.`;
            break;
          }
        }
      }
      discovery.searches.done++;
      await save();
    }

    // 2. Pages candidates : jamais le site audité, une fois chacune, quelques pages par domaine au plus
    const referring = new Set(report.referringDomains.map((item) => item.domain));
    const candidates = candidatesFromResults(batches, { target: domain, referring });
    discovery.pages.found = candidates.length;
    await save();

    // 3. Lecture en direct de chaque page : le code relève les liens vers le site et les mentions sans lien
    const brands = brandVariants(domain);
    const results: { links: DiscoveredBacklink[]; mention?: UnlinkedMention }[] = candidates.map(() => ({ links: [] }));
    const queue = candidates.map((candidate, index) => ({ candidate, index }));
    const publish = () => {
      discovery.links = results.flatMap((item) => item.links);
      discovery.mentions = results.flatMap((item) => (item.mention ? [item.mention] : [])).slice(0, MAX_MENTIONS);
    };
    await Promise.all(
      Array.from({ length: READ_CONCURRENCY }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { candidate, index } = next;
          try {
            const read = await reader(candidate.url, domain, brands);
            if (read.status === 'UNREACHABLE') {
              discovery.pages.unreachable++;
              const reasons = (discovery.pages.unreachableReasons ??= {});
              reasons[read.reason] = (reasons[read.reason] ?? 0) + 1;
            } else {
              discovery.pages.read++;
              results[index].links = read.links.map((link) => ({
                ...link,
                sourceDomain: candidate.domain,
                inCommonCrawl: candidate.inCommonCrawl,
                foundBy: candidate.foundBy
              }));
              if (read.links.length === 0 && read.mentionsTarget) {
                results[index].mention = {
                  url: read.finalUrl,
                  domain: candidate.domain,
                  title: candidate.title || read.title,
                  snippet: candidate.snippet,
                  inCommonCrawl: candidate.inCommonCrawl
                };
              }
            }
          } catch {
            discovery.pages.unreachable++;
          }
          publish();
          if ((discovery.pages.read + discovery.pages.unreachable) % 5 === 0) await save();
        }
      })
    );
    publish();
    // Une même ancre vers la même page depuis la même source n'est listée qu'une fois
    const seen = new Set<string>();
    discovery.links = discovery.links.filter((link) => {
      const key = `${link.sourceUrl}|${link.targetUrl}|${link.anchor}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    discovery.finishedAt = new Date().toISOString();
    if (discovery.searches.done === 0) {
      discovery.status = 'ERROR';
      discovery.message = stopped ?? 'Aucune recherche Google n’a abouti.';
    } else {
      discovery.status = stopped ? 'PARTIAL' : 'DONE';
      if (stopped) discovery.message = stopped;
    }
    await save();
  }

  /** Range la recherche dans le relevé de backlinks de l'audit, sans toucher au reste du relevé */
  private static async save(auditId: string, discovery: BacklinkDiscovery) {
    const audit = await prisma.audit.findUnique({ where: { id: auditId }, select: { backlinksRaw: true } });
    const report = parse<BacklinkReport>(audit?.backlinksRaw);
    if (!report) return;
    await prisma.audit.update({ where: { id: auditId }, data: { backlinksRaw: JSON.stringify({ ...report, discovery }) } });
  }
}
