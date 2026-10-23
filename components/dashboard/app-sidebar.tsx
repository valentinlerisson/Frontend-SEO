'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  BookOpen,
  Bot,
  ChartNoAxesColumn,
  ChevronDown,
  Folder,
  House,
  LogOut,
  Menu,
  PenTool,
  Settings,
  User,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type NavItem = { label: string; href: string; icon: LucideIcon }

const mainNav: NavItem[] = [
  { label: 'Tableau de bord', href: '/', icon: House },
  { label: 'Mes Projets', href: '/projets', icon: Folder },
]

type AppSidebarProps = {
  collapsed: boolean
  onToggle: () => void
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const pathname = usePathname()

  // Dynamically resolve active project from URL or default to big-happy
  let currentProjectId = 'big-happy'
  let currentResultDomain = 'bighappy.fr'

  const pathParts = pathname.split('/')
  if (pathParts[1] === 'projets' && pathParts[2] && pathParts[2] !== 'synthese') {
    currentProjectId = pathParts[2]
    currentResultDomain = currentProjectId === 'big-happy' ? 'bighappy.fr' : `${currentProjectId}.fr`
  }

  const resultBase = `/projets/${currentProjectId}`

  const resultNav: NavItem[] = [
    { label: 'Synthèse', href: `${resultBase}/synthese`, icon: ChartNoAxesColumn },
    { label: 'Global Issues', href: `${resultBase}/global-issues`, icon: X },
    { label: 'Subpages', href: `${resultBase}/subpages`, icon: BookOpen },
    { label: 'SEO Editorial', href: `${resultBase}/seo-editorial`, icon: PenTool },
    { label: 'GEO', href: `${resultBase}/geo`, icon: Bot },
  ]

  return (
    <aside
      aria-label="Navigation principale"
      className={cn(
        'sticky top-0 flex h-dvh shrink-0 flex-col border border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300',
        collapsed ? 'w-20' : 'w-64',
      )}
    >
      <div className="flex items-center gap-4 px-4 pt-5">
        <Logo />
        {!collapsed && (
          <span className="text-2xl font-semibold tracking-tight">
            BigApp <span className="text-primary">SEO</span>
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
        aria-expanded={!collapsed}
        className="mx-4 mt-6 flex size-10 items-center justify-center rounded-md text-primary transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Menu className="size-7" strokeWidth={2} aria-hidden="true" />
      </button>

      <nav className="mt-6 flex flex-1 flex-col overflow-y-auto px-3">
        <NavSection title="Menu Principal" collapsed={collapsed}>
          {mainNav.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} collapsed={collapsed} />
          ))}
        </NavSection>

        <hr className="mx-1 my-6 border-sidebar-border" />

        <NavSection title={`Résultat ${currentResultDomain}`} collapsed={collapsed}>
          {resultNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              collapsed={collapsed}
            />
          ))}
        </NavSection>
      </nav>

      <div className="px-3 pb-4">
        <hr className="mx-1 mb-4 border-sidebar-border" />
        <NavLink
          item={{ label: 'Paramètres', href: '/parametres', icon: Settings }}
          active={pathname === '/parametres'}
          collapsed={collapsed}
        />
        <ProfileMenu collapsed={collapsed} />
      </div>
    </aside>
  )
}

function Logo() {
  return (
    <span
      aria-hidden="true"
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-2xl font-black text-primary-foreground"
    >
      B
    </span>
  )
}

function NavSection({
  title,
  collapsed,
  children,
}: {
  title: string
  collapsed: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <p
        className={cn(
          'mb-3 px-2 text-base text-muted-foreground',
          collapsed && 'sr-only',
        )}
      >
        {title}
      </p>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  )
}

function NavLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon
  return (
    <li className="list-none">
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-lg transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-2 focus-visible:outline-ring',
          active && 'bg-sidebar-accent hover:bg-sidebar-accent',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
      </Link>
    </li>
  )
}

function ProfileMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex w-full items-center gap-4 rounded-lg px-1 py-1.5 text-left text-lg transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-2 focus-visible:outline-ring',
          collapsed && 'justify-center',
        )}
      >
        <span aria-hidden="true" className="size-9 shrink-0 rounded-full bg-muted-foreground/60" />
        <span className={cn('flex-1', collapsed && 'sr-only')}>Profil</span>
        {!collapsed && (
          <ChevronDown
            className={cn('mr-2 size-5 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          <Link
            role="menuitem"
            href="/profil"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
          >
            <User className="size-4" aria-hidden="true" />
            Mon profil
          </Link>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Déconnexion
          </button>
        </div>
      )}
    </div>
  )
}
