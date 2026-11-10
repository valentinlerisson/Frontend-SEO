import { NextRequest, NextResponse } from 'next/server';
import { BacklinkDiscoveryService } from '@/core/services/backlink-discovery-service';

/**
 * Lance la recherche des liens précis du dernier audit (recherches Google dans un navigateur local, puis lecture des
 * pages trouvées, en arrière-plan). Corps : { budget?: { perRun, perDay } } (plafonds des Paramètres, bornés côté
 * serveur). Le résultat est lu ensuite avec le relevé de backlinks : GET /api/projects/[id]/audit.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await req.json().catch(() => ({}));
    const rawBudget = (body as { budget?: { perRun?: unknown; perDay?: unknown } }).budget;
    const result = await BacklinkDiscoveryService.start(projectId, {
      budget: rawBudget && typeof rawBudget === 'object' ? { perRun: Number(rawBudget.perRun), perDay: Number(rawBudget.perDay) } : undefined
    });
    if (!result.started) return NextResponse.json({ error: result.reason }, { status: 409 });
    return NextResponse.json({ success: true, searches: result.searches, remainingToday: result.remainingToday }, { status: 202 });
  } catch (error: any) {
    console.error('Erreur recherche des liens précis:', error);
    return NextResponse.json({ error: error?.message || 'Recherche impossible' }, { status: 500 });
  }
}
