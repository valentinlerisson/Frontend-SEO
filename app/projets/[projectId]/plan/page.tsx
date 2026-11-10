import type { Metadata } from 'next'
import { FixPlanView } from '@/components/audit/fix-plan-view'

type Props = {
  params: Promise<{ projectId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params
  return {
    title: `Plan d’action — ${projectId}`,
    description: 'Corrections à faire, une tâche par anomalie et par page : à corriger, en cours, terminées.',
  }
}

export default async function PlanPage({ params }: Props) {
  const { projectId } = await params
  return <FixPlanView projectId={projectId} />
}
