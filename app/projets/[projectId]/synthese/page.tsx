import type { Metadata } from 'next'
import { SynthesisView } from '@/components/audit/synthesis-view'

type Props = {
  params: Promise<{ projectId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params
  return {
    title: `Synthèse de l’audit — ${projectId}`,
    description: 'Score global, répartition des 3 piliers (Technique, Éditorial, GEO) et conseils prioritaires.',
  }
}

export default async function SynthesePage({ params }: Props) {
  const { projectId } = await params
  return <SynthesisView projectId={projectId} />
}
