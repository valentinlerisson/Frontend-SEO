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
  PanelLeftClose,
  PanelLeftOpen,
  PenTool,
  Settings,
  Target,
  Link2,
  TriangleAlert,
  User,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProjects } from '@/components/providers/projects-provider'
import { globalScore, type Project } from '@/lib/projects'
import { ThemeToggle } from '@/components/dashboard/theme-toggle'

type NavItem = { label: string; href: string; icon: LucideIcon }

const mainNav: NavItem[] = [
  { label: 'Tableau de bord', href: '/', icon: House },
  { label: 'Mes projets', href: '/projets', icon: Folder },
]

/** Nombre de projets listés avant le lien « Voir tous les projets » */
const MAX_LISTED_PROJECTS = 5

type AppSidebarProps = {
  collapsed: boolean
  onToggle: () => void
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const pathname = usePathname()
  const { projects, loaded } = useProjects()

  // Projet actif : uniquement s'il existe réellement dans la base
  const pathParts = pathname.split('/')
  const urlProjectId = pathParts[1] === 'projets' ? pathParts[2] : undefined
  const activeProject = urlProjectId
    ? projects.find((p) => p.id === urlProjectId || p.domain === urlProjectId)
    : undefined

  // Projets les plus récents ; le projet ouvert reste toujours visible
  const recent = [...projects].sort((a, b) => a.lastAuditMinutesAgo - b.lastAuditMinutesAgo)
  const listed = recent.slice(0, MAX_LISTED_PROJECTS)
  if (activeProject && !listed.some((p) => p.id === activeProject.id)) listed.push(activeProject)

  return (
    <aside
      aria-label="Navigation principale"
      className={cn(
        'glass sticky top-0 z-30 flex h-dvh shrink-0 flex-col border-r border-r-sidebar-border text-sidebar-foreground transition-[width] duration-300',
        collapsed ? 'w-[72px]' : 'w-64',
      )}
    >
      {/* En-tête : logo et repli du menu */}
      <div className={cn('flex items-center gap-3 px-4 pt-5', collapsed && 'flex-col px-0')}>
        <Link href="/" aria-label="Tableau de bord" className="flex min-w-0 items-center gap-3">
          <Logo />
          {!collapsed && (
            <span className="truncate text-xl font-semibold tracking-tight">
              BigApp <span className="text-primary-ink">SEO</span>
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            !collapsed && 'ml-auto',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-5" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-5" aria-hidden="true" />
          )}
        </button>
      </div>

      <nav className="mt-6 flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4">
        <NavSection title="Menu" collapsed={collapsed}>
          {mainNav.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} collapsed={collapsed} />
          ))}
        </NavSection>

        <NavSection title="Projets" collapsed={collapsed}>
          {listed.map((project) => (
            <ProjectEntry
              key={project.id}
              project={project}
              active={activeProject?.id === project.id}
              pathname={pathname}
              collapsed={collapsed}
            />
          ))}
          {!collapsed && projects.length > listed.length && (
            <li className="list-none">
              <Link href="/projets" className="block px-3 py-1.5 text-xs text-muted-foreground hover:text-primary-ink">
                Voir tous les projets ({projects.length})
              </Link>
            </li>
          )}
          {loaded && projects.length === 0 && !collapsed && (
            <li className="list-none px-3 py-2 text-sm text-muted-foreground">
              Aucun projet. Lancez un audit depuis le tableau de bord.
            </li>
          )}
        </NavSection>
      </nav>

      <div className="border-t border-sidebar-border px-3 py-3">
        <ul className="flex flex-col gap-1">
          <NavLink
            item={{ label: 'Paramètres', href: '/parametres', icon: Settings }}
            active={pathname === '/parametres'}
            collapsed={collapsed}
          />
          <ThemeToggle collapsed={collapsed} />
        </ul>
        <ProfileMenu collapsed={collapsed} />
      </div>
    </aside>
  )
}

function Logo() {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-black text-primary-foreground"
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
          'mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
          collapsed && 'sr-only',
        )}
      >
        {title}
      </p>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  )
}

function NavLink({
  item,
  active,
  collapsed,
  nested = false,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  nested?: boolean
}) {
  const Icon = item.icon
  return (
    <li className="list-none">
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          'relative flex items-center gap-3 rounded-lg px-3 text-sm transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
          nested ? 'py-1.5' : 'py-2',
          active ? 'bg-sidebar-accent font-semibold text-foreground' : 'text-sidebar-foreground/80',
          collapsed && 'justify-center px-0',
        )}
      >
        {active && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" />}
        <Icon
          className={cn('size-[18px] shrink-0', active ? 'text-primary-ink' : 'text-muted-foreground')}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
      </Link>
    </li>
  )
}

/** Pastille de score global du projet : couleur selon le niveau, tiret tant qu'aucun score n'est calculé */
function ScoreDot({ project }: { project: Project }) {
  const score = globalScore(project.scores)
  return (
    <span
      className={cn(
        'ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        score === null
          ? 'text-muted-foreground'
          : score >= 80
            ? 'bg-[#12b10f]/15 text-green-soft'
            : score >= 50
              ? 'bg-[#eab308]/15 text-amber-soft'
              : 'bg-[#ef4444]/15 text-red-soft',
      )}
      title={score === null ? 'Score pas encore calculé' : `Score global ${score}/100`}
    >
      {score ?? '–'}
    </span>
  )
}

/** Projet de la liste ; le projet ouvert affiche ses onglets de résultats en dessous */
function ProjectEntry({
  project,
  active,
  pathname,
  collapsed,
}: {
  project: Project
  active: boolean
  pathname: string
  collapsed: boolean
}) {
  const base = `/projets/${project.id}`
  const resultNav: NavItem[] = [
    { label: 'Synthèse', href: `${base}/synthese`, icon: ChartNoAxesColumn },
    { label: 'Anomalies', href: `${base}/global-issues`, icon: TriangleAlert },
    { label: 'Sous-pages', href: `${base}/subpages`, icon: BookOpen },
    { label: 'SEO éditorial', href: `${base}/seo-editorial`, icon: PenTool },
    { label: 'Positionnement', href: `${base}/positionnement`, icon: Target },
    { label: 'Backlinks', href: `${base}/backlinks`, icon: Link2 },
    { label: 'GEO', href: `${base}/geo`, icon: Bot },
  ]

  return (
    <li className="list-none">
      <Link
        href={`${base}/synthese`}
        title={collapsed ? project.domain : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
          active ? 'text-foreground' : 'text-sidebar-foreground/80',
          collapsed && 'justify-center px-0',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold uppercase',
            active ? 'bg-primary text-primary-foreground' : 'bg-shade-33 text-muted-foreground',
          )}
        >
          {project.domain.replace(/^www\./, '').charAt(0)}
        </span>
        <span className={cn('min-w-0 truncate', collapsed && 'sr-only')}>{project.domain}</span>
        {!collapsed && <ScoreDot project={project} />}
      </Link>

      {active && (
        <ul className={cn('mt-0.5 flex flex-col gap-0.5', !collapsed && 'ml-5 border-l border-sidebar-border pl-2')}>
          {resultNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              nested
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              collapsed={collapsed}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function ProfileMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-2 focus-visible:outline-ring',
          collapsed && 'justify-center px-0',
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted-foreground/40 text-muted-foreground"
        >
          <User className="size-4" />
        </span>
        <span className={cn('flex-1', collapsed && 'sr-only')}>Profil</span>
        {!collapsed && (
          <ChevronDown
            className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="glass-panel absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg border p-1"
        >
          <Link
            role="menuitem"
            href="/parametres"
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
