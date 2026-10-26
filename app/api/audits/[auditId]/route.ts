import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;

    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      include: {
        project: true,
        pages: {
          orderBy: [{ isPillar: 'desc' }, { pageScore: 'desc' }]
        },
        issues: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!audit) {
      return NextResponse.json({ error: 'Audit introuvable' }, { status: 404 });
    }

    const formattedIssues = audit.issues.map((issue) => {
      let stepsToResolve: string[] = [];
      try {
        stepsToResolve = JSON.parse(issue.stepsToResolve);
      } catch {
        stepsToResolve = [issue.recommendation];
      }

      return {
        ...issue,
        stepsToResolve
      };
    });

    return NextResponse.json({
      audit: {
        ...audit,
        issues: formattedIssues
      }
    });
  } catch (error: any) {
    console.error('Erreur API audit details:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
