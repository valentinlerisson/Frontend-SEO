import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Une URL valide est requise' }, { status: 400 });
    }

    const result = await AuditService.launchAudit(url);

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
