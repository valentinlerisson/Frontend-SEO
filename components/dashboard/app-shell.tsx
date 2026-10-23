'use client'

import { useState } from 'react'
import { AppSidebar } from './app-sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="flex min-h-dvh bg-background">
      <AppSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
      <main className="flex min-w-0 flex-1 flex-col gap-8 px-4 py-6 md:px-8">{children}</main>
    </div>
  )
}
