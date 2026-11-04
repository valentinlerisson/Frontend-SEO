'use client'

import { useId, useState } from 'react'
import { Globe, Play } from 'lucide-react'
import { parseDomain } from '@/lib/projects'
import { cn } from '@/lib/utils'
import type { CrawlScopeChoice } from '@/components/providers/projects-provider'
import { CrawlScopePicker } from './crawl-scope-picker'

type AuditUrlFormProps = {
  onLaunch: (domain: string, scope?: CrawlScopeChoice) => void
  className?: string
  /** Libellé affiché au-dessus du champ (sinon réservé aux lecteurs d'écran) */
  showLabel?: boolean
  /** Choix du périmètre d'exploration sous le champ */
  withScope?: boolean
}

export function AuditUrlForm({ onLaunch, className, showLabel = false, withScope = false }: AuditUrlFormProps) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<CrawlScopeChoice>({ mode: 'full' })
  // Confirmation du dernier lancement : le formulaire revient ensuite à « Tout le site » pour le prochain audit
  const [launched, setLaunched] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const domain = parseDomain(url)
    if (!domain) {
      setError('Saisissez une adresse de site valide, par exemple monsite.fr.')
      return
    }
    if (withScope && scope.mode === 'sitemaps' && (scope.sitemaps ?? []).length === 0) {
      setError('Cochez au moins un sitemap, ou choisissez un autre périmètre.')
      return
    }
    setError(null)
    onLaunch(domain, withScope ? scope : undefined)
    const sitemaps = (scope.sitemaps ?? []).map((sitemap) => sitemap.split('/').pop() || sitemap)
    setLaunched(
      `Audit lancé pour ${domain}. Périmètre : ${
        !withScope || scope.mode === 'full'
          ? 'tout le site'
          : scope.mode === 'main'
            ? 'pages principales'
            : `${sitemaps.length > 1 ? 'sitemaps' : 'sitemap'} ${sitemaps.join(', ')}`
      }.`,
    )
    setUrl('')
    setScope({ mode: 'full' })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={inputId} className={showLabel ? 'text-sm font-semibold text-foreground' : 'sr-only'}>
        Site à auditer
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative w-full sm:max-w-md">
          <Globe
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id={inputId}
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="monsite.fr"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              if (error) setError(null)
              if (launched) setLaunched(null)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : showLabel ? hintId : undefined}
            className="h-11 w-full rounded-xl border border-shade-44 bg-shade-18 pr-3.5 pl-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary aria-invalid:border-destructive"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-[#e0d100] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Play className="size-4 fill-current" aria-hidden="true" />
          Lancer l’audit
        </button>
      </div>
      {withScope && <CrawlScopePicker domain={parseDomain(url)} value={scope} onChange={setScope} />}
      {launched && !error && (
        <p role="status" className="text-sm font-semibold text-green-soft">
          {launched}
        </p>
      )}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        showLabel && (
          <p id={hintId} className="text-xs text-muted-foreground">
            L’adresse de la page d’accueil suffit : le robot suit ensuite les liens du site.
          </p>
        )
      )}
    </form>
  )
}
