import { redirect } from 'next/navigation'

type Props = {
  params: Promise<{ projectId: string }>
}

export default async function OverviewRedirect({ params }: Props) {
  const { projectId } = await params
  redirect(`/projets/${projectId}/synthese`)
}
