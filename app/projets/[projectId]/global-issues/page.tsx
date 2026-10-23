import type { Metadata } from 'next'
import { GlobalIssuesView } from '@/components/audit/global-issues-view'

type Props = {
  params: Promise<{ projectId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params
  return {
    title: `Global Issues & Tips — ${projectId}`,
    description: 'Anomalies calculées mécaniquement sur les pages explorées, classées par sévérité.',
  }
}

export default async function GlobalIssuesPage({ params }: Props) {
  const { projectId } = await params
  return <GlobalIssuesView projectId={projectId} />
}
