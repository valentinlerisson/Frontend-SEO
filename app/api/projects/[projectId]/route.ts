import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // Suppression en cascade (gérée nativement par onDelete: Cascade dans Prisma)
    await prisma.project.deleteMany({
      where: {
        OR: [
          { id: projectId },
          { domain: projectId },
        ],
      },
    });

    return NextResponse.json({ success: true, message: 'Projet supprimé avec succès' });
  } catch (error: any) {
    console.error('Erreur suppression projet:', error);
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 });
  }
}
