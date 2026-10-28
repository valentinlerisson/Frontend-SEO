import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { AuditProvider } from '@/components/providers/audit-provider'

// Le projet doit exister en base à chaque requête
export const dynamic = 'force-dynamic'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  const project = await prisma.project.findFirst({
    where: { OR: [{ id: projectId }, { domain: projectId }] },
    select: { id: true },
  })
  if (!project) notFound()

  return <AuditProvider projectId={projectId}>{children}</AuditProvider>
}
