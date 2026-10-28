import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

/**
 * Lance l'analyse SERP de pages explorées (recherche Google dans un navigateur local, en arrière-plan).
 * Corps : { pageIds: string[], queries?: { [pageId]: requête } }. L'état de chaque page est lu ensuite via GET /api/projects/[id]/audit.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;
    const body = await req.json().catch(() => ({}));
    const pageIds: unknown = (body as { pageIds?: unknown }).pageIds;

    if (!Array.isArray(pageIds) || pageIds.length === 0 || pageIds.some((id) => typeof id !== 'string')) {
      return NextResponse.json({ error: 'pageIds doit être un tableau non vide d’identifiants' }, { status: 400 });
    }
    if (pageIds.length > 20) {
      return NextResponse.json({ error: '20 pages au maximum par lancement' }, { status: 400 });
    }

    // Requêtes saisies par l'utilisateur (120 caractères au plus), enregistrées comme requêtes manuelles
    const queries: Record<string, string> = {};
    const rawQueries = (body as { queries?: unknown }).queries;
    if (rawQueries && typeof rawQueries === 'object' && !Array.isArray(rawQueries)) {
      for (const [pageId, value] of Object.entries(rawQueries as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim() && value.length <= 120) queries[pageId] = value.trim();
      }
    }

    const result = await AuditService.startSerpAnalysis(auditId, pageIds as string[], { queries });
    if (!result.started) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ success: true, pages: result.pages }, { status: 202 });
  } catch (error: any) {
    console.error('Erreur analyse SERP:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
