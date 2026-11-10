'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, PenLine, RefreshCw } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import type { InspectionData } from '@/lib/audit-data'
import { contentTokens } from '@/core/domain/scoring/autocomplete-relevance'
import { rewriteMarkdown, rewriteOutline, type OutlineLine } from '@/core/domain/page-rewrite'
import { PageScreenshot } from './page-screenshot'

/** Racine grossière : pluriels en s / x confondus avec le singulier (comme la mesure de couverture) */
const stem = (token: string) => (token.length > 3 ? token.replace(/[sx]$/, '') : token)
const stemsOf = (text: string) => contentTokens(text).map(stem)

/** Requêtes notées reprises dans le texte : tous leurs mots porteurs de sens y figurent (ordre libre) */
function appliedKeywords(text: string, keywords: string[]): string[] {
  const present = new Set(stemsOf(text))
  return keywords.filter((keyword) => {
    const tokens = stemsOf(keyword)
    return tokens.length > 0 && tokens.every((token) => present.has(token))
  })
}

/** Texte dont les mots des requêtes actives s'allument ; « [À COMPLÉTER : …] » mis en évidence (information à fournir) */
function HighlightedText({ text, active }: { text: string; active: Set<string> }) {
  return (
    <>
      {text.split(/(\[À COMPLÉTER[^\]]*\])/).map((chunk, chunkIndex) =>
        chunk.startsWith('[À COMPLÉTER') ? (
          <span key={chunkIndex} className="rounded border border-dashed border-line-indigo bg-tint-indigo px-1 text-sky-soft">
            {chunk}
          </span>
        ) : (
          chunk.split(/(\s+)/).map((part, index) =>
            active.size > 0 && /\S/.test(part) && stemsOf(part).some((token) => active.has(token)) ? (
              <mark key={`${chunkIndex}-${index}`} className="rounded bg-primary/30 px-0.5 text-foreground">
                {part}
              </mark>
            ) : (
              <span key={`${chunkIndex}-${index}`}>{part}</span>
            ),
          )
        ),
      )}
    </>
  )
}

function CopyButton({ value, label = 'Copier', iconOnly = false }: { value: string; label?: string; iconOnly?: boolean }) {
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
      title={copied ? 'Copié' : label}
      aria-label={iconOnly ? label : undefined}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-shade-44 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
    >
      {copied ? <Check className="size-3 text-green-ink" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
      {!iconOnly && (copied ? 'Copié' : label)}
    </button>
  )
}

/** Survol partagé : une pastille de requête allume ses mots partout ; un bloc survolé allume les requêtes qu'il reprend */
type Hover = { keyword: string } | { block: string } | null

const HEADING_CLASS: Record<number, string> = {
  1: 'text-xl font-extrabold tracking-tight',
  2: 'text-base font-bold',
  3: 'text-sm font-semibold',
}

/**
 * Réécriture proposée par l'IA à partir des requêtes notées (cochées), montrée comme la page en Markdown : Title et
 * méta tels que Google les afficherait, puis le plan complet (H1, chaque titre à son niveau, ouvertures de section,
 * sections à ajouter). Au survol, les requêtes reprises s'allument. « Comparer » montre le texte actuel barré et la
 * raison de chaque changement. Vue « Page actuelle » : capture PageSpeed de la page, pour comparer. Rédigée seulement
 * quand l'utilisateur clique ; proposition à relire, sans effet sur la note ; noms et chiffres absents de la page signalés.
 */
export function PageRewritePanel({
  pageId,
  rewrite,
  keywords = [],
  headings,
  url,
}: {
  pageId: string
  rewrite?: InspectionData['editorial']['rewrite']
  /** Requêtes notées de la page, de la plus lourde à la plus légère */
  keywords?: string[]
  /** Titres actuels de la page, dans l'ordre */
  headings?: { level: number; text: string }[]
  url: string
}) {
  const { auditDbId, refreshAudit } = useAudit()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compare, setCompare] = useState(false)
  const [hover, setHover] = useState<Hover>(null)

  const outline = useMemo(() => (rewrite ? rewriteOutline(rewrite, headings) : []), [rewrite, headings])
  const markdown = rewrite ? rewriteMarkdown(rewrite, outline) : ''
  const allText = rewrite ? [rewrite.title.proposed, rewrite.meta.proposed, ...outline.flatMap((line) => [line.text, line.intro ?? ''])].join(' ') : ''
  const applied = appliedKeywords(allText, keywords)

  /** Mots allumés dans un bloc : ceux de la pastille survolée, ou toutes les requêtes reprises par le bloc survolé */
  const activeFor = (id: string, text: string) =>
    new Set(
      hover && 'keyword' in hover
        ? stemsOf(hover.keyword)
        : hover && 'block' in hover && hover.block === id
          ? appliedKeywords(text, keywords).flatMap(stemsOf)
          : [],
    )
  const hoverProps = (id: string) => ({
    onMouseEnter: () => setHover({ block: id }),
    onMouseLeave: () => setHover(null),
  })

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

  const titleLength = rewrite?.title.proposed.length ?? 0
  const metaLength = rewrite?.meta.proposed.length ?? 0
  let displayUrl = url
  try {
    const parsed = new URL(url)
    displayUrl = `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '').split('/').join(' › ')}`
  } catch {
    // adresse non analysable : affichée telle quelle
  }

  return (
    <div className="space-y-5">
      {/* Actions de la proposition */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <PenLine className="size-4 text-muted-foreground" aria-hidden="true" />
          Réécriture
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {rewrite && (
            <>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground">
                <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} className="accent-[#f5e400]" />
                Comparer avec l’actuel
              </label>
              <CopyButton value={markdown} label="Copier en Markdown" />
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(Boolean(rewrite))}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              rewrite
                ? 'border border-shade-44 text-muted-foreground hover:border-primary hover:text-foreground'
                : 'bg-primary text-primary-foreground hover:bg-[#e0d100]'
            }`}
          >
            {rewrite ? <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> : <PenLine className="size-3.5" />}
            {rewrite ? 'Nouvelle proposition' : 'Proposer une réécriture'}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-[#ef4444]">{error}</p>}

      {/* Page actuelle (capture PageSpeed) à gauche ; Title, méta et avertissements à droite */}
      <div className="grid items-start gap-5 sm:grid-cols-[176px_minmax(0,1fr)]">
        <PageScreenshot pageId={pageId} compact />
        <div className="min-w-0 space-y-4">
          {!rewrite || busy ? (
            <p className="rounded-xl border border-shade-33 bg-shade-1e p-4 text-sm leading-relaxed text-muted-foreground">
              Title, méta description, H1, sous-titres et ouvertures de section rédigés par l’IA selon le rôle de la
              page, à partir des requêtes notées (la plus lourde en principale) et des seuls faits de la page. À relire
              avant publication. Sans effet sur la note.
              {busy ? ' Rédaction en cours, cela peut prendre une minute…' : ''}
            </p>
          ) : null}

          {rewrite && (
            <>
              {rewrite.outdated && (
                <p className="rounded-xl border border-line-indigo bg-tint-indigo p-3 text-xs leading-relaxed text-sky-soft">
                  Proposition faite sur une version précédente (contenu, famille ou requêtes notées changés) : demandez
                  une nouvelle proposition pour que le Title, la méta et les titres reprennent les requêtes cochées.
                </p>
              )}
              {rewrite.unverified.length > 0 && (
                <p className="rounded-xl border border-line-yellow bg-tint-yellow p-3 text-xs leading-relaxed text-yellow-pale">
                  Éléments absents de la page : <strong>{rewrite.unverified.join(', ')}</strong>. Vérifiez qu’ils sont
                  exacts, ou retirez-les, avant de publier.
                </p>
              )}

              {/* Dans Google : Title et méta comme dans un résultat */}
              <section aria-label="Title et méta description" className="rounded-xl border border-shade-33 bg-shade-1e p-4">
                <p className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Dans Google
                  <span className="flex gap-1 normal-case tracking-normal">
                    <CopyButton value={rewrite.title.proposed} label="Title" />
                    <CopyButton value={rewrite.meta.proposed} label="Méta" />
                  </span>
                </p>
                <p className="truncate text-xs text-muted-foreground">{displayUrl}</p>
                <p className="mt-0.5 text-lg leading-snug text-sky-soft" {...hoverProps('title')}>
                  <HighlightedText text={rewrite.title.proposed} active={activeFor('title', rewrite.title.proposed)} />
                </p>
                {compare && <p className="mt-0.5 text-xs text-muted-foreground line-through decoration-shade-44">{rewrite.title.current || '(absent)'}</p>}
                <p className="mt-2 text-sm leading-relaxed text-foreground/85" {...hoverProps('meta')}>
                  <HighlightedText text={rewrite.meta.proposed} active={activeFor('meta', rewrite.meta.proposed)} />
                </p>
                {compare && <p className="mt-0.5 text-xs text-muted-foreground line-through decoration-shade-44">{rewrite.meta.current || '(absente)'}</p>}
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-shade-33 pt-2.5 text-[11px]">
                  <span className={titleLength < 45 || titleLength > 60 ? 'text-amber-soft' : 'text-muted-foreground'}>
                    Title : {titleLength} car. (idéal 45 à 60)
                  </span>
                  <span className={metaLength < 130 || metaLength > 155 ? 'text-amber-soft' : 'text-muted-foreground'}>
                    Méta : {metaLength} car. (idéal 130 à 155)
                  </span>
                </p>
              </section>

              {/* Requêtes reprises : le survol d'une pastille allume ses mots dans toute la proposition */}
              {keywords.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Requêtes reprises</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs">
                    {applied.length > 0 ? (
                      applied.map((keyword) => (
                        <span
                          key={keyword}
                          tabIndex={0}
                          onMouseEnter={() => setHover({ keyword })}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover({ keyword })}
                          onBlur={() => setHover(null)}
                          className={`cursor-default rounded-full border px-2.5 py-1 transition-colors ${
                            hover && 'keyword' in hover && hover.keyword === keyword
                              ? 'border-primary bg-primary/20 text-foreground'
                              : 'border-shade-44 text-muted-foreground'
                          }`}
                        >
                          {keyword}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">Aucune requête notée reprise</span>
                    )}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {rewrite && (
        <>
          {/* La page réécrite en document : un niveau de titre par ligne, ce qui change en clair */}
          <section aria-label="Plan de la page réécrite" className="overflow-hidden rounded-xl border border-shade-33 bg-shade-1e">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-shade-33 bg-shade-19 px-4 py-2.5">
              <h4 className="text-sm font-semibold text-foreground">Page réécrite</h4>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-sky-soft" aria-hidden="true" /> réécrit
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full border border-dashed border-sky-soft" aria-hidden="true" /> à ajouter
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-shade-66" aria-hidden="true" /> gardé
                </span>
              </p>
            </header>
            <ol className="divide-y divide-shade-33">
              {outline.map((line, index) => (
                <OutlineRow
                  key={`${index}-${line.text}`}
                  line={line}
                  compare={compare}
                  active={activeFor(`line-${index}`, `${line.text} ${line.intro ?? ''}`)}
                  hoverProps={hoverProps(`line-${index}`)}
                />
              ))}
            </ol>
            {outline.some((line) => line.status === 'added') && (
              <p className="border-t border-shade-33 bg-shade-19 px-4 py-2 text-[11px] text-muted-foreground">
                Les sections à ajouter sont listées en fin de page : placez-les où elles servent le lecteur.
              </p>
            )}
          </section>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Proposé par {rewrite.model} le {new Date(rewrite.createdAt).toLocaleDateString('fr-FR')} · à relire avant
            publication · sans effet sur la note.
          </p>
        </>
      )}
    </div>
  )
}

/** Une ligne du plan : pastille de niveau (H1, H2…), titre à sa taille, ouverture de section lisible en dessous */
function OutlineRow({
  line,
  compare,
  active,
  hoverProps,
}: {
  line: OutlineLine
  compare: boolean
  active: Set<string>
  hoverProps: { onMouseEnter: () => void; onMouseLeave: () => void }
}) {
  const kept = line.status === 'kept'
  const copyValue = line.intro ? `${'#'.repeat(line.level)} ${line.text}\n\n${line.intro}` : `${'#'.repeat(line.level)} ${line.text}`
  const chipTone =
    line.status === 'rewritten'
      ? 'border-sky-soft/60 bg-tint-indigo text-sky-soft'
      : line.status === 'added'
        ? 'border-dashed border-sky-soft/70 bg-transparent text-sky-soft'
        : 'border-shade-44 bg-shade-2b text-muted-foreground'
  return (
    <li
      {...hoverProps}
      className={`group relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 transition-colors hover:bg-shade-19 ${
        kept ? 'py-2' : 'py-3.5'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-6 items-center justify-center rounded-md border font-mono text-[11px] font-semibold ${chipTone}`}
      >
        H{line.level}
      </span>
      <div className="min-w-0" style={{ paddingLeft: `${Math.max(0, line.level - 2) * 16}px` }}>
        <p
          className={`leading-snug ${
            kept
              ? 'text-sm font-medium text-muted-foreground'
              : line.level === 1
                ? 'text-xl font-extrabold tracking-tight text-foreground'
                : line.level === 2
                  ? 'text-base font-bold text-foreground'
                  : 'text-sm font-semibold text-foreground'
          }`}
        >
          <span className="sr-only">{`Titre de niveau ${line.level}${line.status === 'added' ? ', à ajouter' : line.status === 'rewritten' ? ', réécrit' : ', gardé'} : `}</span>
          <HighlightedText text={line.text} active={active} />
          {line.status === 'added' && (
            <span className="ml-2 rounded-full border border-dashed border-sky-soft/70 px-2 py-0.5 align-middle text-[10px] font-semibold text-sky-soft">
              à ajouter
            </span>
          )}
        </p>
        {compare && line.current && (
          <p className="mt-1 text-xs text-muted-foreground line-through decoration-shade-44">{line.current}</p>
        )}
        {line.intro && (
          <p className="mt-2 max-w-[62ch] border-l-2 border-shade-44 pl-3 text-sm leading-relaxed text-foreground/85">
            <HighlightedText text={line.intro} active={active} />
          </p>
        )}
        {compare && line.why && <p className="mt-1.5 text-[11px] leading-snug text-sky-soft">↳ {line.why}</p>}
      </div>
      {!kept ? (
        <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton value={copyValue} label="Copier ce bloc" iconOnly />
        </span>
      ) : (
        <span />
      )}
    </li>
  )
}
