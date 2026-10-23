'use client'

import { useId, useState } from 'react'
import { Play, Search } from 'lucide-react'
import { parseDomain } from '@/lib/projects'
import { cn } from '@/lib/utils'

type AuditUrlFormProps = {
  onLaunch: (domain: string) => void
  className?: string
}

export function AuditUrlForm({ onLaunch, className }: AuditUrlFormProps) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const domain = parseDomain(url)
    if (!domain) {
      setError('Veuillez saisir une URL valide (ex. monsite.fr).')
      return
    }
    setError(null)
    onLaunch(domain)
    setUrl('')
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-start', className)}
    >
      <div className="w-full sm:max-w-xl">
        <label htmlFor={inputId} className="sr-only">
          URL du site à auditer
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-foreground"
            aria-hidden="true"
          />
          <input
            id={inputId}
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="Rechercher une URL..."
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              if (error) setError(null)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="h-14 w-full rounded-xl border border-muted-foreground/60 bg-background pr-4 pl-14 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none aria-invalid:border-destructive"
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="inline-flex h-14 shrink-0 items-center justify-center gap-3 rounded-xl bg-primary px-8 text-xl font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Play className="size-6 fill-current" aria-hidden="true" />
        Lancer l&apos;audit
      </button>
    </form>
  )
}
