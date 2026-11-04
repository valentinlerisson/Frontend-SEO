'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { Hourglass, Loader2, MapPin, Plus, RotateCw, Search, ShieldAlert, X } from 'lucide-react'
import { AuditHeader } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { AuditStateGate } from './audit-state-gate'
import { useAudit } from '@/components/providers/audit-provider'
import { useInspection } from '@/components/providers/inspection-provider'
import { useSettings } from '@/components/providers/settings-provider'
import type { SubpageItem } from '@/lib/audit-data'
import { describePagePosition, peopleAlsoAsk } from '@/lib/serp-labels'
import { normalizeText } from '@/core/domain/scoring/autocomplete-relevance'
import { MAX_CHOSEN_SERP_QUERIES, MAX_SERP_QUERIES } from '@/core/domain/scoring/query-candidates'
import type { GeoZone } from '@/core/domain/zones'
import { ZonePicker } from './zone-picker'
import { ZonesPanel } from './zones-panel'
import { LocalVisibilitySection } from './local-visibility-section'
import { SerpInsights } from './serp-insights'

/** Pages mesurables par lancement (limite de l'API) */
const MAX_PER_RUN = 20

/** Position la plus utile d'un relevé : la page, sinon son lien annexe, sinon le site */
function historyRank(entry: NonNullable<SubpageItem['serpHistory']>[number]) {
  return entry.pagePosition ?? entry.sitelinkOf ?? null
}

function PositionBadge({ serp, history }: { serp?: SubpageItem['serp']; history?: SubpageItem['serpHistory'] }) {
  if (!serp || serp.status !== 'DONE') return <span className="text-muted-foreground">—</span>
  const { rank, badge, detail } = describePagePosition(serp)
  // Relevé précédent sur la même requête (le dernier de l'historique est la mesure affichée)
  const previous = (history ?? [])
    .filter((entry) => entry.query === serp.query && entry.zone === serp.zone?.id && entry.date !== serp.fetchedAt)
    .at(-1)
  // Le groupe est écrit en toutes lettres : la couleur n'est jamais la seule information. Absente du Top : bleu,
  // c'est un constat, pas une erreur du site
  const group =
    rank === null
      ? { word: 'Hors Top', tone: 'border-[#38bdf8]/50 text-sky-soft' }
      : rank <= 3
        ? { word: 'Top 3', tone: 'border-[#12b10f]/50 text-green-soft' }
        : rank <= 10
          ? { word: 'Page 1', tone: 'border-primary/60 text-primary-ink' }
          : { word: 'Pages 2-3', tone: 'border-shade-44 text-foreground' }
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${group.tone}`}>
        <span className="font-bold">{group.word}</span>
        <span aria-hidden="true">·</span>
        {badge}
      </span>
      <span className="max-w-[220px] text-xs text-muted-foreground">{detail}</span>
      {serp.zone && (
        <span className="text-[11px] text-muted-foreground">
          {serp.sentQuery ? `Recherché : « ${serp.sentQuery} »` : `Recherche simulée depuis ${serp.zone.city}`}
        </span>
      )}
      {serp.retest && (
        <span
          title="La position s'écartait de plus de 3 rangs du relevé précédent : une seconde mesure a été faite et retenue."
          className="text-[11px] text-muted-foreground"
        >
          Re-mesurée (1re mesure : {serp.retest.firstRank !== null ? `n°${serp.retest.firstRank}` : 'absente'})
        </span>
      )}
      {serp.features?.localPack && (
        <span className="rounded-md border border-[#38bdf8]/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-soft">
          Pack local affiché
        </span>
      )}
      {peopleAlsoAsk(serp).length > 0 && (
        <span title={peopleAlsoAsk(serp).join(' · ')} className="text-[11px] text-muted-foreground">
          {peopleAlsoAsk(serp).length} question(s) « Autres questions posées »
        </span>
      )}
      {previous && (
        <span className="text-[11px] text-muted-foreground">
          Avant : {historyRank(previous) !== null ? `n°${historyRank(previous)}` : 'absent'} le{' '}
          {new Date(previous.date).toLocaleDateString('fr-FR')}
        </span>
      )}
    </div>
  )
}

function StatusCell({ serp }: { serp?: SubpageItem['serp'] }) {
  if (!serp) return <span className="text-xs text-muted-foreground">Non mesuré</span>
  if (serp.status === 'RUNNING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-yellow-pale">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        En cours, résolvez un éventuel captcha dans la fenêtre Chrome
      </span>
    )
  }
  if (serp.status === 'BLOCKED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-soft">
        <ShieldAlert className="size-3.5" aria-hidden="true" />
        Captcha ou blocage : résolution manuelle requise
      </span>
    )
  }
  if (serp.status === 'PENDING') {
    return (
      <span className="inline-flex items-start gap-1.5 text-xs text-sky-soft">
        <Hourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {serp.message ?? 'En attente'}
      </span>
    )
  }
  if (serp.status === 'ERROR') return <span className="text-xs text-red-soft">{serp.message ?? 'Échec'}</span>
  return (
    <span className="text-xs text-muted-foreground">
      {serp.fetchedAt ? `Mesuré le ${new Date(serp.fetchedAt).toLocaleDateString('fr-FR')}` : 'Mesuré'}
    </span>
  )
}

/** Position d'un relevé en quelques mots (« n°4 », « Absent du Top 30 », « En attente ») */
function shortPosition(serp: NonNullable<SubpageItem['serp']>) {
  if (serp.status === 'RUNNING') return 'En cours'
  if (serp.status === 'PENDING') return 'En attente'
  if (serp.status !== 'DONE') return serp.message ?? 'Échec'
  return describePagePosition(serp).badge
}

/**
 * Requêtes mesurées pour la page (requête cible puis candidates génériques), avec leur position dans chaque zone. Le
 * relevé principal (requête visée, zone principale) est affiché au-dessus. Une requête peut devenir la requête cible
 * d'un clic : elle devient alors une requête choisie et la page est ré-analysée.
 */
function QueryPositions({
  page,
  busy,
  onChoose,
}: {
  page: SubpageItem
  busy: boolean
  onChoose: (query: string) => void
}) {
  const main = page.serp
  const others = (page.serpQueries ?? []).filter(
    (serp) => !(main && serp.query === main.query && serp.zone?.id === main.zone?.id),
  )
  if (others.length === 0) return null
  const groups = new Map<string, NonNullable<SubpageItem['serp']>[]>()
  for (const serp of others) groups.set(serp.query, [...(groups.get(serp.query) ?? []), serp])
  const suggested = (query: string) =>
    page.queryCandidates?.find(
      (candidate) =>
        normalizeText(query) === normalizeText(candidate.query) || normalizeText(query).startsWith(`${normalizeText(candidate.query)} `),
    )?.suggestedByGoogle
  // Requête déjà notée (la mesure peut porter sur la requête suivie du nom de la zone)
  const isScored = (query: string) =>
    (page.querySet ?? []).some(
      (entry) => normalizeText(query) === normalizeText(entry.query) || normalizeText(query).startsWith(`${normalizeText(entry.query)} `),
    )
  const done = others.filter((serp) => serp.status === 'DONE')
  const visible = done.filter((serp) => describePagePosition(serp).rank !== null).length
  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-shade-3e pt-2">
      <span className="text-[11px] text-muted-foreground">
        Autres mesures : visible sur {visible} sur {done.length}
      </span>
      {Array.from(groups.entries()).map(([query, measures]) => (
        <div key={query} className="flex flex-col gap-0.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground">« {query} »</span>
            {isScored(query) && <span className="text-[11px] text-muted-foreground">(requête notée)</span>}
            {suggested(query) && (
              <span className="rounded-md border border-[#38bdf8]/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-soft">
                Suggérée par Google
              </span>
            )}
            {page.isPillar && !isScored(query) && measures.some((serp) => serp.status === 'DONE') && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose(query)}
                className="text-[11px] font-semibold text-primary-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ajouter aux requêtes notées
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-2">
            {measures.map((serp) => (
              <span key={`${serp.query}-${serp.zone?.id ?? 'sans-zone'}`}>
                {serp.zone && (
                  <span className="text-muted-foreground" title={serp.sentQuery ? `Recherché : « ${serp.sentQuery} »` : undefined}>
                    {serp.zone.label} :{' '}
                  </span>
                )}
                <span className="font-semibold text-foreground">{shortPosition(serp)}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Requête proposée ou ajoutée pour une page, cochée si elle sera mesurée au prochain lancement */
type QueryChoice = {
  query: string
  origin: 'target' | 'scored' | 'volume' | 'google' | 'ai' | 'manual'
  on: boolean
  /** Recherches mensuelles (Keyword Planner) ; `simulated` : volume inventé par la source de démonstration */
  volume?: number
  simulated?: boolean
}

const ORIGIN_LABELS: Record<QueryChoice['origin'], string> = {
  target: 'Cible',
  scored: 'Notée',
  volume: 'Fort volume',
  google: 'Suggérée par Google',
  ai: 'Mot-clé de l’IA',
  manual: 'Ajoutée',
}

/**
 * Requêtes proposées d'une page : la requête cible d'abord, puis les mots-clés aux meilleurs volumes (Keyword Planner),
 * puis les candidates (suggérées par Google d'abord). Cible et mots-clés à fort volume sont cochés ; les candidates
 * complètent jusqu'à 3, comme la mesure par défaut du serveur.
 */
function defaultChoices(page: SubpageItem): QueryChoice[] {
  const candidates = page.queryCandidates ?? []
  // Requêtes notées (celles qui font la note de la page), sinon les mots-clés aux meilleurs volumes
  const research = page.keywords
  const volumes = page.querySet?.length
    ? page.querySet.map((entry) => ({ query: entry.query, origin: 'scored' as const, volume: entry.volume }))
    : (research?.rows ?? [])
        .filter((row) => row.forSerp)
        .map((row) => ({
          query: row.keyword,
          origin: 'volume' as const,
          volume: row.avgMonthlySearches ?? undefined,
          simulated: research?.simulated,
        }))
  // Page notée sur un groupe de requêtes : il remplace la requête cible ; seuls 3 mots-clés de l'IA suggérés par
  // Google sont proposés en plus, non cochés
  const scored = Boolean(page.querySet?.length)
  const proposals: Omit<QueryChoice, 'on'>[] = [
    ...(!scored && page.targetKeyword ? [{ query: page.targetKeyword, origin: 'target' as const }] : []),
    ...volumes,
    ...candidates
      .filter((candidate) => candidate.suggestedByGoogle)
      .slice(0, scored ? 3 : undefined)
      .map((candidate) => ({ query: candidate.query, origin: 'google' as const })),
    ...(scored ? [] : candidates.filter((candidate) => !candidate.suggestedByGoogle).map((candidate) => ({ query: candidate.query, origin: 'ai' as const }))),
  ]
  const choices: QueryChoice[] = []
  for (const proposal of proposals) {
    if (choices.some((choice) => normalizeText(choice.query) === normalizeText(proposal.query))) continue
    const checked = choices.filter((choice) => choice.on).length
    const on =
      proposal.origin === 'target' || proposal.origin === 'scored' || proposal.origin === 'volume'
        ? checked < MAX_CHOSEN_SERP_QUERIES
        : !scored && checked < MAX_SERP_QUERIES
    choices.push({ ...proposal, on })
  }
  return choices
}

/**
 * Requêtes à mesurer pour une page : les proposées se cochent ou se décochent, une requête saisie s'ajoute avec le
 * bouton « + » (ou Entrée) et se retire avec « × ». 6 requêtes cochées au plus.
 */
function QueryChooser({
  page,
  choices,
  disabled,
  onChange,
}: {
  page: SubpageItem
  choices: QueryChoice[]
  disabled: boolean
  onChange: (choices: QueryChoice[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const checked = choices.filter((choice) => choice.on).length
  const full = checked >= MAX_CHOSEN_SERP_QUERIES

  const add = () => {
    const query = draft.replace(/\s+/g, ' ').trim()
    if (!query) return
    if (choices.some((choice) => normalizeText(choice.query) === normalizeText(query))) {
      // Déjà proposée : elle est cochée plutôt qu'ajoutée en double
      onChange(choices.map((choice) => (normalizeText(choice.query) === normalizeText(query) ? { ...choice, on: choice.on || !full } : choice)))
      setNotice(full ? `${MAX_CHOSEN_SERP_QUERIES} requêtes cochées au plus : décochez-en une.` : 'Requête déjà dans la liste : elle est cochée.')
    } else if (full) {
      setNotice(`${MAX_CHOSEN_SERP_QUERIES} requêtes cochées au plus : décochez-en une.`)
      return
    } else {
      onChange([...choices, { query, origin: 'manual', on: true }])
      setNotice(null)
    }
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          maxLength={120}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Ajouter une requête"
          aria-label={`Requête à ajouter pour ${page.path}`}
          className="min-w-0 flex-1 rounded-xl border border-shade-44 bg-shade-18 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || !draft.trim()}
          title="Ajouter à l’analyse Google"
          aria-label={`Ajouter la requête à l’analyse Google de ${page.path}`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/60 text-primary-ink transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
      {choices.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label={`Requêtes à mesurer pour ${page.path}`}>
          {choices.map((choice, index) => (
            <li key={choice.query} className="flex items-start gap-1.5 text-xs">
              <input
                type="checkbox"
                id={`q-${page.id}-${index}`}
                checked={choice.on}
                disabled={disabled || (!choice.on && full)}
                onChange={() => onChange(choices.map((item, i) => (i === index ? { ...item, on: !item.on } : item)))}
                className="mt-0.5 size-3.5 shrink-0 accent-[#f5e400]"
              />
              <label htmlFor={`q-${page.id}-${index}`} className="min-w-0 flex-1 break-words">
                <span className={choice.on ? 'text-foreground' : 'text-muted-foreground line-through'}>{choice.query}</span>
                <span className="ml-1 text-[10px] font-semibold text-muted-foreground">· {ORIGIN_LABELS[choice.origin]}</span>
                {choice.volume !== undefined && (
                  <span className={`ml-1 text-[10px] font-semibold ${choice.simulated ? 'text-sky-soft' : 'text-muted-foreground'}`}>
                    · {choice.volume.toLocaleString('fr-FR')}/mois{choice.simulated ? ' (simulé)' : ''}
                  </span>
                )}
              </label>
              {choice.origin === 'manual' && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(choices.filter((_, i) => i !== index))}
                  aria-label={`Retirer « ${choice.query} »`}
                  title="Retirer"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-red-soft disabled:opacity-50"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[11px] text-muted-foreground">Aucune requête proposée : ajoutez-en une.</span>
      )}
      <span className="text-[11px] text-muted-foreground">
        {checked} requête(s) mesurée(s){full ? ` (maximum ${MAX_CHOSEN_SERP_QUERIES})` : ''}
      </span>
      {notice && <span className="text-[11px] text-sky-soft">{notice}</span>}
    </div>
  )
}

/**
 * Zone de la page : sa zone propre, une ville repérée à confirmer, ou les zones du projet. Changer la zone d'une page ne
 * modifie que ses mesures Google (et les recherches proposées à sa prochaine analyse IA).
 */
function PageZoneControl({
  projectId,
  page,
  projectZones,
  onSaved,
}: {
  projectId: string
  page: SubpageItem
  projectZones: GeoZone[]
  onSaved: () => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (zone: { kind: GeoZone['kind']; code: string } | null) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/page-zone`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: page.url, zone }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
      setEditing(false)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  // Ville repérée par l'IA : première commune de ce nom proposée par l'API Géo
  const attachSuggestion = async () => {
    if (!page.zoneSuggestion) return
    setSaving(true)
    setError(null)
    try {
      // Établissement : recherche par code postal, puis la commune dont le nom correspond (plusieurs par code postal)
      const res = await fetch(
        `/api/geo/search?q=${encodeURIComponent(page.zoneSuggestionPostalCode ?? page.zoneSuggestion)}`,
      )
      const data = await res.json().catch(() => ({}))
      const communes = ((data.zones as GeoZone[] | undefined) ?? []).filter((zone) => zone.kind === 'commune')
      const wanted = normalizeText(page.zoneSuggestion)
      const commune =
        communes.find((zone) => normalizeText(zone.name) === wanted) ??
        communes.find((zone) => normalizeText(zone.name).startsWith(wanted)) ??
        communes[0]
      if (!commune) throw new Error(`Ville « ${page.zoneSuggestion} » introuvable : choisissez la zone à la main`)
      await save({ kind: commune.kind, code: commune.code })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible')
      setSaving(false)
    }
  }

  return (
    <div className="mt-1 flex flex-col gap-1 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <MapPin className="size-3" aria-hidden="true" />
          {page.zone
            ? `Zone de la page : ${page.zone.label}`
            : projectZones.length > 0
              ? `Zones du projet (${projectZones.map((zone) => zone.label).join(', ')})`
              : 'Sans zone'}
        </span>
        {page.zone ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => save(null)}
            className="font-semibold text-primary-ink hover:underline disabled:opacity-50"
          >
            Revenir aux zones du projet
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => setEditing((value) => !value)}
            aria-expanded={editing}
            className="font-semibold text-primary-ink hover:underline disabled:opacity-50"
          >
            Choisir une zone
          </button>
        )}
        {!page.zone && page.zoneSuggestion && (
          <button
            type="button"
            disabled={saving}
            onClick={attachSuggestion}
            className="rounded-md border border-[#38bdf8]/40 px-1.5 py-0.5 font-semibold text-sky-soft hover:bg-[#38bdf8]/10 disabled:opacity-50"
          >
            Rattacher à {page.zoneSuggestion} ?
          </button>
        )}
      </div>
      {editing && <ZonePicker disabled={saving} onPick={(zone) => save({ kind: zone.kind, code: zone.code })} />}
      {error && <span role="alert" className="text-red-soft">{error}</span>}
    </div>
  )
}

export function PositioningView({ projectId }: { projectId: string }) {
  const { audit, state, auditDbId, refreshAudit } = useAudit()
  const { openInspection } = useInspection()
  const { serpPerRun, serpPerDay } = useSettings()
  // Recherches Google déjà envoyées aujourd'hui (tous projets) : relu à l'ouverture et à la fin de chaque mesure
  const [usedToday, setUsedToday] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<'pillars' | 'all'>('pillars')
  const [selected, setSelected] = useState<string[]>([])
  // Requêtes à mesurer modifiées par l'utilisateur (identifiant de page vers liste) ; sinon les requêtes proposées
  const [queryChoices, setQueryChoices] = useState<Record<string, QueryChoice[]>>({})
  const choicesOf = (page: SubpageItem) => queryChoices[page.id] ?? defaultChoices(page)
  const chosenOf = (page: SubpageItem) => choicesOf(page).filter((choice) => choice.on).map((choice) => choice.query)

  const allPages = (audit?.subpages ?? []).filter((page) => page.indexable && page.httpStatus < 400)
  const hasPillars = allPages.some((page) => page.isPillar)
  // Sans pilier choisi (avant l'analyse IA), toutes les pages sont proposées
  const effectiveScope = hasPillars ? scope : 'all'
  const pages = effectiveScope === 'pillars' ? allPages.filter((page) => page.isPillar) : allPages
  const queriesOf = (page: SubpageItem) => (page.serpQueries?.length ? page.serpQueries : page.serp ? [page.serp] : [])
  const running = allPages.some((page) => queriesOf(page).some((serp) => serp.status === 'RUNNING'))
  const pendingPages = allPages.filter((page) => queriesOf(page).some((serp) => serp.status === 'PENDING'))
  const pendingCount = pendingPages.reduce(
    (sum, page) => sum + queriesOf(page).filter((serp) => serp.status === 'PENDING').length,
    0,
  )

  useEffect(() => {
    if (running) return
    let active = true
    fetch('/api/serp-usage', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && typeof data?.usedToday === 'number') setUsedToday(data.usedToday)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [running])

  // Suivi de l'avancement tant qu'une recherche est en cours
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      void refreshAudit()
    }, 3000)
    return () => clearInterval(timer)
  }, [running, refreshAudit])

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="Positionnement" />

  const launch = async (pageIds: string[], resume = false) => {
    if (!auditDbId || pageIds.length === 0) return
    setLaunching(true)
    setError(null)
    try {
      // Requêtes cochées de chaque page ; une reprise refait les recherches en attente, sans liste
      const targets = allPages.filter((page) => pageIds.includes(page.id))
      const empty = resume ? [] : targets.filter((page) => chosenOf(page).length === 0)
      if (empty.length > 0) {
        throw new Error(`Aucune requête cochée pour ${empty.map((page) => page.path).join(', ')} : cochez-en ou ajoutez-en une.`)
      }
      const queryLists = resume ? {} : Object.fromEntries(targets.map((page) => [page.id, chosenOf(page)]))
      const res = await fetch(`/api/audits/${auditDbId}/serp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds, queryLists, budget: { perRun: serpPerRun, perDay: serpPerDay }, resume }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `Erreur ${res.status}`)
      }
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lancement impossible')
    } finally {
      setLaunching(false)
    }
  }

  // Requête mesurée ajoutée aux requêtes notées de la page (6 au plus) : note recalculée sans l'IA
  const chooseQuery = async (pageId: string, query: string) => {
    if (!auditDbId) return
    const current = (allPages.find((item) => item.id === pageId)?.querySet ?? []).map((entry) => entry.query)
    if (current.length >= 6) {
      setError('6 requêtes notées au plus : retirez-en une dans le tiroir de la page (onglet Contenu).')
      return
    }
    setLaunching(true)
    setError(null)
    try {
      const res = await fetch(`/api/audits/${auditDbId}/pages/${pageId}/queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [...current, query] }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `Erreur ${res.status}`)
      }
      await refreshAudit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Changement de requête impossible')
    } finally {
      setLaunching(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  const visibleIds = pages.map((page) => page.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const selectedCount = selected.filter((id) => visibleIds.includes(id) || allPages.some((p) => p.id === id)).length
  const tooMany = selectedCount > MAX_PER_RUN

  // Plan : requêtes cochées de chaque page, dans chaque zone ; une page hors du Top 10 coûte jusqu'à 3 pages de
  // résultats par requête (pages 2 et 3)
  const plannedQueries = allPages
    .filter((page) => selected.includes(page.id))
    .reduce((sum, page) => {
      const zoneCount = page.zone ? 1 : Math.max(1, audit.zones?.length ?? 0)
      return sum + chosenOf(page).length * zoneCount
    }, 0)
  const remainingToday = usedToday === null ? null : Math.max(0, serpPerDay - usedToday)
  const allowed = remainingToday === null ? serpPerRun : Math.min(serpPerRun, remainingToday)

  const measured = allPages.filter((page) => page.serp?.status === 'DONE')
  const rankOf = (page: SubpageItem) => (page.serp ? describePagePosition(page.serp).rank : null)
  const inTop3 = measured.filter((page) => (rankOf(page) ?? 99) <= 3).length
  const inTop10 = measured.filter((page) => (rankOf(page) ?? 99) <= 10).length

  // Domaines qui reviennent le plus dans les résultats des requêtes mesurées
  const domainCounts = new Map<string, number>()
  for (const page of measured) {
    for (const domain of new Set((page.serp?.results ?? []).map((result) => result.domain))) {
      if (!domain || domain === audit.domain || domain.endsWith(`.${audit.domain}`)) continue
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1)
    }
  }
  const topCompetitors = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Positionnement" />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Positionnement Google</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Position de vos pages dans Google sur les requêtes cochées : la requête cible et les recherches
            génériques proposées (suggestions Google, puis IA), sans le nom de la marque. Gardez, retirez ou ajoutez
            des requêtes avant de lancer ({MAX_CHOSEN_SERP_QUERIES} au plus par page). Mesure faite dans une fenêtre
            Chrome locale : cochez les pages à analyser, quelques-unes à la fois.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={launching || running || selectedCount === 0 || tooMany}
            onClick={() => launch(selected)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-[#e0d100] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {launching || running ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            Analyser la sélection ({selectedCount})
          </button>
          {pendingCount > 0 && (
            <button
              type="button"
              disabled={launching || running}
              onClick={() => launch(pendingPages.map((page) => page.id), true)}
              className="inline-flex items-center gap-2 rounded-xl border border-[#38bdf8]/50 px-4 py-2.5 text-sm font-semibold text-sky-soft transition-colors hover:bg-[#38bdf8]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCw className="size-4" aria-hidden="true" />
              Reprendre ({pendingCount} en attente)
            </button>
          )}
        </div>
      </div>

      <ZonesPanel projectId={projectId} zones={audit.zones ?? []} onSaved={refreshAudit} />
      {audit.localVisibility && <LocalVisibilitySection data={audit.localVisibility} />}

      <p className="rounded-xl border border-line-yellow bg-tint-yellow p-3 text-xs text-yellow-pale sm:text-sm">
        Les recherches automatisées vont à l’encontre des conditions d’utilisation de Google. Utilisez un profil Chrome
        dédié (jamais connecté à un compte personnel), espacez les lancements ({MAX_PER_RUN} pages au plus à la fois),
        et résolvez vous-même tout captcha dans la fenêtre. Les positions varient selon le lieu et le profil : elles
        donnent une indication.
      </p>

      <p className="rounded-xl border border-shade-3e bg-shade-1e p-3 text-xs text-muted-foreground sm:text-sm">
        <span className="font-semibold text-foreground">Budget de recherches Google : </span>
        {serpPerRun} par lancement · {usedToday === null ? '…' : `${usedToday} sur ${serpPerDay} utilisées aujourd’hui`}
        {selectedCount > 0 && (
          <>
            {' · '}Sélection : <span className="font-semibold text-foreground">{plannedQueries} requête(s)</span>, de{' '}
            {plannedQueries} à {plannedQueries * 3} recherches (pages 2 et 3 lues si la page n’est pas dans le Top 10).
            {plannedQueries > allowed
              ? ` Au-delà de ${allowed}, les recherches restent en attente : requête visée de chaque page d’abord.`
              : ''}
          </>
        )}{' '}
        <Link href="/parametres" className="text-primary-ink hover:underline">
          Modifier le budget
        </Link>
      </p>

      {tooMany && (
        <p className="text-sm text-red-soft">
          Sélection trop grande : {MAX_PER_RUN} pages au maximum par lancement.
        </p>
      )}
      {error && <p className="text-sm text-red-soft">{error}</p>}

      <section aria-label="Résumé" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Pages mesurées', value: `${measured.length} / ${allPages.length}`, hint: 'pages indexables du site' },
          { label: 'Dans le Top 3', value: String(inTop3), hint: `${inTop10} dans le Top 10` },
          { label: 'Absentes du Top', value: String(measured.length - inTop10), hint: 'pages à renforcer en priorité' },
        ].map((tile) => (
          <div key={tile.label} className="glass-card glass-lift rounded-2xl border p-5">
            <span className="block text-3xl font-extrabold tracking-tight text-foreground">{tile.value}</span>
            <span className="mt-1 block text-sm font-semibold text-foreground">{tile.label}</span>
            <span className="block text-xs text-muted-foreground">{tile.hint}</span>
          </div>
        ))}
      </section>

      {topCompetitors.length > 0 && (
        <section className="glass-card rounded-2xl border p-5">
          <h2 className="text-base font-bold text-foreground">Concurrents qui reviennent</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Domaines présents dans les résultats de plusieurs de vos requêtes.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {topCompetitors.map(([domain, count]) => (
              <span key={domain} className="rounded-full border border-shade-44 px-3 py-1 text-xs text-foreground">
                {domain} <span className="text-muted-foreground">× {count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="glass-card rounded-2xl border p-4 md:p-6">
        {hasPillars && (
          <div className="mb-4 inline-flex rounded-xl border border-shade-38 bg-shade-14 p-1">
            {(
              [
                { key: 'pillars', label: 'Pages piliers' },
                { key: 'all', label: 'Toutes les pages' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setScope(tab.key)}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  effectiveScope === tab.key
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="overflow-x-auto xl:overflow-visible">
          {/* Largeur fixe des colonnes, texte qui passe à la ligne : jamais de défilement horizontal */}
          <table className="w-full table-fixed border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-sm text-foreground">
                <th scope="col" className="w-10 rounded-l-xl bg-shade-38 px-3 py-3 font-normal">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected((current) =>
                        allVisibleSelected
                          ? current.filter((id) => !visibleIds.includes(id))
                          : Array.from(new Set([...current, ...visibleIds])),
                      )
                    }
                    className="size-4 accent-[#f5e400]"
                  />
                </th>
                <th scope="col" className="w-[26%] bg-shade-38 px-3 py-3 font-normal">Page</th>
                <th scope="col" className="w-[21%] bg-shade-38 px-3 py-3 font-normal">Requêtes à mesurer</th>
                <th scope="col" className="w-[25%] bg-shade-38 px-3 py-3 font-normal">Position</th>
                <th scope="col" className="w-[13%] bg-shade-38 px-3 py-3 font-normal">État</th>
                <th scope="col" className="rounded-r-xl bg-shade-38 px-3 py-3 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => {
                const serp = page.serp
                return (
                  <Fragment key={page.id}>
                    <tr className="border-b border-shade-3e hover:bg-shade-33/40">
                      <td className="px-3 py-4 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner ${page.path}`}
                          checked={selected.includes(page.id)}
                          onChange={() => toggle(page.id)}
                          className="size-4 accent-[#f5e400]"
                        />
                      </td>
                      <th scope="row" className="px-4 py-4 align-top font-normal">
                        <button
                          type="button"
                          onClick={() => openInspection(page.id)}
                          className="text-left"
                        >
                          <span className="block max-w-xs truncate font-semibold text-foreground hover:text-primary-ink">
                            {page.title}
                          </span>
                          <span className="block text-sm text-muted-foreground">{page.path}</span>
                        </button>
                        <span className="mt-1 inline-flex items-center gap-1.5">
                          <span className="rounded-full border border-shade-44 px-2 py-0.5 text-[11px] text-muted-foreground">
                            {page.roleLabel}
                          </span>
                          {page.isPillar && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary-ink">
                              Pilier
                            </span>
                          )}
                        </span>
                        <PageZoneControl
                          projectId={projectId}
                          page={page}
                          projectZones={audit.zones ?? []}
                          onSaved={refreshAudit}
                        />
                      </th>
                      <td className="px-3 py-4 align-top">
                        <QueryChooser
                          page={page}
                          choices={choicesOf(page)}
                          disabled={launching || running}
                          onChange={(choices) => setQueryChoices((prev) => ({ ...prev, [page.id]: choices }))}
                        />
                      </td>
                      <td className="px-3 py-4 align-top">
                        <PositionBadge serp={serp} history={page.serpHistory} />
                        {page.serpOutdatedQuery && (
                          <p className="mt-1 max-w-[260px] text-[11px] text-sky-soft">
                            Mesure de l’ancienne requête « {page.serpOutdatedQuery} ». La requête visée est maintenant
                            « {page.targetKeyword} » : relancez l’analyse de cette page.
                          </p>
                        )}
                        {page.serpTargetSkipped && (
                          <p className="mt-1 max-w-[260px] text-[11px] text-sky-soft">
                            Requête cible « {page.targetKeyword} » décochée au dernier lancement : position de « {serp?.query} »
                            affichée.
                          </p>
                        )}
                        <QueryPositions
                          page={page}
                          busy={launching || running}
                          onChoose={(query) => chooseQuery(page.id, query)}
                        />
                      </td>

                      <td className="px-3 py-4 align-top">
                        <StatusCell serp={serp} />
                      </td>
                      <td className="px-3 py-4 align-top">
                        {/* Boutons l'un sous l'autre : la colonne reste étroite, sans défilement horizontal */}
                        <div className="flex flex-col items-start gap-1.5">
                          <button
                            type="button"
                            disabled={launching || running || chosenOf(page).length === 0}
                            onClick={() => launch([page.id])}
                            className="text-xs font-semibold text-primary-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {serp ? 'Relancer' : 'Analyser'}
                          </button>
                          {(page.serpQueries ?? [page.serp]).some((item) => item?.status === 'DONE') && (
                            <button
                              type="button"
                              onClick={() => setExpanded(expanded === page.id ? null : page.id)}
                              aria-expanded={expanded === page.id}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-ink hover:underline"
                            >
                              {expanded === page.id ? 'Masquer les résultats' : 'Voir les résultats'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === page.id && (
                      <tr>
                        <td colSpan={6} className="bg-shade-24 px-4 py-5 md:px-6">
                          <SerpInsights page={page} domain={audit.domain} auditDbId={auditDbId} onRefresh={refreshAudit} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {pages.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    Aucune page à afficher.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <PageInspectionSheet />
    </div>
  )
}
