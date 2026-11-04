'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { clampMaxCrawlPages, DEFAULT_MAX_CRAWL_PAGES } from '@/core/domain/crawl-scope'
import { DEFAULT_SERP_PER_DAY, DEFAULT_SERP_PER_RUN, resolveSerpBudget } from '@/core/domain/serp-budget'

export const DEFAULT_MAX_AI_PAGES = 20
export const MIN_MAX_AI_PAGES = 1
export const MAX_MAX_AI_PAGES = 100

const STORAGE_KEY = 'auditly:settings'

type Settings = {
  /** Plafond de pages piliers analysables par l'IA */
  maxAiPages: number
  /** Pages explorées au plus par audit (envoyé au lancement) */
  maxCrawlPages: number
  /** Budget de recherches Google : par lancement de mesure, et par jour tous projets confondus */
  serpPerRun: number
  serpPerDay: number
}

type SettingsContextValue = Settings & {
  setMaxAiPages: (value: number) => void
  setMaxCrawlPages: (value: number) => void
  setSerpPerRun: (value: number) => void
  setSerpPerDay: (value: number) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function clampMaxAiPages(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_AI_PAGES
  return Math.min(MAX_MAX_AI_PAGES, Math.max(MIN_MAX_AI_PAGES, Math.round(value)))
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>({
    maxAiPages: DEFAULT_MAX_AI_PAGES,
    maxCrawlPages: DEFAULT_MAX_CRAWL_PAGES,
    serpPerRun: DEFAULT_SERP_PER_RUN,
    serpPerDay: DEFAULT_SERP_PER_DAY,
  })

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const budget = resolveSerpBudget({ perRun: parsed?.serpPerRun, perDay: parsed?.serpPerDay })
      setSettings({
        maxAiPages: typeof parsed?.maxAiPages === 'number' ? clampMaxAiPages(parsed.maxAiPages) : DEFAULT_MAX_AI_PAGES,
        maxCrawlPages:
          typeof parsed?.maxCrawlPages === 'number' ? clampMaxCrawlPages(parsed.maxCrawlPages) : DEFAULT_MAX_CRAWL_PAGES,
        serpPerRun: budget.perRun,
        serpPerDay: budget.perDay,
      })
    } catch {
      // stockage indisponible ou JSON invalide : valeurs par défaut conservées
    }
  }, [])

  // Tous les réglages sont enregistrés ensemble : modifier l'un ne doit pas effacer l'autre
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // stockage indisponible : le réglage reste valable pour la session
      }
      return next
    })
  }, [])

  const setMaxAiPages = useCallback((value: number) => update({ maxAiPages: clampMaxAiPages(value) }), [update])
  const setMaxCrawlPages = useCallback((value: number) => update({ maxCrawlPages: clampMaxCrawlPages(value) }), [update])
  const setSerpPerRun = useCallback((value: number) => update({ serpPerRun: resolveSerpBudget({ perRun: value }).perRun }), [update])
  const setSerpPerDay = useCallback((value: number) => update({ serpPerDay: resolveSerpBudget({ perDay: value }).perDay }), [update])

  return (
    <SettingsContext.Provider value={{ ...settings, setMaxAiPages, setMaxCrawlPages, setSerpPerRun, setSerpPerDay }}>
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
