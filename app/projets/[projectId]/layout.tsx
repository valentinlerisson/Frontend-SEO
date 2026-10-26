import { AuditProvider } from '@/components/providers/audit-provider'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <AuditProvider projectId={projectId}>{children}</AuditProvider>
}
