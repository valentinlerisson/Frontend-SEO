import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuditService } from '@/core/services/audit-service';

export async function GET() {
  try {
    let projects = await prisma.project.findMany({
      include: {
        audits: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    // Seed initial si aucun projet n'existe encore
    if (projects.length === 0) {
      await AuditService.launchAudit('https://big-happy.fr');
      // Petit délai pour laisser le crawl initial générer les données
      await new Promise((resolve) => setTimeout(resolve, 800));

      projects = await prisma.project.findMany({
        include: {
          audits: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { updatedAt: 'desc' }
      });
    }

    const formatted = projects.map((p) => {
      const activeAudit = p.audits[0];
      return {
        id: p.id,
        name: p.name,
        domain: p.domain,
        faviconUrl: p.faviconUrl || `https://${p.domain}/favicon.ico`,
        overallScore: activeAudit?.overallScore ?? 78,
        techScore: activeAudit?.techScore ?? 84,
        editorialScore: activeAudit?.editorialScore ?? 74,
        geoScore: activeAudit?.geoScore ?? 76,
        status: activeAudit?.status === 'COMPLETED' ? 'Terminé' : 'En cours',
        auditStatus: activeAudit?.status ?? 'IDLE',
        progress: activeAudit?.progress ?? 0,
        activeAuditId: activeAudit?.id,
        createdAt: p.createdAt.toISOString()
      };
    });

    return NextResponse.json({ projects: formatted });
  } catch (error: any) {
    console.error('Erreur API /api/projects:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
