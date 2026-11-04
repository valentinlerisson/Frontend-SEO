import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

/** Avis de l'IA sur les résultats Google mesurés d'une page (à la demande, un appel au modèle) */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ auditId: string; pageId: string }> }) {
  try {
    const { auditId, pageId } = await params;
    return NextResponse.json(await AuditService.serpOpinion(auditId, pageId));
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Avis indisponible' }, { status: 400 });
  }
}
