import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';
import { chosenSerpQueries } from '@/core/domain/scoring/query-candidates';
import { MAX_MANUAL_QUERY_SET } from '@/core/domain/scoring/query-set';

/**
 * Fixe les requêtes notées d'une page. Corps : { queries: string[] | null } (null ou liste vide : retour au choix
 * automatique). 6 requêtes au plus ; note recalculée sans appel à l'IA.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string; pageId: string }> }
) {
  try {
    const { auditId, pageId } = await params;
    const body = (await req.json().catch(() => ({}))) as { queries?: unknown };
    if (body.queries !== null && !Array.isArray(body.queries)) {
      return NextResponse.json({ error: 'queries invalide' }, { status: 400 });
    }
    const queries = body.queries === null ? null : chosenSerpQueries(body.queries, MAX_MANUAL_QUERY_SET);
    await AuditService.setQuerySet(auditId, pageId, queries);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Erreur requêtes notées:', error);
    const notFound = error?.message === 'Page introuvable';
    return NextResponse.json({ error: error.message }, { status: notFound ? 404 : 500 });
  }
}
