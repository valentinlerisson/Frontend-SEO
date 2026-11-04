import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';
import { PAGE_GOALS } from '@/core/domain/scoring/page-goal';
import type { PageGoal } from '@/core/domain/types';

/**
 * Fixe l'objectif d'une page. Corps : { goal: PageGoal | null } (null : retour à l'objectif déduit du rôle).
 * « Aller droit au but » recalcule le score sans l'IA ; les deux autres objectifs relancent l'analyse de la page si
 * l'IA l'a jugée sous un autre objectif.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string; pageId: string }> }
) {
  try {
    const { auditId, pageId } = await params;
    const body = await req.json().catch(() => ({}));
    const goal = (body as { goal?: unknown }).goal;

    if (goal !== null && !(typeof goal === 'string' && PAGE_GOALS.includes(goal as PageGoal))) {
      return NextResponse.json({ error: 'goal invalide' }, { status: 400 });
    }

    await AuditService.setPageGoal(auditId, pageId, goal as PageGoal | null);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Erreur changement de l’objectif:', error);
    const notFound = error?.message === 'Page introuvable';
    return NextResponse.json({ error: error.message }, { status: notFound ? 404 : 500 });
  }
}
