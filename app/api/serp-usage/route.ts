import { NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

/** Recherches Google envoyées aujourd'hui, tous projets confondus (affichées avant un lancement de mesure) */
export async function GET() {
  try {
    return NextResponse.json({ usedToday: await AuditService.serpUsageToday() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Compteur illisible' }, { status: 500 });
  }
}
