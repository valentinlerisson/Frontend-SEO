'use client'

import Link from 'next/link'
import { AlertTriangle, RotateCw, Globe } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import { useSettings } from '@/components/providers/settings-provider'
import { AuditHeader } from './audit-header'

/**
 * Rend l'état IDLE / LOADING / ERROR de l'audit. Retourne null en SUCCESS :
 * la vue appelante affiche alors exclusivement les données du presenter.
 */
export function AuditStateGate({ currentTitle }: { currentTitle: string }) {
  const { state, audit, progress, error, refreshAudit, projectId } = useAudit()

  if (state === 'SUCCESS') return null

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit?.domain ?? projectId} currentTitle={currentTitle} />

      {state === 'LOADING' && <LoadingPanel progress={progress} audit={audit} />}

      {state === 'ERROR' && (
        <section
          role="alert"
          className="flex flex-col items-center justify-center rounded-2xl border border-[#ef4444]/50 bg-tint-red px-6 py-16 text-center"
        >
          <AlertTriangle className="size-10 text-[#ef4444]" />
          <h2 className="mt-4 text-xl font-bold text-foreground">L’audit a échoué</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => refreshAudit()}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-[#e0d100]"
          >
            <RotateCw className="size-4" />
            Réessayer
          </button>
        </section>
      )}

      {state === 'IDLE' && (
        <section className="glass-card flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary-ink">
            <Globe className="size-7" />
          </span>
          <h2 className="mt-4 text-xl font-bold text-foreground">Aucun audit lancé</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Lancez un crawl pour analyser ce site : les résultats SEO technique, éditorial et GEO apparaîtront ici.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-[#e0d100]"
          >
            Lancer un audit
          </Link>
        </section>
      )}
    </div>
  )
}

function LoadingPanel({
  progress,
  audit,
}: {
  progress: number
  audit: ReturnType<typeof useAudit>['audit']
}) {
  const pct = Math.min(100, Math.max(0, Math.round(progress)))

  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <div className="glass-card rounded-2xl border p-6">
        <div className="flex items-center justify-between text-sm text-foreground">
          <span className="inline-flex items-center gap-2 font-semibold">
            <RotateCw className="size-4 animate-spin text-primary-ink" />
            Crawl en cours
            {audit ? ` (${audit.crawlStats.crawledPages}/${audit.crawlStats.totalPages} pages)` : ''}
          </span>
          <span className="tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-3 h-2 overflow-hidden rounded-full bg-shade-33"
        >
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-2xl border border-shade-3e bg-shade-2b" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-shade-3e bg-shade-2b" />
    </section>
  )
}

/** Bandeau d'action affiché tant que l'audit est en phase 1 (scores éditorial et GEO verrouillés). */
export function PhaseLockBanner({ projectId }: { projectId: string }) {
  const { maxAiPages } = useSettings()
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-2xl border border-primary/50 bg-tint-yellow-2 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm font-medium text-primary-ink sm:text-base">
        Phase 1 terminée. Sélectionnez de 1 à {maxAiPages} pages piliers dans l’onglet Sous-pages pour
        lancer l’analyse sémantique et GEO.
      </p>
      <Link
        href={`/projets/${projectId}/subpages`}
        className="inline-flex shrink-0 items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-[#e0d100]"
      >
        Choisir mes pages piliers
      </Link>
    </div>
  )
}
