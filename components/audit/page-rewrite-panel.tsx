'use client'

import { useState } from 'react'
import { ArrowRight, Check, Copy, PenLine, RefreshCw } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import type { InspectionData } from '@/lib/audit-data'
import { contentTokens } from '@/core/domain/scoring/autocomplete-relevance'

/** Racine grossière : pluriels en s / x confondus avec le singulier (comme la mesure de couverture) */
const stem = (token: string) => (token.length > 3 ? token.replace(/[sx]$/, '') : token)
const stemsOf = (text: string) => contentTokens(text).map(stem)

/**
 * Texte proposé dont les mots des requêtes notées s'allument : ceux de la requête survolée, ou de toutes les requêtes
 * reprises quand on survole le texte lui-même
 */
function HighlightedText({ text, active }: { text: string; active: Set<string> }) {
  if (active.size === 0) return <>{text}</>
  return (
    <>
      {text.split(/(\s+)/).map((part, index) =>
        /\S/.test(part) && stemsOf(part).some((token) => active.has(token)) ? (
          <mark key={index} className="rounded bg-primary/30 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

/** Requêtes notées reprises dans le texte : tous leurs mots porteurs de sens y figurent (ordre libre) */
function appliedKeywords(text: string, keywords: string[]): string[] {
  const present = new Set(stemsOf(text))
  return keywords.filter((keyword) => {
    const tokens = stemsOf(keyword)
    return tokens.length > 0 && tokens.every((token) => present.has(token))
  })
}

/** Proposition avec ses mots-clés repris : survol d'une pastille ou du texte pour les voir dans la phrase */
function KeywordText({ text, keywords, className }: { text: string; keywords: string[]; className?: string }) {
  const [hovered, setHovered] = useState<string | 'all' | null>(null)
  const applied = appliedKeywords(text, keywords)
  const active = new Set(
    hovered === 'all' ? applied.flatMap(stemsOf) : hovered ? stemsOf(hovered) : [],
  )
  return (
    <>
      <span
        className={className}
        onMouseEnter={() => setHovered('all')}
        onMouseLeave={() => setHovered(null)}
      >
        <HighlightedText text={text} active={active} />
      </span>
      {keywords.length > 0 && (
        <span className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
          {applied.length > 0 ? (
            <>
              <span className="text-muted-foreground">Requêtes reprises :</span>
              {applied.map((keyword) => (
                <span
                  key={keyword}
                  onMouseEnter={() => setHovered(keyword)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(keyword)}
                  onBlur={() => setHovered(null)}
                  tabIndex={0}
                  className={`cursor-default rounded-full border px-2 py-0.5 transition-colors ${
                    hovered === keyword || hovered === 'all'
                      ? 'border-primary bg-primary/20 text-foreground'
                      : 'border-shade-44 text-muted-foreground'
                  }`}
                >
                  {keyword}
                </span>
              ))}
            </>
          ) : (
            <span className="text-muted-foreground">Aucune requête notée reprise</span>
          )}
        </span>
      )}
    </>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé) : l'utilisateur peut sélectionner le texte
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-shade-44 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
    >
      {copied ? <Check className="size-3 text-green-ink" /> : <Copy className="size-3" />}
      {copied ? 'Copié' : 'Copier'}
    </button>
  )
}

/** Ancien texte, puis texte proposé avec un bouton pour le copier */
function BeforeAfter({
  label,
  current,
  proposed,
  hint,
  hintWarning,
  keywords = [],
}: {
  label: string
  current: string
  proposed: string
  /** Requêtes notées de la page : celles reprises dans la proposition s'allument au survol */
  keywords?: string[]
  hint?: string
  /** Longueur hors de la plage conseillée : à raccourcir ou allonger avant de publier */
  hintWarning?: boolean
}) {
  return (
    <div className="rounded-lg border border-shade-33 bg-shade-19 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <CopyButton value={proposed} />
      </div>
      <p className="text-xs text-muted-foreground line-through decoration-shade-44">{current || '(absent)'}</p>
      <p className="mt-1 flex items-start gap-1.5 text-sm text-foreground">
        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary-ink" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <KeywordText text={proposed} keywords={keywords} className="select-all whitespace-pre-line" />
        </span>
      </p>
      {hint && <p className={`mt-1 text-[11px] ${hintWarning ? 'text-amber-soft' : 'text-muted-foreground'}`}>{hint}</p>}
    </div>
  )
}

/**
 * Réécriture proposée par l'IA : Title, méta, H1, sous-titres H2 et phrase d'ouverture de chaque section, sections à
 * ajouter. Proposition à relire, sans effet sur la note ; noms et chiffres absents de la page signalés.
 */
export function PageRewritePanel({
  pageId,
  rewrite,
  keywords = [],
}: {
  pageId: string
  rewrite?: InspectionData['editorial']['rewrite']
  /** Requêtes notées de la page, de la plus lourde à la plus légère */
  keywords?: string[]
}) {
  const { auditDbId, refreshAudit } = useAudit()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (force: boolean) => {
    if (!auditDbId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `Erreur ${res.status}`)
      }
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proposition impossible')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-shade-33 bg-shade-1e p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <PenLine className="size-4" aria-hidden="true" /> Réécriture proposée
        </h4>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(Boolean(rewrite))}
          className="inline-flex items-center gap-1.5 rounded-md border border-shade-44 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
          {rewrite ? 'Nouvelle proposition' : 'Proposer une réécriture'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Titres et ouvertures de section rédigés par l’IA selon l’objectif de la page, avec la requête principale et
        les recherches secondaires, à partir des seuls faits de la page. À relire avant publication. Sans effet sur la
        note.
        {busy ? ' Rédaction en cours, cela peut prendre une minute…' : ''}
      </p>
      {error && <p className="text-xs text-[#ef4444]">{error}</p>}

      {rewrite && (
        <>
          {rewrite.outdated && (
            <p className="rounded-lg border border-line-indigo bg-tint-indigo p-2.5 text-xs text-sky-soft">
              Proposition faite sur une version précédente (contenu, objectif ou requête principale changés) : demandez
              une nouvelle proposition.
            </p>
          )}
          {rewrite.unverified.length > 0 && (
            <p className="rounded-lg border border-line-yellow bg-tint-yellow p-2.5 text-xs text-yellow-pale">
              Éléments absents de la page : <strong>{rewrite.unverified.join(', ')}</strong>. Vérifiez qu’ils sont
              exacts, ou retirez-les, avant de publier.
            </p>
          )}
          <BeforeAfter keywords={keywords} label="Title" current={rewrite.title.current} proposed={rewrite.title.proposed} hint={`${rewrite.title.proposed.length} caractères (idéal 45 à 60)`} hintWarning={rewrite.title.proposed.length < 45 || rewrite.title.proposed.length > 60} />
          <BeforeAfter keywords={keywords} label="Méta description" current={rewrite.meta.current} proposed={rewrite.meta.proposed} hint={`${rewrite.meta.proposed.length} caractères (idéal 130 à 155)`} hintWarning={rewrite.meta.proposed.length < 130 || rewrite.meta.proposed.length > 155} />
          <BeforeAfter keywords={keywords} label="H1" current={rewrite.h1.current} proposed={rewrite.h1.proposed} />

          {rewrite.sections.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">Sous-titres H2 et ouverture des sections</p>
              {rewrite.sections.map((section) => (
                <BeforeAfter
                  keywords={keywords}
                  key={section.current}
                  label="H2"
                  current={section.current}
                  proposed={section.intro ? `${section.proposed}\n${section.intro}` : section.proposed}
                  hint={section.why}
                />
              ))}
            </div>
          )}

          {rewrite.newSections.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">Sections à ajouter</p>
              {rewrite.newSections.map((section) => (
                <div key={section.heading} className="rounded-lg border border-shade-33 bg-shade-19 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{section.heading}</span>
                    <CopyButton value={section.intro ? `${section.heading}\n${section.intro}` : section.heading} />
                  </div>
                  {section.intro && (
                    <p className="flex flex-col text-sm text-foreground">
                      <KeywordText text={section.intro} keywords={keywords} />
                    </p>
                  )}
                  {section.why && <p className="mt-1 text-[11px] text-muted-foreground">{section.why}</p>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Proposé par {rewrite.model} le {new Date(rewrite.createdAt).toLocaleDateString('fr-FR')}.
          </p>
        </>
      )}
    </div>
  )
}
