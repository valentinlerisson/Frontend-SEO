import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

type Params = { params: Promise<{ auditId: string; pageId: string }> };

/**
 * Capture PageSpeed Insights de la page (vue mobile).
 * GET : description de la capture ({ configured, meta }) ; GET ?image=final|full : l'image elle-même.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { auditId, pageId } = await params;
    const kind = req.nextUrl.searchParams.get('image');
    if (kind === 'final' || kind === 'full') {
      const image = await AuditService.pageScreenshotImage(auditId, pageId, kind);
      if (!image) return NextResponse.json({ error: 'Capture absente' }, { status: 404 });
      return new NextResponse(new Uint8Array(image.bytes), {
        headers: { 'Content-Type': image.type, 'Cache-Control': 'private, max-age=300' }
      });
    }
    return NextResponse.json(await AuditService.pageScreenshot(auditId, pageId));
  } catch (error: any) {
    const notFound = error?.message === 'Page introuvable';
    return NextResponse.json({ error: error.message }, { status: notFound ? 404 : 500 });
  }
}

/** Nouvelle capture par PageSpeed Insights (20 à 60 s) ; la note de la page ne change pas */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { auditId, pageId } = await params;
    const meta = await AuditService.capturePageScreenshot(auditId, pageId);
    return NextResponse.json({ success: true, meta });
  } catch (error: any) {
    console.error('Erreur capture PageSpeed:', error);
    const notFound = error?.message === 'Page introuvable';
    return NextResponse.json({ error: error.message }, { status: notFound ? 404 : 500 });
  }
}
