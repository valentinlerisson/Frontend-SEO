import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

/**
 * Réécriture proposée des titres et sections de la page (un appel à l'IA, note inchangée).
 * Corps : { force?: boolean } (true : nouvelle proposition même si rien n'a changé).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string; pageId: string }> }
) {
  try {
    const { auditId, pageId } = await params;
    const body = (await req.json().catch(() => ({}))) as { force?: unknown };
    const rewrite = await AuditService.proposeRewrite(auditId, pageId, { force: body.force === true });
    return NextResponse.json({ success: true, rewrite });
  } catch (error: any) {
    console.error('Erreur réécriture proposée:', error);
    const notFound = error?.message === 'Page introuvable';
    return NextResponse.json({ error: error.message }, { status: notFound ? 404 : 500 });
  }
}
