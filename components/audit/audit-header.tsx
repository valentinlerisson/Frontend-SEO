'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, RotateCw, X, FileDown, CheckCircle2, Globe, Smartphone, ShieldCheck } from 'lucide-react'
import { useProjects } from '@/components/providers/projects-provider'
import { useAudit } from '@/components/providers/audit-provider'
import { ReportPrintSheet, type ReportMode } from './report-print-sheet'

type AuditHeaderProps = {
  domain?: string
  currentTitle: string
}

export function AuditHeader({ domain, currentTitle }: AuditHeaderProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const { audit, progress } = useAudit()
  const isCrawling = audit?.crawlStats.isCrawling ?? false
  const crawledPages = audit?.crawlStats.crawledPages ?? 0
  const totalPages = audit?.crawlStats.totalPages ?? 0
  // Ré-analyse IA d'un audit déjà terminé (page stratégique ajoutée, rôle changé) : résultats affichés, avancement ici
  const analyzing = audit?.status === 'ANALYZING_AI' && !audit.isLocked

  return (
    <>
      <header className="glass sticky top-0 z-20 -mx-4 flex flex-col gap-4 border-b border-b-shade-3e/80 px-4 py-3 shadow-none sm:flex-row sm:items-center sm:justify-between md:-mx-8 md:px-8">
        {/* Fil d'ariane */}
        <nav aria-label="Fil d'ariane" className="flex items-center gap-2 text-base md:text-lg">
          <Link href="/projets" className="text-muted-foreground hover:text-foreground transition-colors">
            Projets
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground font-medium">{domain}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground font-semibold">{currentTitle}</span>
        </nav>

        {/* Droite: Statut crawl & bouton Nouvel Audit */}
        <div className="flex flex-wrap items-center gap-3">
          {isCrawling && (
            <div className="inline-flex items-center gap-2.5 rounded-full bg-shade-2b px-4 py-1.5 text-sm md:text-base font-medium text-foreground border border-shade-44">
              {/* Spinner jaune */}
              <span className="relative flex size-4 items-center justify-center">
                <RotateCw className="size-4 animate-spin text-primary-ink" strokeWidth={2.5} />
              </span>
              <span>
                Crawl en cours ({crawledPages}/{totalPages})
              </span>
            </div>
          )}

          {analyzing && (
            <div className="inline-flex items-center gap-2.5 rounded-full border border-shade-44 bg-shade-2b px-4 py-1.5 text-sm font-medium text-foreground">
              <RotateCw className="size-4 animate-spin text-primary-ink" strokeWidth={2.5} aria-hidden="true" />
              Analyse IA en cours ({progress} %)
            </div>
          )}

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm md:text-base font-bold text-primary-foreground shadow transition-transform hover:scale-[1.02] hover:bg-[#e0d100] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus className="size-5" strokeWidth={2.5} aria-hidden="true" />
            Nouvel audit
          </button>
        </div>
      </header>

      {modalOpen && <NewAuditModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />}
    </>
  )
}

export function NewAuditModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { launchAudit } = useProjects()
  const [url, setUrl] = useState('')
  const [overrideRobots, setOverrideRobots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitting(true)
    setTimeout(() => {
      launchAudit(url.trim())
      setSubmitting(false)
      setSubmitted(true)
      setTimeout(() => {
        onClose()
      }, 900)
    }, 400)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in"
    >
      <div className="relative w-full max-w-lg glass-panel rounded-2xl border p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-shade-33 hover:text-foreground"
        >
          <X className="size-6" />
        </button>

        <div className="mb-6">
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary-ink mb-3">
            <Globe className="size-6" />
          </span>
          <h2 className="text-2xl font-bold text-foreground">Lancer un nouvel audit</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Crawl Mobile-First jusqu'à 500 pages et analyse IA sur les pages piliers sélectionnées.
          </p>
        </div>

        {submitted ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CheckCircle2 className="size-12 text-primary-ink animate-bounce" />
            <p className="mt-3 text-lg font-semibold text-foreground">Audit initialisé avec succès !</p>
            <p className="text-sm text-muted-foreground">Le crawl en arrière-plan a débuté.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label htmlFor="audit-url" className="block text-sm font-medium text-foreground mb-2">
                URL ou Domaine du site à auditer
              </label>
              <input
                id="audit-url"
                type="text"
                required
                placeholder="ex. mon-site.com ou https://mon-site.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full rounded-xl border border-border bg-shade-18 px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="rounded-xl border border-shade-3a bg-shade-1a p-3 text-sm text-muted-foreground space-y-2">
              <div className="flex items-center gap-2 text-foreground">
                <Smartphone className="size-4 text-primary-ink" />
                <span className="font-semibold text-xs uppercase tracking-wider text-primary-ink">Doctrine 100% Mobile-First</span>
              </div>
              <p className="text-xs text-muted-foreground">
                L'audit est exécuté avec l'User-Agent Googlebot Smartphone et mesure les Core Web Vitals en conditions mobiles réelles.
              </p>
            </div>

            <label className="flex items-center justify-between rounded-xl border border-shade-3a bg-shade-1c p-3 cursor-pointer hover:bg-shade-25">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Outrepasser robots.txt</p>
                  <p className="text-xs text-muted-foreground">Pour audit de pré-production ou contournement anti-bot</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={overrideRobots}
                onChange={(e) => setOverrideRobots(e.target.checked)}
                className="size-5 accent-primary cursor-pointer rounded"
              />
            </label>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-shade-33 hover:text-foreground"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting || !url.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground hover:bg-[#e0d100] disabled:opacity-50"
              >
                {submitting ? 'Lancement...' : 'Démarrer l’audit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export function ExportPdfButton({ onClick }: { onClick?: () => void }) {
  const [modalOpen, setModalOpen] = useState(false)

  const handleClick = () => {
    if (onClick) {
      onClick()
    } else {
      setModalOpen(true)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-2 rounded-lg border border-[#f5e400] bg-transparent px-4 py-2 text-sm md:text-base font-semibold text-primary-ink transition-colors hover:bg-[#f5e400] hover:text-black focus-visible:outline-2 focus-visible:outline-ring"
      >
        <FileDown className="size-4 shrink-0" strokeWidth={2} />
        Exporter en PDF
      </button>

      {modalOpen && <PdfExportModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />}
    </>
  )
}

export function PdfExportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { audit } = useAudit()
  const [mode, setMode] = useState<ReportMode>('client')
  const [printing, setPrinting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Fonction de fermeture lue par les effets sans les relancer à chaque rendu du parent
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Fenêtre accessible au clavier : focus à l'ouverture, Échap pour fermer
  useEffect(() => {
    if (!isOpen) return
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  // Le rapport est monté, puis la fenêtre d'impression s'ouvre ; son titre devient le nom du fichier PDF proposé
  useEffect(() => {
    if (!printing || !audit) return
    const previousTitle = document.title
    document.title = `Rapport SEO ${audit.domain} ${new Date().toISOString().slice(0, 10)}${mode === 'complete' ? ' complet' : ''}`
    const timer = window.setTimeout(() => {
      window.print()
      document.title = previousTitle
      setPrinting(false)
      closeRef.current()
    }, 50)
    return () => window.clearTimeout(timer)
  }, [printing, audit, mode])

  if (!isOpen || !audit) return null

  const options: { value: ReportMode; title: string; text: string }[] = [
    {
      value: 'client',
      title: 'Rapport client',
      text: 'Notes, résumé, 5 priorités, pages stratégiques, visibilité Google et popularité. Peu de jargon.',
    },
    {
      value: 'complete',
      title: 'Rapport complet',
      text: 'Tout le rapport client, plus les étapes de correction, toutes les anomalies et un glossaire.',
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="relative w-full max-w-md glass-panel rounded-2xl border p-6"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-shade-33 hover:text-foreground"
        >
          <X className="size-5" />
        </button>

        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary-ink">
            <FileDown className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id="export-title" className="text-xl font-bold text-foreground">Exporter le rapport</h3>
            <p className="text-xs text-muted-foreground">
              {audit.domain} · {audit.crawlStats.crawledPages} pages · {audit.pillarPages.length} pages stratégiques
            </p>
          </div>
        </div>

        <fieldset className="mb-4 flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-foreground">Version du rapport</legend>
          {options.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${
                mode === option.value ? 'border-primary bg-primary/10' : 'border-shade-3e'
              }`}
            >
              <input
                type="radio"
                name="report-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                className="mt-1 size-4 accent-[#f5e400]"
              />
              <span>
                <span className="block font-semibold text-foreground">{option.title}</span>
                <span className="block text-muted-foreground">{option.text}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="mb-5 rounded-xl border border-shade-3e bg-shade-18 p-3 text-xs text-muted-foreground">
          Dans la fenêtre qui s’ouvre, choisissez « Enregistrer au format PDF ». Si les couleurs n’apparaissent pas,
          cochez « Graphiques d’arrière-plan » dans les options.
        </p>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
            Annuler
          </button>
          <button
            type="button"
            onClick={() => setPrinting(true)}
            disabled={printing}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-[#e0d100] disabled:opacity-50"
          >
            <FileDown className="size-4" aria-hidden="true" />
            Générer le PDF
          </button>
        </div>
      </div>
      {printing && <ReportPrintSheet audit={audit} mode={mode} />}
    </div>
  )
}
