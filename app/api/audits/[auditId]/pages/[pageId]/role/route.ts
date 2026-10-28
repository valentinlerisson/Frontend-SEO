import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';
import { PAGE_ROLES } from '@/core/domain/scoring/page-role';
import type { PageRole } from '@/core/domain/types';

/**
 * Corrige le rôle d'une page. Corps : { role: PageRole | null } (null : retour à la détection automatique).
 * Le score éditorial d'un pilier déjà analysé est recalculé sans nouvel appel à l'IA.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string; pageId: string }> }
) {
  try {
    const { auditId, pageId } = await params;
    const body = await req.json().catch(() => ({}));
    const role = (body as { role?: unknown }).role;

    if (role !== null && !(typeof role === 'string' && PAGE_ROLES.includes(role as PageRole))) {
      return NextResponse.json({ error: 'role invalide' }, { status: 400 });
    }

    await AuditService.setPageRole(auditId, pageId, role as PageRole | null);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Erreur correction du rôle:', error);
    const notFound = error?.message === 'Page introuvable';
    return NextResponse.json({ error: error.message }, { status: notFound ? 404 : 500 });
  }
}
