import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';
import { GEO_ZONE_KINDS as KINDS } from '@/core/domain/zones';

/** Zone propre à une page. Corps : { url, zone: { kind, code } | null } (null : retour aux zones du projet) */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await req.json().catch(() => ({}));
    if (typeof body?.url !== 'string') return NextResponse.json({ error: 'url requise' }, { status: 400 });
    const ref = body.zone && KINDS.includes(body.zone.kind) && typeof body.zone.code === 'string' ? { kind: body.zone.kind, code: body.zone.code } : null;
    const zone = await AuditService.setPageZone(projectId, body.url, ref);
    return NextResponse.json({ zone });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Enregistrement impossible' }, { status: 400 });
  }
}
