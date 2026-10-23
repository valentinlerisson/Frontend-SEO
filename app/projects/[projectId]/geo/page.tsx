import { redirect } from 'next/navigation'

type Props = {
  params: Promise<{ projectId: string }>
}

export default async function GeoRedirect({ params }: Props) {
  const { projectId } = await params
  redirect(`/projets/${projectId}/geo`)
}
