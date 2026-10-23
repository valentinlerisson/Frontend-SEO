import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AppShell } from '@/components/dashboard/app-shell'
import { ProjectsProvider } from '@/components/providers/projects-provider'
import { InspectionProvider } from '@/components/providers/inspection-provider'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: {
    default: 'Auditly - BigApp SEO',
    template: '%s — Auditly',
  },
  description:
    'Lancez des audits SEO & GEO à partir d’une URL, suivez vos projets actifs et accédez aux résultats de vos derniers audits.',
  openGraph: {
    title: 'Auditly - BigApp SEO',
    description:
      'Lancez des audits SEO & GEO à partir d’une URL, suivez vos projets actifs et accédez aux résultats de vos derniers audits.',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#000000',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="antialiased">
        <ProjectsProvider>
          <InspectionProvider>
            <AppShell>{children}</AppShell>
          </InspectionProvider>
        </ProjectsProvider>
      </body>
    </html>
  )
}
