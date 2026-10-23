import { redirect } from 'next/navigation'

type Props = {
  params: Promise<{ projectId: string }>
}

export default async function IssuesRedirect({ params }: Props) {
  const { projectId } = await params
  redirect(`/projets/${projectId}/global-issues`)
}
