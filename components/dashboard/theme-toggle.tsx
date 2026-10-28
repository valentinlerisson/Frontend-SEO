'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { THEME_STORAGE_KEY } from '@/lib/theme'

type Theme = 'dark' | 'light'

/** Bascule entre le thème sombre (par défaut) et le mode clair, mémorisée dans le navigateur */
export function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour cette page seulement
    }
    setTheme(next)
  }

  const label = theme === 'light' ? 'Mode sombre' : 'Mode clair'
  const Icon = theme === 'light' ? Moon : Sun
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={theme === 'light'}
        title={collapsed ? label : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span className={cn('truncate', collapsed && 'sr-only')}>{label}</span>
      </button>
    </li>
  )
}
