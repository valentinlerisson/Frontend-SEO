import type { Metadata } from 'next'
import { SubpagesView } from '@/components/audit/subpages-view'

type Props = {
  params: Promise<{ projectId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params
  return {
    title: `Subpages — ${projectId}`,
    description: 'Tableau des pages explorées par le crawler mobile et sélection des pages piliers pour analyse IA.',
  }
}

export default async function SubpagesPage({ params }: Props) {
  const { projectId } = await params
  return <SubpagesView projectId={projectId} />
}
