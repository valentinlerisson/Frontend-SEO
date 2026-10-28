import type { Metadata } from 'next'
import { BacklinksView } from '@/components/audit/backlinks-view'

type Props = {
  params: Promise<{ projectId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params
  return {
    title: `Backlinks — ${projectId}`,
    description: 'Sites qui font un lien vers le site audité, relevés pendant le crawl.',
  }
}

export default function BacklinksPage() {
  return <BacklinksView />
}
