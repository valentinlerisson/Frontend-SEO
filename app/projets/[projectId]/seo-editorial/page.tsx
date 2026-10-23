import type { Metadata } from 'next'
import { SeoEditorialView } from '@/components/audit/seo-editorial-view'

type Props = {
  params: Promise<{ projectId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params
  return {
    title: `SEO Éditorial — ${projectId}`,
    description: 'Analyse qualitative générée par IA (Claude 3.5 Sonnet) sur vos pages stratégiques.',
  }
}

export default async function SeoEditorialPage({ params }: Props) {
  const { projectId } = await params
  return <SeoEditorialView projectId={projectId} />
}
