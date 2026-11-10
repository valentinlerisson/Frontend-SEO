import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

/**
 * Recherches hors page : l'IA propose des recherches absentes du contenu, Keyword Planner donne leur volume et le code
 * dit si la page peut les porter. Un appel à l'IA ; note inchangée (une recherche n'est notée que cochée).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string; pageId: string }> }
) {
  try {
    const { auditId, pageId } = await params;
    const opportunities = await AuditService.researchKeywordOpportunities(auditId, pageId);
    return NextResponse.json({ success: true, opportunities });
  } catch (error: any) {
    console.error('Erreur recherches hors page:', error);
    const notFound = error?.message === 'Page introuvable';
    return NextResponse.json({ error: error.message }, { status: notFound ? 404 : 500 });
  }
}
