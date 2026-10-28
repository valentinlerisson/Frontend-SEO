import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;
    const body = await req.json();
    const { pillarPageIds, targetQueries } = body;

    if (!Array.isArray(pillarPageIds)) {
      return NextResponse.json(
        { error: 'pillarPageIds doit être un tableau d’identifiants de pages' },
        { status: 400 }
      );
    }

    // Requêtes cibles saisies dans Subpages : { idPage: requête }, 120 caractères au plus
    const queries: Record<string, string> = {};
    if (targetQueries && typeof targetQueries === 'object' && !Array.isArray(targetQueries)) {
      for (const [pageId, value] of Object.entries(targetQueries as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim() && value.length <= 120) queries[pageId] = value.trim();
      }
    }

    const updatedAudit = await AuditService.selectPillarsAndAnalyze(auditId, pillarPageIds, queries);

    return NextResponse.json({
      success: true,
      message: `${pillarPageIds.length} pages piliers enregistrées et analysées`,
      audit: updatedAudit
    });
  } catch (error: any) {
    console.error('Erreur sélection piliers:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
