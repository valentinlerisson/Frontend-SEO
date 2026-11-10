'use client'

import { useState } from 'react'
import { Bot, RefreshCw, RotateCcw } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import type { InspectionData } from '@/lib/audit-data'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { PageRoleFamily } from './page-role-family'
import { KeywordResearchPanel } from './keyword-research-panel'
import { KeywordOpportunitiesPanel } from './keyword-opportunities-panel'
import { PageRewritePanel } from './page-rewrite-panel'
import { QuerySetPanel } from './query-set-panel'

const INTENT_LABEL = {
  INFORMATIONAL: 'Informationnelle',
  COMMERCIAL: 'Commerciale',
  TRANSACTIONAL: 'Transactionnelle',
  NAVIGATIONAL: 'Navigationnelle',
} as const

/** Parties de l'onglet Contenu, chacune dans sa sous-vue : notes, mots-clés et volumes, réécriture */
export type EditorialPart = 'summary' | 'keywords' | 'rewrite'

/**
 * Blocs de l'onglet Contenu, par partie. « summary » (vue Notes) : problématique, requête notée, rôle et famille,
 * position, intention, ré-analyse. « keywords » (vue Mots-clés) : requêtes notées, mots-clés et volumes, recherches
 * hors page. « rewrite » (vue Réécriture) : Title, méta et plan proposés, capture de la page.
 */
export function EditorialSearchPanel({
  pageId,
  editorial,
  part,
  headings,
  url,
}: {
  pageId: string
  editorial: InspectionData['editorial']
  part: EditorialPart
  /** Titres actuels de la page (plan de la réécriture) */
  headings?: { level: number; text: string }[]
  url: string
}) {
  const { auditDbId, refreshAudit } = useAudit()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const search = editorial.search
  // Requêtes notées, de la plus lourde à la plus légère ; analyse antérieure sans groupe : la requête cible
  const querySet = editorial.querySet ?? []
  const main = querySet[0]?.query ?? editorial.targetKeyword
  const totalVolume = querySet.reduce((sum, entry) => sum + (entry.volume ?? 0), 0)

  const run = async (body: { force?: boolean; reset?: boolean }) => {
    if (!auditDbId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/editorial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `Erreur ${res.status}`)
      }
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ré-analyse impossible')
    } finally {
      setBusy(false)
    }
  }

  const scored = querySet.map((entry) => entry.query)

  if (part === 'keywords') {
    return (
      <div className="space-y-3">
        {editorial.querySet && editorial.querySet.length > 0 && (
          <QuerySetPanel key={editorial.querySet.map((entry) => entry.query).join('|')} pageId={pageId} editorial={editorial} />
        )}
        <KeywordResearchPanel pageId={pageId} keywords={editorial.keywords} scored={scored} />
        <KeywordOpportunitiesPanel pageId={pageId} opportunities={editorial.opportunities} scored={scored} />
      </div>
    )
  }

  if (part === 'rewrite') {
    // Réécriture : seul endroit des Title et méta prêts à copier, rédigés au clic avec les requêtes notées
    return search ? (
      <PageRewritePanel pageId={pageId} rewrite={editorial.rewrite} keywords={scored} headings={headings} url={url} />
    ) : (
      <p className="rounded-xl border border-shade-33 bg-shade-1e p-4 text-sm text-muted-foreground">
        La réécriture part des requêtes notées : lancez d’abord l’analyse de la page (vue Notes, « Ré-analyser la page »).
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {/* Synthèse : requête, rôle, intention comparée à Google, position mesurée */}
      <div className="space-y-3 rounded-xl border border-line-indigo bg-tint-indigo p-4 text-xs text-foreground sm:text-sm">
        <div className="flex items-start gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-chip-indigo text-primary-ink">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0">
            {search?.problem && (
              <>
                <p className="text-xs text-indigo-pale">Problématique de la page (IA)</p>
                <p className="mb-2 text-sm text-foreground">{search.problem}</p>
              </>
            )}
            <p className="text-xs text-indigo-pale">
              {search?.targetQuery.isBrand
                ? 'Requête notée (page de contact ou utilitaire : recherche du nom du site)'
                : querySet.length > 1
                  ? `Requêtes notées · ${querySet.length} recherches${totalVolume > 0 ? ` · ${totalVolume.toLocaleString('fr-FR')}/mois` : ''}`
                  : 'Requête notée'}
            </p>
            <p className="text-base font-semibold text-foreground">« {main} »</p>
            {querySet.length > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Puis{' '}
                {querySet
                  .slice(1)
                  .map((entry) => `« ${entry.query} »${entry.volume !== undefined ? ` (${entry.volume.toLocaleString('fr-FR')}/mois)` : ''}`)
                  .join(', ')}
                . Détail et choix des requêtes dans la vue Mots-clés.
              </p>
            )}
          </div>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-inset p-3 sm:col-span-2">
            <PageRoleFamily
              pageId={pageId}
              path="cette page"
              role={editorial.role}
              roleSource={editorial.roleSource}
              roleReason={editorial.roleReason}
              family={editorial.family}
              familyStale={editorial.familyStale}
              variant="full"
              disabled={busy}
            />
          </div>
          <div className="rounded-lg bg-inset p-2.5 sm:col-span-2">
            <dt className="text-[11px] uppercase tracking-wide text-indigo-pale">Position Google</dt>
            {editorial.position ? (
              <>
                <dd
                  className={`font-semibold ${
                    editorial.position.status === 'warning'
                      ? 'text-amber-soft'
                      : editorial.position.status === 'info'
                        ? 'text-sky-soft'
                        : 'text-green-soft'
                  }`}
                >
                  {editorial.position.badge}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {editorial.position.detail}
                  {editorial.position.measuredOn ? ` (mesure du ${editorial.position.measuredOn})` : ''}
                </dd>
              </>
            ) : (
              <dd className="text-xs text-muted-foreground">Non mesurée : lancez l’analyse dans l’onglet Positionnement.</dd>
            )}
          </div>
        </dl>
        {editorial.intentSummary && (
          <div className="rounded-lg bg-inset p-2.5">
            <p className="text-[11px] uppercase tracking-wide text-indigo-pale">Intention de recherche</p>
            <p className="mt-0.5">
              Page : <span className="font-semibold">{INTENT_LABEL[editorial.intentSummary.page]}</span>
              {editorial.intentSummary.google && (
                <>
                  {' · '}Google ({editorial.intentSummary.googleSource === 'serp' ? 'résultats' : 'recherches suggérées'}) :{' '}
                  <span className="font-semibold">{INTENT_LABEL[editorial.intentSummary.google]}</span>
                </>
              )}
            </p>
            <p
              className={`mt-1 text-xs ${
                editorial.intentSummary.status === 'warning'
                  ? 'text-amber-soft'
                  : editorial.intentSummary.status === 'valid'
                    ? 'text-green-soft'
                    : 'text-sky-soft'
              }`}
            >
              {editorial.intentSummary.verdict}
            </p>
          </div>
        )}
      </div>

      {editorial.engine?.engine === 'HEURISTIC' && (
        <div className="rounded-xl border border-line-yellow bg-tint-yellow p-3 text-xs text-yellow-pale sm:text-sm">
          Analyse heuristique locale (sans IA) : requête cible, snippet, content gaps et ancrage local ne sont
          pas disponibles.
          {editorial.engine.error && <span className="mt-1 block text-yellow-pale/80">{editorial.engine.error}</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-shade-33 bg-shade-1e p-3 text-xs">
        <button
          type="button"
          disabled={busy}
          onClick={() => run({ force: true })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-shade-44 px-3 py-1.5 font-semibold text-foreground transition-colors hover:border-primary disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
          Ré-analyser la page
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmReset(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-shade-44 px-3 py-1.5 text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" />
          Repartir de zéro
        </button>
        <span role="status" className="text-muted-foreground">
          {busy
            ? 'Analyse en cours, cela peut prendre une minute…'
            : 'L’IA relit la page, choisit ses mots-clés, Keyword Planner donne leurs volumes, puis la page est notée.'}
        </span>
        {error && <p className="w-full text-[#ef4444]">{error}</p>}
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="border border-border bg-card p-6 data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold">Repartir de zéro sur cette page ?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm">
              <span className="block">
                <strong className="text-foreground">Effacés</strong> : problématique et mots-clés de départ, volumes et
                tri des mots-clés, requêtes notées choisies à la main, recherches hors page, réécriture proposée.
              </span>
              <span className="block">
                <strong className="text-foreground">Gardés</strong> : rôle de la page, mesures Google de
                l’onglet Positionnement.
              </span>
              <span className="block">
                L’analyse est relancée aussitôt (IA et Keyword Planner, environ une minute). Impossible d’annuler.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="-mx-6 -mb-6 border-border bg-transparent p-6">
            <AlertDialogCancel className="h-10 px-4 text-sm">Annuler</AlertDialogCancel>
            <button
              type="button"
              onClick={() => {
                setConfirmReset(false)
                run({ reset: true })
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-destructive px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Effacer et relancer
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
