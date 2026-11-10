'use client'

import { useCallback, useEffect, useState } from 'react'
import { Camera, ExternalLink, RefreshCw } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'

type ImageMeta = { type: string; width?: number; height?: number }
type ScreenshotMeta = { url: string; capturedAt: string; final?: ImageMeta; full?: ImageMeta }

/**
 * Capture de la page par PageSpeed Insights (vue mobile, comme Google la charge) : page entière dans un cadre de
 * téléphone qui défile, ou premier écran. Prise pendant l'audit pour les pages mesurées ; sinon à la demande (20 à
 * 60 s, sans effet sur la note). Gardée sur le disque, la dernière capture de l'adresse remplace la précédente.
 */
export function PageScreenshot({ pageId, compact = false }: { pageId: string; compact?: boolean }) {
  const { auditDbId } = useAudit()
  const [meta, setMeta] = useState<ScreenshotMeta | null>(null)
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'full' | 'final'>('full')

  const base = auditDbId ? `/api/audits/${auditDbId}/pages/${pageId}/screenshot` : null

  const load = useCallback(async () => {
    if (!base) return
    setLoading(true)
    try {
      const res = await fetch(base)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || `Erreur ${res.status}`)
      setMeta(payload.meta ?? null)
      setConfigured(payload.configured !== false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture illisible')
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    setMeta(null)
    setError(null)
    load()
  }, [load])

  const capture = async () => {
    if (!base) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(base, { method: 'POST' })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || `Erreur ${res.status}`)
      setMeta(payload.meta ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture impossible')
    } finally {
      setBusy(false)
    }
  }

  const kind = meta?.[view] ? view : meta?.full ? 'full' : 'final'
  const src = meta && base ? `${base}?image=${kind}&v=${encodeURIComponent(meta.capturedAt)}` : null

  return (
    <div className="space-y-2.5">
      <div className={`flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground ${compact ? 'flex-col items-start' : ''}`}>
        <span className={compact ? 'text-[11px] leading-snug' : ''}>
          {compact
            ? `Page actuelle · mobile${meta ? ` · ${new Date(meta.capturedAt).toLocaleDateString('fr-FR')}` : ''}`
            : meta
              ? `Capture PageSpeed Insights · vue mobile · ${new Date(meta.capturedAt).toLocaleDateString('fr-FR')}`
              : 'Capture PageSpeed Insights · vue mobile'}
        </span>
        <span className="flex items-center gap-1.5">
          {meta?.full && meta.final && (
            <span role="group" aria-label="Partie de la page" className="inline-flex rounded-lg border border-shade-44 p-0.5">
              {(
                [
                  ['full', compact ? 'Entière' : 'Page entière'],
                  ['final', compact ? '1er écran' : 'Premier écran'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => setView(value)}
                  className={`rounded-md px-2 py-0.5 font-semibold whitespace-nowrap transition-colors ${
                    kind === value ? 'bg-shade-33 text-foreground' : 'hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
          {src && (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              title="Ouvrir l’image dans un nouvel onglet" aria-label="Ouvrir l’image dans un nouvel onglet"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:text-foreground"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              {!compact && 'Ouvrir'}
            </a>
          )}
          {configured && meta && (
            <button
              type="button"
              disabled={busy}
              onClick={capture}
              title="Nouvelle capture par PageSpeed Insights (20 à 60 s, sans effet sur la note)"
              aria-label="Reprendre la capture"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
              {!compact && (busy ? 'Capture…' : 'Reprendre')}
            </button>
          )}
        </span>
      </div>

      {error && <p className="text-xs text-[#ef4444]">{error}</p>}

      {src ? (
        /* Cadre de téléphone : la page entière défile dedans, à la largeur mobile mesurée par Google */
        <div
          className={`mx-auto w-full rounded-[26px] border border-shade-44 bg-shade-16 p-2 shadow-[0_18px_40px_-20px_rgb(0_0_0/0.6)] ${
            compact ? 'max-w-[176px]' : 'max-w-[340px]'
          }`}
        >
          <div className={`${compact ? 'max-h-[360px]' : 'max-h-[640px]'} overflow-y-auto overscroll-contain rounded-[18px] bg-white [scrollbar-width:thin]`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- image servie par l'API locale, taille connue */}
            <img
              src={src}
              alt={`Capture mobile de ${meta?.url ?? 'la page'} par PageSpeed Insights${kind === 'full' ? ', page entière' : ', premier écran'}`}
              width={meta?.[kind]?.width}
              height={meta?.[kind]?.height}
              className="block h-auto w-full"
              loading="lazy"
            />
          </div>
        </div>
      ) : (
        <div className={`flex flex-col items-center gap-3 rounded-xl border border-dashed border-shade-44 text-center text-xs text-muted-foreground ${compact ? 'px-3 py-5' : 'px-4 py-8'}`}>
          <Camera className="size-6" aria-hidden="true" />
          {loading ? (
            <span>Chargement de la capture…</span>
          ) : configured ? (
            <>
              <span>
                {compact
                  ? 'Pas de capture : PageSpeed ne mesure que l’accueil et les pages les plus liées.'
                  : 'Pas encore de capture pour cette page : PageSpeed Insights ne mesure pendant l’audit que l’accueil et les pages les plus liées.'}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={capture}
                className="inline-flex items-center gap-1.5 rounded-lg border border-shade-44 px-3 py-1.5 font-semibold text-foreground transition-colors hover:border-primary disabled:opacity-50"
              >
                <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
                {busy ? (compact ? 'En cours (20 à 60 s)…' : 'Capture en cours (20 à 60 s)…') : 'Capturer la page'}
              </button>
              {!compact && <span>Sans effet sur la note.</span>}
            </>
          ) : (
            <span>Capture indisponible : clé PageSpeed Insights absente (PAGESPEED_API_KEY).</span>
          )}
        </div>
      )}
    </div>
  )
}
