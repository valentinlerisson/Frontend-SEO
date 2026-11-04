import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, scope, maxPages } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Une URL valide est requise' }, { status: 400 });
    }

    // Périmètre et plafond de pages : validés et bornés par resolveCrawlScope
    const result = await AuditService.launchAudit(url, {
      scope: scope && typeof scope === 'object' ? scope : undefined,
      maxPages: typeof maxPages === 'number' ? maxPages : undefined
    });

    return NextResponse.json({
      success: true,
      message: 'Audit démarré avec succès',
      data: result
    });
  } catch (error: any) {
    console.error('Erreur lancement audit:', error);
    return NextResponse.json({ error: error.message || 'Erreur interne' }, { status: 500 });
  }
}
