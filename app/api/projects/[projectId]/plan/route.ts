import { NextRequest, NextResponse } from 'next/server';
import { FixPlanService } from '@/core/services/fix-plan-service';
import { getIssueImpact } from '@/lib/issue-impact';
import { FIX_STATUSES, type FixStatus } from '@/core/domain/fix-plan';

/** Sévérité enregistrée (CRITICAL, WARNING, INFO) vers celle de l'interface, pour le calcul de l'impact */
const severityOf = (raw: string) => (raw === 'CRITICAL' ? 'critical' : raw === 'INFO' ? 'passed' : 'warning') as 'critical' | 'warning' | 'passed';

/** Plan d'action du projet ; les anomalies à fort ou moyen impact du dernier audit y entrent d'elles-mêmes */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const plan = await FixPlanService.load(projectId, (issue) => {
      const impact = getIssueImpact({ pillar: issue.pillar as 'TECH' | 'EDITORIAL' | 'GEO', code: issue.code, severity: severityOf(issue.severity) });
      return impact === 'high' ? 0 : impact === 'medium' ? 1 : null;
    });
    return NextResponse.json(plan);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Plan indisponible' }, { status: 400 });
  }
}

/**
 * Ajout depuis Anomalies. Corps : { items: [{ code, url }] } (url null : anomalie du site entier).
 * Tâche libre : { custom: { title, details?, urls? } } (une tâche par adresse, ou une seule sans adresse).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await req.json().catch(() => ({}));
    if (body?.custom && typeof body.custom === 'object') {
      const { title, details, urls } = body.custom;
      const ids = await FixPlanService.addCustom(projectId, {
        title: typeof title === 'string' ? title : '',
        details: typeof details === 'string' ? details : undefined,
        urls: Array.isArray(urls) ? urls.filter((url: unknown): url is string => typeof url === 'string') : undefined
      });
      return NextResponse.json({ added: ids.length, ids });
    }
    const items = Array.isArray(body?.items)
      ? body.items
          .filter((item: any) => typeof item?.code === 'string' && (typeof item?.url === 'string' || item?.url === null))
          .map((item: any) => ({ code: item.code, url: item.url }))
      : [];
    if (items.length === 0) return NextResponse.json({ error: 'Aucune tâche à ajouter' }, { status: 400 });
    const ids = await FixPlanService.add(projectId, items);
    return NextResponse.json({ added: ids.length, ids });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Ajout impossible' }, { status: 400 });
  }
}

/** Plusieurs tâches à la fois. Corps : { ids: string[], status?, note?, remove? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string') : [];
    if (ids.length === 0) return NextResponse.json({ error: 'Aucune tâche' }, { status: 400 });
    const updated = await FixPlanService.updateMany(projectId, ids, {
      status: FIX_STATUSES.includes(body?.status) ? (body.status as FixStatus) : undefined,
      note: typeof body?.note === 'string' || body?.note === null ? body.note : undefined,
      remove: body?.remove === true
    });
    return NextResponse.json({ updated });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Modification impossible' }, { status: 400 });
  }
}
