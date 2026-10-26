import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuditPresenter } from '@/adapters/primary/presenters/audit-presenter';
import { AuditService } from '@/core/services/audit-service';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // 1. Recherche du projet par id direct, ou par domaine
    let project = await prisma.project.findFirst({
      where: {
        OR: [
          { id: projectId },
          { domain: projectId },
          { domain: `${projectId}.fr` },
          { domain: `${projectId}.com` },
          { domain: projectId.replace(/-/g, '') + '.fr' },
        ],
      },
      include: {
        audits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            pages: {
              orderBy: [{ isPillar: 'desc' }, { pageScore: 'desc' }],
            },
            issues: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    // Si le projet n'existe pas encore (ex: premier accès sur big-happy), on lance le crawl initial
    if (!project) {
      const initialDomain = projectId.includes('.') ? projectId : `${projectId}.fr`;
      await AuditService.launchAudit(`https://${initialDomain}`);
      await new Promise((resolve) => setTimeout(resolve, 600));

      project = await prisma.project.findFirst({
        where: {
          OR: [
            { id: projectId },
            { domain: initialDomain },
            { domain: initialDomain.replace('www.', '') },
          ],
        },
        include: {
          audits: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              pages: {
                orderBy: [{ isPillar: 'desc' }, { pageScore: 'desc' }],
              },
              issues: {
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      });
    }

    if (!project || project.audits.length === 0) {
      return NextResponse.json({ error: 'Audit introuvable pour ce projet' }, { status: 404 });
    }

    const activeAudit = project.audits[0];

    // Transformation stricte via l'Hexagonal Presenter
    const presentedAudit = AuditPresenter.toProjectAuditData(activeAudit as any, {
      id: project.id,
      domain: project.domain,
      name: project.name,
    });

    return NextResponse.json({
      audit: presentedAudit,
      auditDbId: activeAudit.id,
      status: activeAudit.status,
      progress: activeAudit.progress,
    });
  } catch (error: any) {
    console.error('Erreur API /api/projects/[projectId]/audit:', error);
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 });
  }
}
