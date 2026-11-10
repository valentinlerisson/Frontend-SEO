import { prisma } from '@/adapters/secondary/database/prisma';
import { SiteCrawler } from '@/adapters/secondary/crawler/site-crawler';
import { GEO_ENABLED } from '../domain/features';
import { randomUUID } from 'node:crypto';
import { CUSTOM_CODE_PREFIX, CUSTOM_PILLAR, FIX_STATUSES, reorderColumn, verificationOf, type FixStatus, type FixVerification } from '../domain/fix-plan';

/** Anomalie relevée par un audit, telle que le plan en a besoin */
export interface PlanIssue {
  code: string;
  pillar: string;
  severity: string;
  title: string;
  recommendation: string;
  url: string | null;
}

export interface PlanTask {
  id: string;
  code: string;
  title: string;
  pillar: string;
  severity: string;
  recommendation: string;
  status: FixStatus;
  position: number;
  /** AUTO : impact fort ou moyen ; MANUAL : ajoutée depuis Anomalies ; CUSTOM : tâche libre créée à la main */
  source: 'AUTO' | 'MANUAL' | 'CUSTOM';
  note: string | null;
  url: string | null;
  /** Clé d'URL de la page (`pageKeyOf`) ; vide pour une anomalie du site entier */
  pageKey: string;
  /** Chemin de la page (« /contact/ ») ; null pour une anomalie du site entier */
  path: string | null;
  /** Page dans l'audit de référence (ouvre son tiroir) */
  pageId: string | null;
  createdAt: string;
  doneAt: string | null;
  verification: FixVerification;
}

export interface PlanData {
  /** Audit qui sert à vérifier les tâches (le dernier dont l'exploration est terminée) */
  audit: { id: string; date: string; complete: boolean } | null;
  tasks: PlanTask[];
}

/** Audits dont les anomalies techniques sont complètes ; le contenu seulement une fois l'audit terminé */
const READY = ['COMPLETED', 'AWAITING_AI_SELECTION'];

const pathOf = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
};

/**
 * Plan d'action d'un projet : une tâche par anomalie et par page, gardée d'un audit à l'autre. À chaque lecture, les
 * anomalies à fort ou moyen impact du dernier audit qui n'ont pas encore de tâche en reçoivent une (« À corriger ») ;
 * une tâche retirée du plan ne revient pas seule. Le dernier audit dit aussi si l'anomalie est encore relevée.
 */
export class FixPlanService {
  private static async projectOf(projectRef: string) {
    const project = await prisma.project.findFirst({ where: { OR: [{ id: projectRef }, { domain: projectRef }] }, select: { id: true } });
    if (!project) throw new Error('Projet introuvable');
    return project;
  }

  private static async referenceAudit(projectId: string) {
    const audit = await prisma.audit.findFirst({
      where: { projectId, status: { in: READY } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, completedAt: true, updatedAt: true, createdAt: true }
    });
    if (!audit) return null;
    const [issues, pages] = await Promise.all([
      prisma.issue.findMany({
        where: { auditId: audit.id },
        select: { code: true, pillar: true, severity: true, title: true, recommendation: true, affectedUrl: true }
      }),
      prisma.page.findMany({ where: { auditId: audit.id }, select: { id: true, url: true } })
    ]);
    return { audit, issues, pages };
  }

  /**
   * Lecture du plan. `priorityOf` dit quelles anomalies entrent seules dans le plan et dans quel ordre (0 : impact fort,
   * 1 : impact moyen, null : à ajouter à la main ; calculé par l'interface, `lib/issue-impact.ts`).
   */
  public static async load(projectRef: string, priorityOf: (issue: PlanIssue) => number | null): Promise<PlanData> {
    const project = await this.projectOf(projectRef);
    const reference = await this.referenceAudit(project.id);
    const complete = reference?.audit.status === 'COMPLETED';

    const issues: PlanIssue[] = (reference?.issues ?? [])
      .filter((issue) => GEO_ENABLED || issue.pillar.toUpperCase() !== 'GEO')
      .map((issue) => ({
        code: issue.code,
        pillar: issue.pillar.toUpperCase(),
        severity: issue.severity.toUpperCase(),
        title: issue.title,
        recommendation: issue.recommendation,
        url: issue.affectedUrl
      }));
    const keyOf = (code: string, url: string | null) => `${code}|${url ? SiteCrawler.urlKey(url) : ''}`;
    const detected = new Map(issues.map((issue) => [keyOf(issue.code, issue.url), issue]));
    const pageByKey = new Map((reference?.pages ?? []).map((page) => [SiteCrawler.urlKey(page.url), page.id]));

    // Anomalies prioritaires sans tâche : ajoutées en fin de « À corriger » (une tâche retirée garde sa ligne et ne revient pas)
    const existing = await prisma.fixTask.findMany({ where: { projectId: project.id }, select: { code: true, pageKey: true, status: true, position: true } });
    const known = new Set(existing.map((task) => `${task.code}|${task.pageKey}`));
    let next = Math.max(-1, ...existing.filter((task) => task.status === 'TODO').map((task) => task.position)) + 1;
    const fresh = new Map<string, { issue: PlanIssue; priority: number }>();
    for (const issue of issues) {
      const key = keyOf(issue.code, issue.url);
      const priority = known.has(key) || fresh.has(key) ? null : priorityOf(issue);
      if (priority !== null) fresh.set(key, { issue, priority });
    }
    // Impact fort d'abord, puis la gravité (critique, avertissement, mineure)
    const severityRank: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    const ordered = Array.from(fresh.values())
      .sort((a, b) => a.priority - b.priority || (severityRank[a.issue.severity] ?? 1) - (severityRank[b.issue.severity] ?? 1))
      .map((entry) => entry.issue);
    if (ordered.length > 0) {
      await prisma.fixTask.createMany({
        data: ordered.map((issue) => ({
          projectId: project.id,
          code: issue.code,
          pageKey: issue.url ? SiteCrawler.urlKey(issue.url) : '',
          url: issue.url,
          title: issue.title,
          pillar: issue.pillar,
          severity: issue.severity,
          recommendation: issue.recommendation,
          status: 'TODO',
          position: next++,
          source: 'AUTO'
        }))
      });
    }

    const tasks = await prisma.fixTask.findMany({
      where: { projectId: project.id, status: { in: FIX_STATUSES } },
      orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }]
    });
    const completedAt = reference ? (reference.audit.completedAt ?? reference.audit.updatedAt) : null;

    return {
      audit: reference ? { id: reference.audit.id, date: (reference.audit.completedAt ?? reference.audit.createdAt).toISOString(), complete } : null,
      tasks: tasks.map((task) => {
        const current = detected.get(`${task.code}|${task.pageKey}`);
        return {
          id: task.id,
          code: task.code,
          // Titre et gravité du dernier relevé quand l'anomalie est encore là
          title: current?.title ?? task.title,
          pillar: task.pillar,
          severity: current?.severity ?? task.severity,
          recommendation: current?.recommendation || task.recommendation,
          status: task.status as FixStatus,
          position: task.position,
          source: task.source === 'CUSTOM' ? 'CUSTOM' : task.source === 'MANUAL' ? 'MANUAL' : 'AUTO',
          note: task.note,
          url: task.url,
          pageKey: task.pageKey,
          path: pathOf(task.url),
          pageId: task.pageKey ? (pageByKey.get(task.pageKey) ?? null) : null,
          createdAt: task.createdAt.toISOString(),
          doneAt: task.doneAt?.toISOString() ?? null,
          // Une tâche libre n'est liée à aucune anomalie : l'audit n'a rien à en dire
          verification:
            task.source === 'CUSTOM'
              ? null
              : verificationOf(
                  { status: task.status as FixStatus, createdAt: task.createdAt, doneAt: task.doneAt, pillar: task.pillar, pageKey: task.pageKey },
                  {
                    completedAt,
                    // Avant le choix des pages stratégiques, seules les anomalies techniques sont relevées
                    pillarChecked: complete || task.pillar === 'TECH',
                    detected: Boolean(current),
                    pageCrawled: !task.pageKey || pageByKey.has(task.pageKey)
                  }
                )
        };
      })
    };
  }

  /**
   * Ajout depuis l'écran Anomalies : une tâche par anomalie et par page, d'après le dernier audit. Une tâche déjà
   * dans le plan ne bouge pas ; une tâche retirée revient dans « À corriger ». Renvoie les tâches ajoutées (pour
   * pouvoir annuler).
   */
  public static async add(projectRef: string, items: { code: string; url: string | null }[]): Promise<string[]> {
    const project = await this.projectOf(projectRef);
    const reference = await this.referenceAudit(project.id);
    const lookup = new Map(
      (reference?.issues ?? []).map((issue) => [`${issue.code}|${issue.affectedUrl ? SiteCrawler.urlKey(issue.affectedUrl) : ''}`, issue])
    );
    const last = await prisma.fixTask.aggregate({ where: { projectId: project.id, status: 'TODO' }, _max: { position: true } });
    let next = (last._max.position ?? -1) + 1;
    const added: string[] = [];
    for (const item of items.slice(0, 500)) {
      const pageKey = item.url ? SiteCrawler.urlKey(item.url) : '';
      const issue = lookup.get(`${item.code}|${pageKey}`);
      if (!issue) continue;
      const existing = await prisma.fixTask.findUnique({ where: { projectId_code_pageKey: { projectId: project.id, code: item.code, pageKey } } });
      if (existing && existing.status !== 'REMOVED') continue;
      const data = {
        url: issue.affectedUrl,
        title: issue.title,
        pillar: issue.pillar.toUpperCase(),
        severity: issue.severity.toUpperCase(),
        recommendation: issue.recommendation,
        status: 'TODO',
        position: next++,
        source: 'MANUAL',
        doneAt: null
      };
      if (existing) await prisma.fixTask.update({ where: { id: existing.id }, data });
      else added.push((await prisma.fixTask.create({ data: { ...data, projectId: project.id, code: item.code, pageKey } })).id);
      if (existing) added.push(existing.id);
    }
    return added;
  }

  /**
   * Tâche libre : un titre, des détails facultatifs et, si des adresses sont données, une tâche par adresse (même
   * titre). Elles arrivent en haut de « À corriger », dans l'ordre donné. Renvoie les identifiants créés.
   */
  public static async addCustom(projectRef: string, input: { title: string; details?: string; urls?: string[] }): Promise<string[]> {
    const project = await this.projectOf(projectRef);
    const title = input.title.trim().slice(0, 160);
    if (!title) throw new Error('Donnez un titre à la tâche');
    const details = input.details?.trim().slice(0, 1000) ?? '';

    const targets: (string | null)[] = [];
    for (const raw of Array.from(new Set((input.urls ?? []).map((url) => url.trim()).filter(Boolean))).slice(0, 100)) {
      try {
        const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (!url.hostname.includes('.')) throw new Error();
        targets.push(url.toString());
      } catch {
        throw new Error(`Adresse invalide : ${raw}`);
      }
    }
    if (targets.length === 0) targets.push(null);

    const first = await prisma.fixTask.aggregate({ where: { projectId: project.id, status: 'TODO' }, _min: { position: true } });
    let position = (first._min.position ?? 0) - targets.length;
    const ids: string[] = [];
    for (const url of targets) {
      const task = await prisma.fixTask.create({
        data: {
          projectId: project.id,
          code: `${CUSTOM_CODE_PREFIX}${randomUUID()}`,
          pageKey: url ? SiteCrawler.urlKey(url) : '',
          url,
          title,
          pillar: CUSTOM_PILLAR,
          severity: 'INFO',
          recommendation: details,
          status: 'TODO',
          position: position++,
          source: 'CUSTOM'
        }
      });
      ids.push(task.id);
    }
    return ids;
  }

  /** Déplacement d'une tâche : nouvelle colonne et place avant `beforeId` (à la fin sans `beforeId`) ; note éventuelle */
  public static async update(
    projectRef: string,
    taskId: string,
    change: { status?: FixStatus; beforeId?: string | null; note?: string | null }
  ): Promise<void> {
    const project = await this.projectOf(projectRef);
    const task = await prisma.fixTask.findFirst({ where: { id: taskId, projectId: project.id } });
    if (!task) throw new Error('Tâche introuvable');
    const status = change.status ?? (task.status as FixStatus);
    if (!FIX_STATUSES.includes(status)) throw new Error('Statut inconnu');

    if (change.status !== undefined || change.beforeId !== undefined) {
      const column = await prisma.fixTask.findMany({
        where: { projectId: project.id, status, id: { not: task.id } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true }
      });
      const order = reorderColumn(column.map((item) => item.id), task.id, change.beforeId);
      await prisma.$transaction([
        prisma.fixTask.update({
          where: { id: task.id },
          data: {
            status,
            doneAt: status === 'DONE' ? (task.status === 'DONE' ? task.doneAt : new Date()) : null
          }
        }),
        ...order.map((id, position) => prisma.fixTask.update({ where: { id }, data: { position } }))
      ]);
    }
    if (change.note !== undefined) {
      await prisma.fixTask.update({ where: { id: task.id }, data: { note: change.note?.trim().slice(0, 500) || null } });
    }
  }

  /**
   * Plusieurs tâches à la fois (barre d'actions du plan) : nouveau statut (ajoutées à la fin de la colonne, dans leur
   * ordre actuel), note commune, ou retrait du plan
   */
  public static async updateMany(
    projectRef: string,
    ids: string[],
    change: { status?: FixStatus; note?: string | null; remove?: boolean }
  ): Promise<number> {
    const project = await this.projectOf(projectRef);
    const tasks = await prisma.fixTask.findMany({
      where: { projectId: project.id, id: { in: ids.slice(0, 1000) }, status: { in: FIX_STATUSES } },
      orderBy: [{ status: 'asc' }, { position: 'asc' }]
    });
    if (tasks.length === 0) return 0;
    if (change.remove) {
      await prisma.fixTask.updateMany({ where: { id: { in: tasks.map((task) => task.id) } }, data: { status: 'REMOVED' } });
      return tasks.length;
    }
    const operations = [];
    if (change.status && FIX_STATUSES.includes(change.status)) {
      const status = change.status;
      const last = await prisma.fixTask.aggregate({ where: { projectId: project.id, status }, _max: { position: true } });
      let next = (last._max.position ?? -1) + 1;
      for (const task of tasks) {
        if (task.status === status) continue;
        operations.push(
          prisma.fixTask.update({
            where: { id: task.id },
            data: { status, position: next++, doneAt: status === 'DONE' ? new Date() : null }
          })
        );
      }
    }
    if (change.note !== undefined) {
      const note = change.note?.trim().slice(0, 500) || null;
      operations.push(prisma.fixTask.updateMany({ where: { id: { in: tasks.map((task) => task.id) } }, data: { note } }));
    }
    if (operations.length) await prisma.$transaction(operations);
    return tasks.length;
  }

  /** Retrait du plan : la tâche reste en base (statut REMOVED) pour ne pas revenir seule au prochain audit */
  public static async remove(projectRef: string, taskId: string): Promise<void> {
    const project = await this.projectOf(projectRef);
    const result = await prisma.fixTask.updateMany({ where: { id: taskId, projectId: project.id }, data: { status: 'REMOVED' } });
    if (result.count === 0) throw new Error('Tâche introuvable');
  }
}
