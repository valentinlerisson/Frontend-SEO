import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/core/services/audit-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Audits restés « en cours » après un arrêt du serveur : remis en état avant l'affichage des projets
    await AuditService.recoverInterrupted().catch((err) => console.error('Reprise après interruption impossible:', err));
    const projects = await prisma.project.findMany({
      include: {
        audits: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const formatted = projects.map((p) => {
      const activeAudit = p.audits[0];
      const isCompleted = activeAudit?.status === 'COMPLETED';
      return {
        id: p.id,
        name: p.name,
        domain: p.domain,
        faviconUrl: p.faviconUrl || `https://${p.domain}/favicon.ico`,
        // Scores éditorial, GEO et global verrouillés tant que l'audit n'est pas COMPLETED
        overallScore: isCompleted ? activeAudit?.overallScore ?? null : null,
        techScore: activeAudit?.techScore ?? null,
        editorialScore: isCompleted ? activeAudit?.editorialScore ?? null : null,
        geoScore: isCompleted ? activeAudit?.geoScore ?? null : null,
        status: isCompleted ? 'Terminé' : 'En cours',
        auditStatus: activeAudit?.status ?? 'IDLE',
        progress: activeAudit?.progress ?? 0,
        activeAuditId: activeAudit?.id,
        lastAuditAt: (activeAudit?.completedAt ?? activeAudit?.updatedAt)?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString()
      };
    });

    return NextResponse.json({ projects: formatted });
  } catch (error: any) {
    console.error('Erreur API /api/projects:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
