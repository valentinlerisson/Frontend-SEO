import type { Metadata } from 'next'
import { PositioningView } from '@/components/audit/positioning-view'

type Props = {
  params: Promise<{ projectId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params
  return {
    title: `Positionnement Google — ${projectId}`,
    description: 'Position de vos pages piliers dans les résultats Google et concurrents de chaque requête cible.',
  }
}

export default async function PositioningPage({ params }: Props) {
  const { projectId } = await params
  return <PositioningView projectId={projectId} />
}
