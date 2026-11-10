'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { GEO_ENABLED } from '@/core/domain/features'

export type InspectionTab = 'essentials' | 'tech' | 'editorial' | 'geo' | 'serp'

type InspectionContextType = {
  isOpen: boolean
  pageId: string | null
  tab: InspectionTab
  /** Index de l'accordéon à ouvrir dans l'onglet (?section=), null si non précisé */
  section: number | null
  openInspection: (pageId: string, tab?: InspectionTab, section?: number) => void
  closeInspection: () => void
  setTab: (tab: InspectionTab) => void
  /** Largeur du panneau de la fiche, côte à côte avec la liste (écran large) */
  width: number
  setWidth: (width: number) => void
  /** Pages de la liste affichée, dans son ordre : ↑ ↓ du panneau et touches J / K */
  navigation: string[]
  setNavigation: (ids: string[]) => void
  /** Page suivante (1) ou précédente (−1) de la liste ; panneau fermé : déplace la ligne active */
  step: (delta: 1 | -1) => void
  /** Ligne active : la page ouverte, sinon la ligne choisie au clavier (J / K, Entrée pour l'ouvrir) */
  activeId: string | null
  /** La fiche est réellement affichée par l'écran courant (tous les écrans n'en ont pas) */
  panelPresent: boolean
  setPanelPresent: (present: boolean) => void
}

const InspectionContext = createContext<InspectionContextType | null>(null)

/** Onglet « Moteurs IA » masqué tant que le GEO est mis de côté : un lien vers lui ouvre « L'essentiel » */
const visibleTab = (tab: InspectionTab): InspectionTab => (tab === 'geo' && !GEO_ENABLED ? 'essentials' : tab)

const WIDTH_KEY = 'auditly:fiche-largeur'
export const DEFAULT_PANEL_WIDTH = 560
export const MIN_PANEL_WIDTH = 420

/** Saisie en cours (champ, liste, zone éditable) ou fenêtre modale ouverte : les raccourcis de la liste se taisent */
function shortcutsBlocked(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return true
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]'))
}

export function InspectionProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [pageId, setPageId] = useState<string | null>(null)
  const [tab, setTabState] = useState<InspectionTab>('essentials')
  const [section, setSection] = useState<number | null>(null)
  const [width, setWidthState] = useState(DEFAULT_PANEL_WIDTH)
  const [navigation, setNavigationState] = useState<string[]>([])
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [panelPresent, setPanelPresent] = useState(false)

  // Changement d'écran dans l'application : la fiche se ferme (sauf si la nouvelle adresse en demande une), la liste et
  // la ligne active sont oubliées
  const pathname = usePathname()
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    const url = new URL(window.location.href)
    const inspect = url.searchParams.get('inspect')
    setCursorId(null)
    if (inspect) {
      const tabParam = url.searchParams.get('tab') as InspectionTab | null
      const sectionParam = parseInt(url.searchParams.get('section') ?? '', 10)
      setPageId(inspect)
      setTabState(tabParam && ['essentials', 'tech', 'editorial', 'geo', 'serp'].includes(tabParam) ? visibleTab(tabParam) : 'essentials')
      setSection(Number.isNaN(sectionParam) ? null : sectionParam)
      setIsOpen(true)
    } else {
      setIsOpen(false)
      setPageId(null)
      setSection(null)
    }
  }, [pathname])

  // Check URL on initial mount or popstate
  useEffect(() => {
    const checkUrl = () => {
      const url = new URL(window.location.href)
      const inspect = url.searchParams.get('inspect')
      const tabParam = url.searchParams.get('tab') as InspectionTab | null
      const sectionParam = url.searchParams.get('section')

      if (inspect) {
        setPageId(inspect)
        setIsOpen(true)
        if (tabParam && ['essentials', 'tech', 'editorial', 'geo', 'serp'].includes(tabParam)) {
          setTabState(visibleTab(tabParam))
        }
        const parsedSection = sectionParam !== null ? parseInt(sectionParam, 10) : NaN
        setSection(Number.isNaN(parsedSection) ? null : parsedSection)
      } else {
        setIsOpen(false)
        setPageId(null)
      }
    }

    checkUrl()
    window.addEventListener('popstate', checkUrl)
    return () => window.removeEventListener('popstate', checkUrl)
  }, [])

  // Largeur du panneau gardée dans ce navigateur
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(WIDTH_KEY))
      if (saved >= MIN_PANEL_WIDTH) setWidthState(saved)
    } catch {
      // stockage indisponible : largeur par défaut
    }
  }, [])
  const setWidth = useCallback((next: number) => {
    const clamped = Math.round(Math.min(window.innerWidth * 0.7, Math.max(MIN_PANEL_WIDTH, next)))
    setWidthState(clamped)
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped))
    } catch {
      // stockage indisponible : largeur gardée pour la session
    }
  }, [])

  const openInspection = useCallback((targetPageId: string, targetTab?: InspectionTab, targetSection?: number) => {
    // Sans onglet demandé : « L'essentiel »
    const selectedTab = visibleTab(targetTab || 'essentials')
    setPageId(targetPageId)
    setTabState(selectedTab)
    setSection(targetSection ?? null)
    setIsOpen(true)
    setCursorId(targetPageId)

    // Update query params without reloading
    const url = new URL(window.location.href)
    url.searchParams.set('inspect', targetPageId)
    url.searchParams.set('tab', selectedTab)
    if (targetSection !== undefined) {
      url.searchParams.set('section', String(targetSection))
    } else {
      url.searchParams.delete('section')
    }
    window.history.pushState({}, '', url.toString())
  }, [])

  const closeInspection = useCallback(() => {
    setIsOpen(false)
    setPageId(null)
    setSection(null)

    // Remove query params
    const url = new URL(window.location.href)
    url.searchParams.delete('inspect')
    url.searchParams.delete('tab')
    url.searchParams.delete('section')
    window.history.pushState({}, '', url.toString())
  }, [])

  const setTab = (requested: InspectionTab) => {
    const newTab = visibleTab(requested)
    setTabState(newTab)
    setSection(null)
    if (pageId) {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', newTab)
      url.searchParams.delete('section')
      window.history.pushState({}, '', url.toString())
    }
  }

  const setNavigation = useCallback((ids: string[]) => {
    setNavigationState((current) => (current.join('|') === ids.join('|') ? current : ids))
  }, [])

  const activeId = isOpen ? pageId : cursorId
  // Lecture des valeurs courantes depuis le gestionnaire de touches, sans le réinstaller à chaque rendu
  const state = useRef({ isOpen, pageId, tab, navigation, activeId })
  state.current = { isOpen, pageId, tab, navigation, activeId }

  const step = useCallback(
    (delta: 1 | -1) => {
      const { isOpen: open, tab: currentTab, navigation: ids, activeId: current } = state.current
      if (ids.length === 0) return
      const index = current ? ids.indexOf(current) : -1
      const nextIndex = index < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, index + delta))
      const next = ids[nextIndex]
      if (!next || next === current) return
      // Panneau ouvert : la page suivante s'ouvre sur le même onglet ; sinon la ligne active se déplace
      if (open) openInspection(next, currentTab)
      else setCursorId(next)
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-row-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' })
      })
    },
    [openInspection],
  )

  // Raccourcis de la liste : J / K parcourent, Entrée ouvre la ligne active, Échap ferme la fiche
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (shortcutsBlocked(event)) return
      const { isOpen: open, navigation: ids, activeId: current } = state.current
      const key = event.key.toLowerCase()
      if ((key === 'j' || key === 'k') && ids.length > 0) {
        event.preventDefault()
        step(key === 'j' ? 1 : -1)
      } else if (key === 'enter' && !open && current && ids.includes(current) && (event.target as HTMLElement)?.tagName === 'BODY') {
        event.preventDefault()
        openInspection(current)
      } else if (key === 'escape' && open) {
        event.preventDefault()
        closeInspection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, openInspection, closeInspection])

  return (
    <InspectionContext.Provider
      value={{
        isOpen,
        pageId,
        tab,
        section,
        openInspection,
        closeInspection,
        setTab,
        width,
        setWidth,
        navigation,
        setNavigation,
        step,
        activeId,
        panelPresent,
        setPanelPresent,
      }}
    >
      {children}
    </InspectionContext.Provider>
  )
}

export function useInspection() {
  const context = useContext(InspectionContext)
  if (!context) {
    throw new Error('useInspection must be used within an InspectionProvider')
  }
  return context
}

/**
 * Déclare la liste affichée par l'écran (identifiants de pages, dans l'ordre) : ↑ ↓ du panneau et touches J / K la
 * parcourent. Oubliée quand l'écran se ferme.
 */
export function useInspectionNavigation(ids: string[]) {
  const { setNavigation } = useInspection()
  const key = ids.join('|')
  useEffect(() => {
    setNavigation(key ? key.split('|') : [])
  }, [key, setNavigation])
  useEffect(() => () => setNavigation([]), [setNavigation])
}
