import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

/**
 * Recherche (ou actualise) les mots-clés de la page et leur volume de recherche. Aucun appel à l'IA, note inchangée.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string; pageId: string }> }
) {
  try {
    const { auditId, pageId } = await params;
    const keywords = await AuditService.researchKeywords(auditId, pageId);
    return NextResponse.json({ success: true, keywords });
  } catch (error: any) {
    console.error('Erreur recherche des mots-clés:', error);
    const notFound = error?.message === 'Page introuvable';
    return NextResponse.json({ error: error.message }, { status: notFound ? 404 : 500 });
  }
}
