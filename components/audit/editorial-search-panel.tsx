'use client'

import { useState } from 'react'
import { Bot, Check, Copy, RefreshCw } from 'lucide-react'
import { useAudit } from '@/components/providers/audit-provider'
import type { InspectionData } from '@/lib/audit-data'

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
  const [draft, setDraft] = useState(editorial.targetKeyword)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = editorial.search
  const candidates = search?.candidates ?? []
  const fromCandidates = candidates.length > 0 && !search?.targetQuery.isBrand

  const run = async (body: { targetQuery?: string | null; force?: boolean }) => {
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

  const trimmed = draft.trim()
  const queryChanged = trimmed.length > 0 && trimmed !== editorial.targetKeyword

  return (
    <div className="space-y-3">
      {/* Synthèse : requête, rôle, intention comparée à Google, position mesurée */}
      <div className="space-y-3 rounded-xl border border-line-indigo bg-tint-indigo p-4 text-xs text-foreground sm:text-sm">
        <div className="flex items-start gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-chip-indigo text-primary-ink">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-indigo-pale">
              Requête visée{' '}
              {editorial.queryConfidence === 'MANUAL' || editorial.isForcedTarget
                ? '(saisie par vous)'
                : fromCandidates
                  ? editorial.queryConfidence === 'CONFIRMED'
                    ? '(recherche générique proposée par l’IA, confirmée par Google)'
                    : '(recherche générique proposée par l’IA)'
                  : search?.targetQuery.isBrand
                    ? '(requête de marque : page de contact ou utilitaire)'
                    : editorial.queryConfidence === 'CONFIRMED'
                      ? '(déduite par l’IA, retrouvée dans Google)'
                      : '(déduite par l’IA)'}
              {editorial.queryKept && editorial.queryConfidence !== 'MANUAL' && !editorial.isForcedTarget
                ? ' · conservée d’une analyse à l’autre'
                : ''}
            </p>
            <p className="text-base font-semibold text-foreground">« {editorial.targetKeyword} »</p>
            {candidates.length > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Autres recherches proposées, sans le nom de la marque :{' '}
                {candidates
                  .filter((candidate) => candidate.query !== editorial.targetKeyword)
                  .map((candidate) => `« ${candidate.query} »${candidate.suggestedByGoogle ? ' (suggérée par Google)' : ''}`)
                  .join(', ')}
                . Leur position se mesure dans l’onglet Positionnement.
              </p>
            )}
            {editorial.queryConfidence === 'INFERRED' && (
              <p className="mt-1 text-xs text-amber-soft">
                Confiance faible : cette requête vient de la page elle-même et n’a pas été retrouvée dans Google.
                Intention et zones chaudes sont exclues du score tant que vous ne saisissez pas la requête visée.
              </p>
            )}
          </div>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-inset p-2.5">
            <dt className="text-[11px] uppercase tracking-wide text-indigo-pale">Rôle de la page</dt>
            <dd className="font-semibold">{editorial.roleLabel}</dd>
            <dd className="text-xs text-muted-foreground">
              {editorial.roleSource === 'manual' && 'Modifié par vous'}
              {editorial.roleSource === 'ai' && `Corrigé par l’IA${editorial.roleReason ? ` : ${editorial.roleReason}` : ''}`}
              {editorial.roleSource === 'auto' && 'Détecté automatiquement, modifiable dans Subpages'}
            </dd>
          </div>
          <div className="rounded-lg bg-inset p-2.5">
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

      <div className="rounded-xl border border-shade-33 bg-shade-1e p-3.5">
        <label htmlFor="target-query" className="mb-1.5 block text-xs font-semibold text-foreground">
          Requête visée par cette page
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="target-query"
            type="text"
            value={draft}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-shade-44 bg-shade-16 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            disabled={busy || !queryChanged}
            onClick={() => run({ targetQuery: trimmed })}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-[#e0d100] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
            Appliquer et ré-analyser
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            disabled={busy}
            onClick={() => run({ force: true })}
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          >
            Ré-analyser
          </button>
          {editorial.isForcedTarget && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft('')
                run({ targetQuery: null })
              }}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              Revenir à la détection automatique
            </button>
          )}
          {busy && <span className="text-muted-foreground">Analyse en cours, cela peut prendre une minute…</span>}
        </div>
        {error && <p className="mt-2 text-xs text-[#ef4444]">{error}</p>}
      </div>

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
