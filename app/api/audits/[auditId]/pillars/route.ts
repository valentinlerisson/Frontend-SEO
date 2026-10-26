import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;
    const body = await req.json();
    const { pillarPageIds } = body;

    if (!Array.isArray(pillarPageIds)) {
      return NextResponse.json(
        { error: 'pillarPageIds doit être un tableau d’identifiants de pages' },
        { status: 400 }
      );
    }

    const updatedAudit = await AuditService.selectPillarsAndAnalyze(auditId, pillarPageIds);

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
