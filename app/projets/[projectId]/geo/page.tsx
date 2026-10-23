import type { Metadata } from 'next'
import { GeoView } from '@/components/audit/geo-view'

type Props = {
  params: Promise<{ projectId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params
  return {
    title: `GEO (Generative Engine Optimization) — ${projectId}`,
    description: 'Évaluation de la citabilité de votre contenu par les moteurs de réponse IA et agents autonomes.',
  }
}

export default async function GeoPage({ params }: Props) {
  const { projectId } = await params
  return <GeoView projectId={projectId} />
}
