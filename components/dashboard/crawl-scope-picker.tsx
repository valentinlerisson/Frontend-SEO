'use client'

import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useSettings } from '@/components/providers/settings-provider'
import type { CrawlScopeChoice } from '@/components/providers/projects-provider'
import { MAIN_PAGES_DEPTH, MAIN_PAGES_LIMIT } from '@/core/domain/crawl-scope'

type Sitemap = { url: string; count: number }

/**
 * Choix du périmètre d'exploration avant le lancement : tout le site (par défaut), pages principales, ou sitemaps
 * choisis après lecture de la structure du site (sans exploration).
 */
export function CrawlScopePicker({
  domain,
  value,
  onChange,
}: {
  /** Domaine saisi (null tant que l'adresse n'est pas valide) */
  domain: string | null
  value: CrawlScopeChoice
  onChange: (scope: CrawlScopeChoice) => void
}) {
  const { maxCrawlPages } = useSettings()
  const [open, setOpen] = useState(false)
  const [sitemaps, setSitemaps] = useState<Sitemap[] | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = value.sitemaps ?? []
  const selectedPages = (sitemaps ?? []).filter((item) => selected.includes(item.url)).reduce((sum, item) => sum + item.count, 0)

  const summary =
    value.mode === 'main'
      ? `Pages principales (${MAIN_PAGES_LIMIT} pages au plus)`
      : value.mode === 'sitemaps'
        ? `${selected.length} sitemap(s) choisi(s)`
        : `Tout le site (${maxCrawlPages} pages au plus)`

  const readSitemaps = async () => {
    if (!domain) {
      setError('Saisissez d’abord l’adresse du site.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/site-structure?domain=${encodeURIComponent(domain)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
      setSitemaps(data.sitemaps ?? [])
      setLoadedFor(domain)
      onChange({ mode: 'sitemaps', sitemaps: [] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lecture impossible')
    } finally {
      setLoading(false)
    }
  }

  const options: { mode: CrawlScopeChoice['mode']; title: string; text: string }[] = [
    {
      mode: 'full',
      title: 'Tout le site',
      text: `Le robot suit les liens depuis l’accueil, avec ou sans sitemap, jusqu’à ${maxCrawlPages} pages (réglable dans Paramètres).`,
    },
    {
      mode: 'main',
      title: 'Pages principales',
      text: `${MAIN_PAGES_DEPTH} clics au plus depuis l’accueil, ${MAIN_PAGES_LIMIT} pages au plus, sans les archives ni les pages de liste.`,
    },
    {
      mode: 'sitemaps',
      title: 'Sitemaps choisis',
      text: 'Seulement les pages des sitemaps que vous cochez, et l’accueil.',
    },
  ]

  return (
    <div className="rounded-xl border border-shade-3e">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm"
      >
        <span>
          <span className="font-semibold text-foreground">Périmètre : </span>
          <span className="text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="border-t border-shade-3e p-3.5">
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Périmètre de l’audit</legend>
            {options.map((option) => (
              <label
                key={option.mode}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${
                  value.mode === option.mode ? 'border-primary bg-primary/10' : 'border-shade-3e'
                }`}
              >
                <input
                  type="radio"
                  name="crawl-scope"
                  checked={value.mode === option.mode}
                  onChange={() => onChange({ mode: option.mode, sitemaps: option.mode === 'sitemaps' ? selected : undefined })}
                  className="mt-1 size-4 accent-[#f5e400]"
                />
                <span>
                  <span className="block font-semibold text-foreground">{option.title}</span>
                  <span className="block text-muted-foreground">{option.text}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {value.mode === 'sitemaps' && (
            <div className="mt-3">
              <button
                type="button"
                onClick={readSitemaps}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-shade-44 px-3 py-1.5 text-sm font-semibold text-foreground hover:border-primary disabled:opacity-50"
              >
                {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {sitemaps && loadedFor === domain ? 'Relire les sitemaps' : 'Lire les sitemaps du site'}
              </button>
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {loading ? 'Lecture des sitemaps…' : ''}
              </p>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

              {sitemaps && sitemaps.length === 0 && (
                <p className="text-sm text-sky-soft">
                  Aucun sitemap trouvé sur ce site : choisissez « Tout le site », le robot suivra les liens.
                </p>
              )}
              {sitemaps && sitemaps.length > 0 && (
                <fieldset className="mt-1">
                  <legend className="mb-1.5 text-xs text-muted-foreground">
                    {sitemaps.length} sitemap(s) trouvé(s). Cochez ceux à auditer.
                  </legend>
                  <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                    {sitemaps.map((item) => {
                      const checked = selected.includes(item.url)
                      return (
                        <li key={item.url}>
                          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-shade-33/40">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                onChange({
                                  mode: 'sitemaps',
                                  sitemaps: checked ? selected.filter((url) => url !== item.url) : [...selected, item.url],
                                })
                              }
                              className="size-4 accent-[#f5e400]"
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={item.url}>
                              {item.url.replace(/^https?:\/\/[^/]+\//, '')}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.count} page(s)</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  {selected.length > 0 && (
                    <p className={`mt-2 text-xs ${selectedPages > maxCrawlPages ? 'text-sky-soft' : 'text-muted-foreground'}`}>
                      {selectedPages} page(s) choisie(s)
                      {selectedPages > maxCrawlPages
                        ? ` : seules ${maxCrawlPages} seront explorées (plafond des Paramètres).`
                        : '.'}
                    </p>
                  )}
                </fieldset>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
