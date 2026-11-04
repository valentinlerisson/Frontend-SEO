'use client'

import { useState } from 'react'
import { Bot, Check, Copy, RefreshCw } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import type { InspectionData } from '@/lib/audit-data'
import { PageRoleGoal } from './page-role-goal'
import { KeywordResearchPanel } from './keyword-research-panel'
import { PageRewritePanel } from './page-rewrite-panel'
import { QuerySetPanel } from './query-set-panel'

const INTENT_LABEL = {
  INFORMATIONAL: 'Informationnelle',
  COMMERCIAL: 'Commerciale',
  TRANSACTIONAL: 'Transactionnelle',
  NAVIGATIONAL: 'Navigationnelle',
} as const

function CopyableDeliverable({ label, value, hint }: { label: string; value: string; hint: string }) {
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
    <div className="rounded-lg border border-shade-33 bg-shade-19 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md border border-shade-44 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-green-ink" /> : <Copy className="size-3.5" />}
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <p className="select-all text-sm text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

/**
 * Bloc "requête cible" de l'onglet éditorial : affichage de la requête, saisie manuelle,
 * ré-analyse, et livrables prêts à l'emploi (Title / méta réécrits).
 */
export function EditorialSearchPanel({
  pageId,
  editorial,
}: {
  pageId: string
  editorial: InspectionData['editorial']
}) {
  const { auditDbId, refreshAudit } = useAudit()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = editorial.search
  // Requêtes notées, de la plus lourde à la plus légère ; analyse antérieure sans groupe : la requête cible
  const querySet = editorial.querySet ?? []
  const main = querySet[0]?.query ?? editorial.targetKeyword
  const totalVolume = querySet.reduce((sum, entry) => sum + (entry.volume ?? 0), 0)

  const run = async (body: { force?: boolean }) => {
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
                . Détail et choix des requêtes ci-dessous.
              </p>
            )}
          </div>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-inset p-3 sm:col-span-2">
            <PageRoleGoal
              pageId={pageId}
              path="cette page"
              role={editorial.role}
              roleSource={editorial.roleSource}
              roleReason={editorial.roleReason}
              goal={editorial.goal}
              goalSource={editorial.goalSource}
              goalStale={editorial.goalStale}
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

      {editorial.querySet && editorial.querySet.length > 0 && (
        <QuerySetPanel key={editorial.querySet.map((entry) => entry.query).join('|')} pageId={pageId} editorial={editorial} />
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
        <span role="status" className="text-muted-foreground">
          {busy
            ? 'Analyse en cours, cela peut prendre une minute…'
            : 'L’IA relit la page, choisit ses mots-clés, Keyword Planner donne leurs volumes, puis la page est notée.'}
        </span>
        {error && <p className="w-full text-[#ef4444]">{error}</p>}
      </div>

      <KeywordResearchPanel pageId={pageId} keywords={editorial.keywords} scored={querySet.map((entry) => entry.query)} />

      {search && (
        <PageRewritePanel pageId={pageId} rewrite={editorial.rewrite} keywords={querySet.map((entry) => entry.query)} />
      )}

      {search && (
        <div className="space-y-2.5 rounded-xl border border-shade-33 bg-shade-1e p-3.5">
          <h4 className="text-sm font-semibold text-foreground">Livrables prêts à l'emploi</h4>
          <CopyableDeliverable
            label="Title suggéré"
            value={search.snippet.suggestedTitle}
            hint={`${search.snippet.suggestedTitle.length} caractères (idéal 45 à 60)`}
          />
          <CopyableDeliverable
            label="Méta description suggérée"
            value={search.snippet.suggestedMeta}
            hint={`${search.snippet.suggestedMeta.length} caractères (idéal 130 à 155)`}
          />
          {search.snippet.unverifiedTerms && search.snippet.unverifiedTerms.length > 0 && (
            <p className="rounded-lg border border-line-yellow bg-tint-yellow p-2.5 text-xs text-yellow-pale">
              Ces suggestions contiennent des éléments absents de la page :{' '}
              <strong>{search.snippet.unverifiedTerms.join(', ')}</strong>. Vérifiez qu’ils sont exacts avant de
              publier.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
