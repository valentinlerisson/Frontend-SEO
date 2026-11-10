'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AppSidebar } from './app-sidebar'
import { useInspection } from '@/components/providers/inspection-provider'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { isOpen, width, panelPresent } = useInspection()
  // Fiche réellement affichée à côté de la liste (l'écran courant en a une et elle est ouverte)
  const docked = isOpen && panelPresent

  // Fiche d'une page ouverte à côté de la liste : le menu passe en icônes pour laisser la place à la liste, et revient
  // à la fermeture s'il était déplié avant
  const collapsedForPanel = useRef(false)
  useEffect(() => {
    if (docked && !sidebarCollapsed) {
      collapsedForPanel.current = true
      setSidebarCollapsed(true)
    } else if (!docked && collapsedForPanel.current) {
      collapsedForPanel.current = false
      setSidebarCollapsed(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked])

  return (
    <div className="ambient-backdrop flex min-h-dvh bg-background">
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => {
          // Choix de l'utilisateur pendant que la fiche est ouverte : il est gardé à la fermeture
          collapsedForPanel.current = false
          setSidebarCollapsed((value) => !value)
        }}
      />
      {/* Fiche d'une page ouverte : côte à côte avec la liste sur un écran large, le contenu lui laisse la place */}
      <main
        style={{ '--inspection-pad': docked ? `${width + 12}px` : '0px' } as CSSProperties}
        // Sans animation de la marge : un tableau large se redessinerait à chaque image (ombres et colonnes en retard)
        className="flex min-w-0 flex-1 flex-col gap-8 px-4 pt-3 pb-6 md:px-8 lg:pr-[calc(var(--inspection-pad)+2rem)]"
      >
        {children}
      </main>
    </div>
  )
}
