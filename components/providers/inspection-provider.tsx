'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

export type InspectionTab = 'tech' | 'editorial' | 'geo'

type InspectionContextType = {
  isOpen: boolean
  pageId: string | null
  tab: InspectionTab
  openInspection: (pageId: string, tab?: InspectionTab) => void
  closeInspection: () => void
  setTab: (tab: InspectionTab) => void
}

const InspectionContext = createContext<InspectionContextType | null>(null)

export function InspectionProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [pageId, setPageId] = useState<string | null>(null)
  const [tab, setTabState] = useState<InspectionTab>('tech')

  // Check URL on initial mount or popstate
  useEffect(() => {
    const checkUrl = () => {
      const url = new URL(window.location.href)
      const inspect = url.searchParams.get('inspect')
      const tabParam = url.searchParams.get('tab') as InspectionTab | null

      if (inspect) {
        setPageId(inspect)
        setIsOpen(true)
        if (tabParam && ['tech', 'editorial', 'geo'].includes(tabParam)) {
          setTabState(tabParam)
        }
      }
    }

    checkUrl()
    window.addEventListener('popstate', checkUrl)
    return () => window.removeEventListener('popstate', checkUrl)
  }, [])

  const openInspection = (targetPageId: string, targetTab?: InspectionTab) => {
    const selectedTab = targetTab || 'tech'
    setPageId(targetPageId)
    setTabState(selectedTab)
    setIsOpen(true)

    // Update query params without reloading
    const url = new URL(window.location.href)
    url.searchParams.set('inspect', targetPageId)
    url.searchParams.set('tab', selectedTab)
    window.history.pushState({}, '', url.toString())
  }

  const closeInspection = () => {
    setIsOpen(false)
    setPageId(null)

    // Remove query params
    const url = new URL(window.location.href)
    url.searchParams.delete('inspect')
    url.searchParams.delete('tab')
    window.history.pushState({}, '', url.toString())
  }

  const setTab = (newTab: InspectionTab) => {
    setTabState(newTab)
    if (pageId) {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', newTab)
      window.history.pushState({}, '', url.toString())
    }
  }

  return (
    <InspectionContext.Provider
      value={{
        isOpen,
        pageId,
        tab,
        openInspection,
        closeInspection,
        setTab,
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
