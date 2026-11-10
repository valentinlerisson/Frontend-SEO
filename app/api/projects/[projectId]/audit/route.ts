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
    // Travaux interrompus (serveur arrêté pendant une exploration, une analyse IA ou une mesure Google) remis en état
    const latest = await prisma.audit.findFirst({
      where: { project: { OR: [{ id: projectId }, { domain: projectId }] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (latest) await AuditService.recoverInterrupted(latest.id).catch((err) => console.error('Reprise après interruption impossible:', err))

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

    // Audits terminés précédents : évolution des notes, et notes de chaque page à l'audit terminé le plus récent
    const previousAudits = await prisma.audit.findMany({
      where: { projectId: project.id, id: { not: activeAudit.id }, status: 'COMPLETED', createdAt: { lt: activeAudit.createdAt } },
      orderBy: { createdAt: 'desc' },
      take: 7,
      select: { id: true, overallScore: true, techScore: true, editorialScore: true, geoScore: true, completedAt: true, createdAt: true },
    })
    const round = (value: number | null) => (value === null ? null : Math.round(value))
    const lastPrevious = previousAudits[0]
    const previousPages = lastPrevious
      ? await prisma.page.findMany({
          where: { auditId: lastPrevious.id },
          select: { url: true, techScore: true, editorialScore: true, geoScore: true, isPillar: true },
        })
      : []

    // Transformation stricte via l'Hexagonal Presenter
    const presentedAudit = AuditPresenter.toProjectAuditData(activeAudit as any, {
      id: project.id,
      domain: project.domain,
      name: project.name,
      zonesRaw: project.zonesRaw,
      pageZonesRaw: project.pageZonesRaw,
    }, {
      audits: [...previousAudits].reverse().map((item) => ({
        date: (item.completedAt ?? item.createdAt).toISOString(),
        global: round(item.overallScore),
        tech: round(item.techScore),
        editorial: round(item.editorialScore),
        geo: round(item.geoScore),
      })),
      ...(lastPrevious
        ? { previousPages: { date: (lastPrevious.completedAt ?? lastPrevious.createdAt).toISOString(), pages: previousPages } }
        : {}),
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
