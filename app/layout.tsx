import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AppShell } from '@/components/dashboard/app-shell'
import { ProjectsProvider } from '@/components/providers/projects-provider'
import { SettingsProvider } from '@/components/providers/settings-provider'
import { InspectionProvider } from '@/components/providers/inspection-provider'
import { THEME_STORAGE_KEY } from '@/lib/theme'
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
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#f4f4f5' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Applique le thème choisi avant l'affichage, pour éviter un flash du thème sombre */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='light')document.documentElement.dataset.theme='light'}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">
        <SettingsProvider>
          <ProjectsProvider>
            <InspectionProvider>
              <AppShell>{children}</AppShell>
            </InspectionProvider>
          </ProjectsProvider>
        </SettingsProvider>
      </body>
    </html>
  )
}
