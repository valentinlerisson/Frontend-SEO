import { redirect } from 'next/navigation'

type Props = {
  params: Promise<{ projectId: string }>
}

export default async function SubpagesRedirect({ params }: Props) {
  const { projectId } = await params
  redirect(`/projets/${projectId}/subpages`)
}
