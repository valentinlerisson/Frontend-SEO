import type { Metadata } from 'next'
import { IndividualIssueView } from '@/components/audit/individual-issue-view'

type Props = {
  params: Promise<{ projectId: string; issueId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId, issueId } = await params
  return {
    title: `Détail de l’anomalie ${issueId} — ${projectId}`,
    description: 'Liste détaillée des URLs impactées par cette anomalie et points de correction.',
  }
}

export default async function IndividualIssuePage({ params }: Props) {
  const { projectId, issueId } = await params
  return <IndividualIssueView projectId={projectId} issueId={issueId} />
}
