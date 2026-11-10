import { NextRequest, NextResponse } from 'next/server';
import { FixPlanService } from '@/core/services/fix-plan-service';
import { FIX_STATUSES, type FixStatus } from '@/core/domain/fix-plan';

type Params = { params: Promise<{ projectId: string; taskId: string }> };

/** Déplacement ou note. Corps : { status?, beforeId?, note? } */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { projectId, taskId } = await params;
    const body = await req.json().catch(() => ({}));
    const status = FIX_STATUSES.includes(body?.status) ? (body.status as FixStatus) : undefined;
    await FixPlanService.update(projectId, taskId, {
      status,
      beforeId: typeof body?.beforeId === 'string' || body?.beforeId === null ? body.beforeId : undefined,
      note: typeof body?.note === 'string' || body?.note === null ? body.note : undefined
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Modification impossible' }, { status: 400 });
  }
}

/** Retrait du plan (la tâche ne revient pas seule au prochain audit) */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { projectId, taskId } = await params;
    await FixPlanService.remove(projectId, taskId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Retrait impossible' }, { status: 400 });
  }
}
