import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

/**
 * Ré-analyse éditoriale d'une page pilier.
 * Corps : { targetQuery?: string | null, force?: boolean }
 *  - targetQuery texte : requête cible manuelle (prioritaire sur la détection IA)
 *  - targetQuery null : retour à la détection automatique
 *  - targetQuery absent : requête inchangée
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string; pageId: string }> }
) {
  try {
    const { auditId, pageId } = await params;
    const body = await req.json().catch(() => ({}));

    const { targetQuery, force } = body as { targetQuery?: unknown; force?: unknown };
    if (targetQuery !== undefined && targetQuery !== null && typeof targetQuery !== 'string') {
      return NextResponse.json({ error: 'targetQuery doit être une chaîne ou null' }, { status: 400 });
    }
    if (typeof targetQuery === 'string' && targetQuery.length > 120) {
      return NextResponse.json({ error: 'targetQuery : 120 caractères maximum' }, { status: 400 });
    }

    await AuditService.reanalyzePage(auditId, pageId, {
      targetQuery: targetQuery as string | null | undefined,
      force: force === true
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Erreur ré-analyse éditoriale:', error);
    const notFound = error?.message === 'Page introuvable';
    return NextResponse.json({ error: error.message }, { status: notFound ? 404 : 500 });
  }
}
