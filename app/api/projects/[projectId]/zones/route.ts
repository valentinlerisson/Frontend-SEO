import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';
import { GEO_ZONE_KINDS as KINDS } from '@/core/domain/zones';

/** Zones ciblées du projet. Corps : { zones: [{ kind, code }] } (3 au plus), validées et complétées côté serveur */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body?.zones) ? body.zones : null;
    if (!raw) return NextResponse.json({ error: 'zones doit être un tableau' }, { status: 400 });
    const refs = raw
      .filter((zone: any) => KINDS.includes(zone?.kind) && typeof zone?.code === 'string')
      .map((zone: any) => ({ kind: zone.kind, code: zone.code }));
    const zones = await AuditService.setProjectZones(projectId, refs);
    return NextResponse.json({ zones });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Enregistrement impossible' }, { status: 400 });
  }
}
