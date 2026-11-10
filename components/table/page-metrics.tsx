'use client'

import { useMemo, type ReactNode } from 'react'
import type { InspectionData, PillarPage, ProjectAuditData, SubpageItem } from '@/lib/audit-data'
import { describePagePosition } from '@/lib/serp-labels'
import type { ColumnSpec } from './customizable-table'

/**
 * Catalogue des métriques d'une page, ajoutables comme colonnes dans tous les tableaux de pages (Sous-pages,
 * Positionnement, SEO éditorial). Chaque métrique lit les données déjà chargées de l'audit (liste des pages, pages
 * stratégiques, fiche d'inspection, anomalies) : aucun appel en plus. Une donnée absente s'affiche « — ».
 * Métriques masquées par défaut ; identifiants `m:…` stables, gardés dans la disposition de chaque utilisateur.
 */

export type PageSources = {
  sub?: SubpageItem
  pillar?: PillarPage
  inspection?: InspectionData
  issues?: { critical: number; warning: number; minor: number }
}

type Metric = {
  id: string
  label: string
  group: string
  width: number
  description?: string
  value: (page: PageSources) => ReactNode
}

const Missing = () => <span className="text-muted-foreground">—</span>
const text = (value: string | null | undefined, title = true): ReactNode =>
  value ? (
    <span className="block truncate" title={title ? value : undefined}>
      {value}
    </span>
  ) : (
    <Missing />
  )
const count = (value: number | null | undefined, unit = ''): ReactNode =>
  value === null || value === undefined || Number.isNaN(value) ? <Missing /> : <span className="tabular-nums">{`${value.toLocaleString('fr-FR')}${unit}`}</span>
const yesNo = (value: boolean | undefined): ReactNode => (value === undefined ? <Missing /> : value ? 'Oui' : 'Non')
/** Note sur 100 : le chiffre et sa mention en mots (la couleur seule ne dit rien) */
const score = (value: number | null | undefined): ReactNode =>
  value === null || value === undefined ? (
    <Missing />
  ) : (
    <span className="whitespace-nowrap">
      <strong className="tabular-nums">{value}</strong>
      <span className="text-muted-foreground">/100 · {value >= 80 ? 'solide' : value >= 60 ? 'à consolider' : 'à corriger'}</span>
    </span>
  )
const delta = (now: number | null | undefined, before: number | null | undefined): ReactNode => {
  if (now === null || now === undefined || before === null || before === undefined) return <Missing />
  const gap = Math.round(now - before)
  return gap === 0 ? <span className="text-muted-foreground">stable</span> : <span className={gap > 0 ? 'text-green-soft' : 'text-red-soft'}>{gap > 0 ? `+${gap}` : `−${Math.abs(gap)}`} pts</span>
}
const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : undefined)
const INTENT: Record<string, string> = { INFORMATIONAL: 'Informationnelle', COMMERCIAL: 'Commerciale', TRANSACTIONAL: 'Transactionnelle', NAVIGATIONAL: 'Navigationnelle' }
const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Meilleure position mesurée parmi les relevés du dernier lancement */
function bestRank(sub?: SubpageItem): number | null {
  const ranks = (sub?.serpQueries ?? (sub?.serp ? [sub.serp] : []))
    .filter((serp) => serp.status === 'DONE')
    .map((serp) => describePagePosition(serp).rank)
    .filter((rank): rank is number => rank !== null)
  return ranks.length ? Math.min(...ranks) : null
}

const STATIC_METRICS: Metric[] = [
  // ----- Page
  { id: 'm:title', label: 'Title', group: 'Page', width: 260, value: (p) => text(p.inspection?.details.title) },
  { id: 'm:title-length', label: 'Longueur du Title', group: 'Page', width: 140, description: 'En caractères (45 à 60 conseillés)', value: (p) => count(p.inspection?.details.title?.length, ' car.') },
  { id: 'm:meta', label: 'Méta description', group: 'Page', width: 300, value: (p) => text(p.inspection?.details.metaDescription) },
  { id: 'm:meta-length', label: 'Longueur de la méta', group: 'Page', width: 150, description: 'En caractères (130 à 155 conseillés)', value: (p) => count(p.inspection?.details.metaDescription?.length, ' car.') },
  { id: 'm:h1', label: 'H1', group: 'Page', width: 240, value: (p) => text(p.inspection?.details.h1) },
  { id: 'm:role', label: 'Rôle', group: 'Page', width: 160, value: (p) => text(p.sub?.roleLabel ?? p.pillar?.roleLabel) },
  { id: 'm:family', label: 'Famille', group: 'Page', width: 140, value: (p) => text(p.sub?.familyLabel ?? p.pillar?.familyLabel) },
  { id: 'm:pillar', label: 'Page stratégique', group: 'Page', width: 140, value: (p) => yesNo(p.sub ? p.sub.isPillar : p.pillar ? true : undefined) },
  { id: 'm:words', label: 'Nombre de mots', group: 'Page', width: 130, value: (p) => count(p.sub?.wordCount ?? p.inspection?.details.wordCount) },

  // ----- Indexation
  { id: 'm:http', label: 'Statut HTTP', group: 'Indexation', width: 120, value: (p) => count(p.sub?.httpStatus ?? p.inspection?.httpStatus) },
  { id: 'm:indexable', label: 'Indexable', group: 'Indexation', width: 110, value: (p) => yesNo(p.sub?.indexable ?? p.inspection?.indexable) },
  { id: 'm:follow', label: 'Liens suivis', group: 'Indexation', width: 120, description: 'Directive follow des robots', value: (p) => yesNo(p.inspection?.follow ?? p.pillar?.follow) },
  { id: 'm:robots', label: 'Balise robots', group: 'Indexation', width: 160, value: (p) => text(p.inspection?.details.robots) },
  { id: 'm:canonical', label: 'Canonical', group: 'Indexation', width: 260, value: (p) => text(p.inspection?.details.canonical) },
  { id: 'm:redirect', label: 'Redirige vers', group: 'Indexation', width: 240, value: (p) => text(p.inspection?.details.redirectUrl) },

  // ----- Technique et vitesse
  { id: 'm:tech', label: 'Score technique', group: 'Technique', width: 170, value: (p) => score(p.sub?.techScore ?? p.inspection?.tech.score) },
  { id: 'm:tech-delta', label: 'Écart technique', group: 'Technique', width: 140, description: 'Depuis l’audit terminé précédent (même adresse)', value: (p) => delta(p.inspection?.tech.score, p.inspection?.essentials?.previous?.tech) },
  { id: 'm:tech-coverage', label: 'Points techniques mesurés', group: 'Technique', width: 180, value: (p) => (p.inspection?.tech.coverage ? count(p.inspection.tech.coverage.measured, ` / ${p.inspection.tech.coverage.total}`) : <Missing />) },
  { id: 'm:response', label: 'Temps de réponse', group: 'Technique', width: 140, value: (p) => text(p.sub?.responseTime ?? p.inspection?.responseTime, false) },
  { id: 'm:lcp', label: 'LCP (affichage)', group: 'Technique', width: 130, description: 'Largest Contentful Paint, en secondes (bon jusqu’à 2,5 s)', value: (p) => count(p.inspection?.essentials?.cwv?.lcp, ' s') },
  { id: 'm:inp', label: 'INP (réactivité)', group: 'Technique', width: 130, description: 'Interaction to Next Paint, en millisecondes (bon jusqu’à 200 ms)', value: (p) => count(p.inspection?.essentials?.cwv?.inp, ' ms') },
  { id: 'm:cls', label: 'CLS (stabilité)', group: 'Technique', width: 130, description: 'Cumulative Layout Shift (bon jusqu’à 0,1)', value: (p) => count(p.inspection?.essentials?.cwv?.cls) },
  { id: 'm:images-alt', label: 'Images sans alt', group: 'Technique', width: 140, value: (p) => count(p.inspection?.details.imagesWithoutAlt?.length ?? (p.inspection ? 0 : undefined)) },
  { id: 'm:top-loss', label: 'Plus gros point perdu', group: 'Technique', width: 260, description: 'Critère qui coûte le plus de points à la page', value: (p) => {
    const loss = p.inspection?.essentials?.losses[0]
    return loss ? <span className="block truncate" title={loss.label}>{loss.label} <span className="text-muted-foreground">(−{Math.round(loss.lost)} pts)</span></span> : <Missing />
  } },

  // ----- Maillage
  { id: 'm:depth', label: 'Profondeur de clic', group: 'Maillage', width: 140, value: (p) => text(p.sub?.depth, false) },
  { id: 'm:inlinks', label: 'Liens entrants', group: 'Maillage', width: 130, value: (p) => count(p.sub?.inlinks ?? p.inspection?.details.inlinks) },

  // ----- Contenu (pages stratégiques)
  { id: 'm:editorial', label: 'Score éditorial', group: 'Contenu', width: 170, value: (p) => score(p.pillar?.editorialScore ?? (p.sub?.isPillar ? p.inspection?.editorial.score : undefined)) },
  { id: 'm:editorial-delta', label: 'Écart éditorial', group: 'Contenu', width: 140, description: 'Depuis l’audit terminé précédent (même adresse)', value: (p) => delta(p.pillar?.editorialScore, p.inspection?.essentials?.previous?.editorial) },
  { id: 'm:intent', label: 'Intention de la page', group: 'Contenu', width: 170, value: (p) => text(p.inspection?.editorial.intentSummary ? INTENT[p.inspection.editorial.intentSummary.page] : undefined) },
  { id: 'm:intent-google', label: 'Intention de Google', group: 'Contenu', width: 170, value: (p) => text(p.inspection?.editorial.intentSummary?.google ? INTENT[p.inspection.editorial.intentSummary.google] : undefined) },
  { id: 'm:intent-match', label: 'Intent Match', group: 'Contenu', width: 130, value: (p) => (p.pillar ? count(p.pillar.intentMatchScore, '/20') : <Missing />) },
  { id: 'm:hot-zones', label: 'Couverture des recherches', group: 'Contenu', width: 190, value: (p) => (p.pillar ? count(p.pillar.hotZonesScore, '/15') : <Missing />) },
  { id: 'm:cannibal', label: 'Cannibalisation', group: 'Contenu', width: 220, value: (p) =>
    p.pillar ? (p.pillar.cannibalizationStatus === 'none' ? 'Aucune' : text(`${p.pillar.cannibalizationStatus === 'partial' ? 'Partielle' : 'Conflit'} avec ${p.pillar.cannibalizationTarget ?? '?'}`)) : <Missing /> },
  { id: 'm:rewrite', label: 'Réécriture', group: 'Contenu', width: 150, value: (p) => {
    const rewrite = p.inspection?.editorial.rewrite
    return rewrite ? (rewrite.outdated ? <span className="text-sky-soft">Périmée</span> : `Proposée le ${date(rewrite.createdAt)}`) : <Missing />
  } },

  // ----- Recherches
  { id: 'm:main-query', label: 'Requête principale', group: 'Recherches', width: 220, value: (p) => text((p.sub?.querySet ?? p.pillar?.querySet)?.[0]?.query) },
  { id: 'm:query-count', label: 'Nombre de requêtes notées', group: 'Recherches', width: 190, value: (p) => count((p.sub?.querySet ?? p.pillar?.querySet)?.length) },
  { id: 'm:query-volume', label: 'Volume des requêtes notées', group: 'Recherches', width: 200, description: 'Recherches par mois (Google Keyword Planner)', value: (p) => {
    const set = p.sub?.querySet ?? p.pillar?.querySet
    return set?.some((entry) => entry.volume !== undefined) ? count(set.reduce((sum, entry) => sum + (entry.volume ?? 0), 0), '/mois') : <Missing />
  } },
  { id: 'm:keywords', label: 'Mots-clés avec volume', group: 'Recherches', width: 170, value: (p) => {
    const research = p.sub?.keywords ?? p.inspection?.editorial.keywords
    return research ? count(research.rows.filter((row) => (row.avgMonthlySearches ?? 0) > 0).length) : <Missing />
  } },
  { id: 'm:best-keyword', label: 'Mot-clé le plus recherché', group: 'Recherches', width: 240, value: (p) => {
    const rows = (p.sub?.keywords ?? p.inspection?.editorial.keywords)?.rows ?? []
    const best = [...rows].sort((a, b) => (b.avgMonthlySearches ?? -1) - (a.avgMonthlySearches ?? -1))[0]
    return best && best.avgMonthlySearches !== null ? text(`${best.keyword} · ${best.avgMonthlySearches.toLocaleString('fr-FR')}/mois`) : <Missing />
  } },
  { id: 'm:opportunities', label: 'Recherches hors page intégrables', group: 'Recherches', width: 230, value: (p) => {
    const opportunities = p.inspection?.editorial.opportunities
    return opportunities ? count(opportunities.rows.filter((row) => row.status === 'ready').length) : <Missing />
  } },

  // ----- Google
  { id: 'm:position', label: 'Position Google', group: 'Google', width: 160, description: 'Requête visée, dernier relevé', value: (p) => (p.sub?.serp?.status === 'DONE' ? describePagePosition(p.sub.serp).badge : <Missing />) },
  { id: 'm:best-position', label: 'Meilleure position', group: 'Google', width: 160, description: 'Toutes les requêtes du dernier lancement', value: (p) => { const rank = bestRank(p.sub); return rank === null ? <Missing /> : `n°${rank}` } },
  { id: 'm:measured', label: 'Requêtes mesurées', group: 'Google', width: 150, value: (p) => count(p.sub ? (p.sub.serpQueries ?? []).filter((serp) => serp.status === 'DONE').length : undefined) },
  { id: 'm:measured-on', label: 'Dernière mesure', group: 'Google', width: 150, value: (p) => text(date(p.sub?.serp?.fetchedAt), false) },
  { id: 'm:position-trend', label: 'Évolution de la position', group: 'Google', width: 180, description: 'Requête visée : premier et dernier relevé', value: (p) => {
    const history = (p.sub?.serpHistory ?? []).filter((entry) => entry.query === p.sub?.serp?.query && entry.pagePosition !== null)
    if (history.length < 2) return <Missing />
    const first = history[0].pagePosition as number
    const last = history[history.length - 1].pagePosition as number
    return first === last ? <span className="text-muted-foreground">stable (n°{last})</span> : <span className={last < first ? 'text-green-soft' : 'text-red-soft'}>n°{first} → n°{last}</span>
  } },
  { id: 'm:local-pack', label: 'Pack local', group: 'Google', width: 140, value: (p) => {
    const serp = p.sub?.serp
    if (serp?.status !== 'DONE') return <Missing />
    if (!serp.features?.localPack) return 'Aucun'
    return serp.localPackRank === undefined ? 'Fiches non lues' : serp.localPackRank === null ? 'Absent' : `n°${serp.localPackRank}`
  } },
  { id: 'm:zone', label: 'Zone de la page', group: 'Google', width: 170, value: (p) => text(p.sub?.zone?.label ?? 'Zones du projet', false) },

  // ----- Anomalies
  { id: 'm:issues-critical', label: 'Anomalies critiques', group: 'Anomalies', width: 160, value: (p) => count(p.issues?.critical ?? 0) },
  { id: 'm:issues-warning', label: 'Avertissements', group: 'Anomalies', width: 140, value: (p) => count(p.issues?.warning ?? 0) },
  { id: 'm:issues-minor', label: 'Recommandations mineures', group: 'Anomalies', width: 190, value: (p) => count(p.issues?.minor ?? 0) },
]

/** Sources de chaque page de l'audit, par identifiant : liste des pages, page stratégique, fiche, anomalies */
export function usePageSources(audit: ProjectAuditData | null | undefined): (id: string) => PageSources {
  return useMemo(() => {
    const subs = new Map((audit?.subpages ?? []).map((page) => [page.id, page]))
    const pillars = new Map((audit?.pillarPages ?? []).map((page) => [page.id, page]))
    const issues = new Map<string, { critical: number; warning: number; minor: number }>()
    for (const issue of audit?.globalIssues ?? []) {
      for (const url of issue.impactedUrls ?? []) {
        const entry = issues.get(url.id) ?? { critical: 0, warning: 0, minor: 0 }
        if (issue.severity === 'critical') entry.critical++
        else if (issue.severity === 'warning') entry.warning++
        else entry.minor++
        issues.set(url.id, entry)
      }
    }
    return (id: string) => ({ sub: subs.get(id), pillar: pillars.get(id), inspection: audit?.inspections[id], issues: issues.get(id) })
  }, [audit])
}

/**
 * Colonnes de métriques pour un tableau dont chaque ligne est une page : toutes les métriques du catalogue, plus une
 * colonne par critère éditorial rencontré dans l'audit (« Contenu · Lisibilité », en % des points), masquées par
 * défaut. `exclude` retire celles que le tableau montre déjà.
 */
export function usePageMetricColumns<T>(
  audit: ProjectAuditData | null | undefined,
  idOf: (row: T) => string,
  exclude: string[] = [],
): ColumnSpec<T>[] {
  const sourcesOf = usePageSources(audit)
  // Critères éditoriaux présents dans l'audit (les noms dépendent du rôle et de l'objectif des pages)
  const editorialNames = useMemo(() => {
    const names = new Set<string>()
    for (const inspection of Object.values(audit?.inspections ?? {})) for (const category of inspection.editorial.categories) names.add(category.name)
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [audit])
  const excludeKey = exclude.join('|')

  return useMemo(() => {
    const metrics: Metric[] = [
      ...STATIC_METRICS,
      ...editorialNames.map((name) => ({
        id: `m:edito:${slug(name)}`,
        label: `Contenu · ${name}`,
        group: 'Critères éditoriaux',
        width: 170,
        description: 'Part des points obtenus sur ce critère',
        value: (p: PageSources) => count(p.inspection?.editorial.categories.find((category) => category.name === name)?.score, ' %'),
      })),
    ]
    return metrics
      .filter((metric) => !excludeKey.split('|').includes(metric.id))
      .map((metric) => ({
        id: metric.id,
        label: metric.label,
        group: metric.group,
        width: metric.width,
        minWidth: 96,
        defaultHidden: true,
        description: metric.description,
        cellClassName: 'text-sm text-foreground',
        cell: (row: T) => metric.value(sourcesOf(idOf(row))),
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesOf, editorialNames, excludeKey])
}
