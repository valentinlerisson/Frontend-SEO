import type { Metadata } from 'next'
import { ProjectsView } from '@/components/projects/projects-view'

export const metadata: Metadata = {
  title: 'Mes Projets',
  description: 'Gérez et suivez l’état de vos audits SEO & GEO : ouvrir, relancer ou supprimer un projet.',
}

export default function ProjectsPage() {
  return <ProjectsView />
}
