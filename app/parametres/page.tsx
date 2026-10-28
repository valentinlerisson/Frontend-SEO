import type { Metadata } from 'next'
import { SettingsView } from '@/components/settings/settings-view'

export const metadata: Metadata = {
  title: 'Paramètres',
  description: 'Réglages de l’application, dont le plafond de pages analysables par l’IA.',
}

export default function SettingsPage() {
  return <SettingsView />
}
