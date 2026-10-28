'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export const DEFAULT_MAX_AI_PAGES = 20
export const MIN_MAX_AI_PAGES = 1
export const MAX_MAX_AI_PAGES = 100

const STORAGE_KEY = 'auditly:settings'

type SettingsContextValue = {
  /** Plafond de pages piliers analysables par l'IA */
  maxAiPages: number
  setMaxAiPages: (value: number) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function clampMaxAiPages(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_AI_PAGES
  return Math.min(MAX_MAX_AI_PAGES, Math.max(MIN_MAX_AI_PAGES, Math.round(value)))
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [maxAiPages, setMaxAiPagesState] = useState(DEFAULT_MAX_AI_PAGES)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (typeof parsed?.maxAiPages === 'number') {
        setMaxAiPagesState(clampMaxAiPages(parsed.maxAiPages))
      }
    } catch {
      // stockage indisponible ou JSON invalide : valeur par défaut conservée
    }
  }, [])

  const setMaxAiPages = useCallback((value: number) => {
    const next = clampMaxAiPages(value)
    setMaxAiPagesState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ maxAiPages: next }))
    } catch {
      // stockage indisponible : le réglage reste valable pour la session
    }
  }, [])

  return (
    <SettingsContext.Provider value={{ maxAiPages, setMaxAiPages }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings doit être utilisé au sein d’un SettingsProvider')
  }
  return ctx
}
