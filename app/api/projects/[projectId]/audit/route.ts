import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuditPresenter } from '@/adapters/primary/presenters/audit-presenter';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // Lecture seule : un crawl ne démarre que via POST /api/audits/launch
    const project = await prisma.project.findFirst({
      where: {
        OR: [{ id: projectId }, { domain: projectId }],
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

    if (!project || project.audits.length === 0) {
      return NextResponse.json({ error: 'Projet introuvable' }, { status: 404 });
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
      errorMessage: activeAudit.errorMessage,
    });
  } catch (error: any) {
    console.error('Erreur API /api/projects/[projectId]/audit:', error);
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 });
  }
}
