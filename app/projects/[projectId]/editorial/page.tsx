import { redirect } from 'next/navigation'

type Props = {
  params: Promise<{ projectId: string }>
}

export default async function EditorialRedirect({ params }: Props) {
  const { projectId } = await params
  redirect(`/projets/${projectId}/seo-editorial`)
}
