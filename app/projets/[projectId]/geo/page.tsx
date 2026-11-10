import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { GeoView } from '@/components/audit/geo-view'
import { GEO_ENABLED } from '@/core/domain/features'

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
  // GEO mis de côté : l'écran reste dans le code, l'adresse renvoie vers la synthèse
  if (!GEO_ENABLED) redirect(`/projets/${projectId}/synthese`)
  return <GeoView projectId={projectId} />
}
