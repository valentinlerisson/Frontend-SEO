'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowUpRight, ChevronDown, FileText, Link2, Lock, MapPinned, Search, Sparkles } from 'lucide-react'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useAudit } from '@/components/providers/audit-provider'
import { AuditStateGate, PhaseLockBanner } from './audit-state-gate'
import { backlinkSummary, releaseLabel } from '@/lib/backlink-labels'
import { bandOf } from '@/lib/score-bands'
import type { DashboardData, LocalVisibility, ProjectAuditData } from '@/lib/audit-data'
import { describeCrawlScope } from '@/core/domain/crawl-scope'
import { GEO_ENABLED } from '@/core/domain/features'
import { PILLAR_WEIGHTS } from '@/core/domain/scoring/GlobalScoringEngine'
import { BAND_STYLE, BarMeter, compact, Delta, lowerFirst, RingMeter, Sparkline, StackedBar } from '@/components/charts/viz'

type Pillar = 'tech' | 'editorial' | 'geo'
const PILLAR_LABEL: Record<Pillar, string> = { tech: 'Technique', editorial: 'Contenu', geo: 'Moteurs IA' }

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
const longDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const points = (value: number) => value.toLocaleString('fr-FR', { maximumFractionDigits: value < 10 ? 1 : 0 })
const percent = (weight: number) => `${Math.round(weight * 100)} %`

/** Une seule forme de carte sur toute la page */
const CARD = 'rounded-2xl border border-shade-33 bg-shade-1e p-5 md:p-6'
/** Lien de carte : soulignement au survol, contour visible au clavier */
const CARD_LINK =
  'inline-flex items-center gap-1 rounded text-[13px] font-semibold text-primary-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

/**
 * Synthèse d'un audit, en trois étages, lisible par le client comme par le consultant : l'état du site (note globale,
 * piliers, trois chiffres clés et le verdict), puis par où commencer (les critères qui rapportent le plus de points),
 * puis trois cartes de contexte (Google, pages, popularité et local). Chaque titre dit la conclusion ; la couleur ne
 * sert qu'aux états (toujours avec leur mot) et aux positions.
 */
export function SynthesisView({ projectId }: { projectId: string }) {
  const { audit, state } = useAudit()

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="Synthèse" />

  const dashboard = audit.dashboard
  const history = dashboard?.history ?? []
  const auditDate = history[history.length - 1]?.date

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Synthèse" />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Synthèse de l’audit</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {audit.domain}
            {auditDate ? ` · audit du ${longDate(auditDate)}` : ''} · {audit.crawlStats.crawledPages} pages explorées
            {!audit.isLocked && ` · ${audit.pillarPages.length} pages stratégiques analysées`}
            {history.length > 1 ? ` · ${history.length} audits suivis` : ''}
            {audit.crawlScope ? ` · ${describeCrawlScope(audit.crawlScope)}` : ''}
          </p>
        </div>
        <ExportPdfButton />
      </div>

      {audit.isLocked && <PhaseLockBanner projectId={projectId} />}

      <OverviewCard projectId={projectId} audit={audit} dashboard={dashboard} />

      {dashboard && <ActionsCard projectId={projectId} audit={audit} dashboard={dashboard} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {dashboard && <GoogleCard projectId={projectId} dashboard={dashboard} locked={audit.isLocked} />}
        {dashboard && <PagesCard projectId={projectId} dashboard={dashboard} />}
        <ReachCard projectId={projectId} audit={audit} />
      </div>

      <details className="group text-[13px] text-muted-foreground">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          Sources et limites
        </summary>
        <p className="mt-2 max-w-4xl leading-relaxed">
          Sources : exploration du site{auditDate ? ` le ${longDate(auditDate)}` : ''}, Google PageSpeed Insights, volumes Google
          Keyword Planner, analyse IA des pages stratégiques, positions mesurées à la demande dans Positionnement. Hors du
          score : les liens reçus d’autres sites, vos positions et la force de vos concurrents. Une note peut aussi bouger
          d’un audit à l’autre quand le barème évolue. Un bon score améliore votre site, il ne garantit pas une place en
          première page.
        </p>
      </details>

      <PageInspectionSheet />
    </div>
  )
}

/** Part de la demande de recherche mesurée qui est dans le top 10, ou ce qu'il reste à mesurer */
function demandSummary(demand: NonNullable<DashboardData['searchDemand']>) {
  const value = (bucket: { volume: number; queries: number }) => (demand.hasVolumes ? bucket.volume : bucket.queries)
  const measuredTotal = demand.buckets.filter((bucket) => bucket.key !== 'unmeasured').reduce((sum, bucket) => sum + value(bucket), 0)
  const top10 = demand.buckets.filter((bucket) => bucket.key === 'top3' || bucket.key === 'top10').reduce((sum, bucket) => sum + value(bucket), 0)
  const unmeasuredBucket = demand.buckets.find((bucket) => bucket.key === 'unmeasured')
  const unmeasured = unmeasuredBucket ? value(unmeasuredBucket) : 0
  const unmeasuredQueries = unmeasuredBucket?.queries ?? 0
  // Moins de la moitié de la demande mesurée : le pourcentage du top 10 ne dirait rien
  const share = measuredTotal === 0 || unmeasured > measuredTotal ? null : Math.round((top10 / measuredTotal) * 100)
  return { share, unmeasuredQueries, value }
}

/**
 * En-tête : la note globale en anneau (seul chiffre vedette), son état, son écart et son évolution ; le verdict de
 * l'analyse et son détail repliable ; les piliers en jauges ; trois chiffres clés qui renvoient à leur écran.
 */
function OverviewCard({ projectId, audit, dashboard }: { projectId: string; audit: ProjectAuditData; dashboard?: DashboardData }) {
  const history = dashboard?.history ?? []
  const previous = history.length > 1 ? history[history.length - 2] : undefined
  const global = audit.scores.global
  const pillars: { key: Pillar; href: string; weight: number }[] = [
    { key: 'tech', href: `/projets/${projectId}/subpages`, weight: PILLAR_WEIGHTS.tech },
    { key: 'editorial', href: `/projets/${projectId}/seo-editorial`, weight: PILLAR_WEIGHTS.editorial },
    // GEO mis de côté (GEO_ENABLED) : sa note n'est plus montrée ni comptée
    ...(GEO_ENABLED ? [{ key: 'geo' as const, href: `/projets/${projectId}/geo`, weight: PILLAR_WEIGHTS.geo }] : []),
  ]
  const deltaOf = (key: 'global' | Pillar, value: number) =>
    previous && previous[key] !== null ? (
      <Delta value={value - (previous[key] as number)} suffix=" pts" label={`depuis le ${shortDate(previous.date)}`} />
    ) : null

  return (
    <section aria-labelledby="overview-title" className={`${CARD} grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,280px)] lg:items-center lg:gap-8`}>
      <h2 id="overview-title" className="sr-only">
        État du site
      </h2>

      {/* Note globale */}
      <div className="flex flex-col items-center gap-3 text-center">
        {global !== null ? (
          <>
            <RingMeter value={global} band={bandOf(global)} label="Note globale" />
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: BAND_STYLE[bandOf(global)].color }} aria-hidden="true" />
              {BAND_STYLE[bandOf(global)].label}
            </span>
            {deltaOf('global', global)}
            {history.length > 1 && (
              <Sparkline
                points={history.map((point) => ({ label: shortDate(point.date), value: point.global }))}
                label="Évolution de la note globale"
                format={(value) => `${value}/100`}
                width={140}
              />
            )}
          </>
        ) : (
          <span className="flex size-[152px] flex-col items-center justify-center gap-2 rounded-full border-2 border-dashed border-shade-44 px-6 text-[13px] text-muted-foreground">
            <Lock className="size-5" aria-hidden="true" />
            Note globale après l’analyse des pages stratégiques
          </span>
        )}
      </div>

      {/* Verdict et piliers */}
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">À retenir</p>
          {audit.advice ? (
            <>
              <p className="mt-1 text-xl font-semibold leading-snug text-foreground">{audit.advice.headline}</p>
              <details className="group mt-2">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[13px] font-semibold text-sky-soft focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  Conseil de l’analyse
                  <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <dl className="mt-3 flex flex-col gap-3 border-l-2 border-shade-44 pl-4">
                  {audit.advice.points.map((point) => (
                    <div key={point.label}>
                      <dt className="text-[13px] font-semibold text-foreground">{point.label}</dt>
                      <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{point.text}</dd>
                    </div>
                  ))}
                  {audit.advice.note && <p className="text-[13px] text-muted-foreground">{audit.advice.note}</p>}
                </dl>
              </details>
            </>
          ) : (
            <p className="mt-1 text-xl font-semibold leading-snug text-foreground">
              {global === null ? 'Choisissez vos pages stratégiques pour obtenir la note globale.' : 'Moyenne pondérée des piliers ci-dessous.'}
            </p>
          )}
        </div>

        <ul className="flex flex-col gap-4" aria-label="Notes par pilier">
          {pillars.map(({ key, href, weight }) => {
            const value = audit.scores[key]
            return (
              <li key={key}>
                <Link
                  href={href}
                  className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold text-foreground group-hover:underline">
                      {PILLAR_LABEL[key]}
                      <span className="ml-2 text-[13px] font-normal text-muted-foreground">{percent(weight)} de la note</span>
                    </span>
                    {value !== null ? (
                      <span className="flex items-baseline gap-2">
                        <span className="text-[13px] text-muted-foreground">{BAND_STYLE[bandOf(value)].label}</span>
                        <span className="text-2xl font-extrabold leading-none text-foreground">{value}</span>
                        <span className="text-[13px] text-muted-foreground">/100</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
                        <Lock className="size-3.5" aria-hidden="true" /> Verrouillé
                      </span>
                    )}
                  </span>
                  <span className="mt-2 block">
                    {value !== null ? (
                      <BarMeter value={value} band={bandOf(value)} label={PILLAR_LABEL[key]} />
                    ) : (
                      <span className="block h-2 rounded-full bg-[var(--viz-track)]" />
                    )}
                  </span>
                  {value !== null && deltaOf(key, value) && <span className="mt-1.5 block">{deltaOf(key, value)}</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Chiffres clés */}
      <KeyFigures projectId={projectId} audit={audit} dashboard={dashboard} />
    </section>
  )
}

/** Trois chiffres clés, chacun avec ce qu'il mesure et l'écran qui le détaille */
function KeyFigures({ projectId, audit, dashboard }: { projectId: string; audit: ProjectAuditData; dashboard?: DashboardData }) {
  const figures: { label: string; value: ReactNode; hint: string; href: string }[] = []
  const demand = dashboard?.searchDemand
  if (demand) {
    const { share, unmeasuredQueries } = demandSummary(demand)
    figures.push(
      share !== null
        ? {
            label: 'Demande dans le top 10',
            value: `${share} %`,
            hint: demand.hasVolumes ? `des recherches mesurées (${compact(demand.totalVolume)}/mois au total)` : 'des recherches mesurées',
            href: `/projets/${projectId}/positionnement`,
          }
        : {
            label: 'Recherches à mesurer',
            value: `${unmeasuredQueries}/${demand.totalQueries}`,
            hint: 'pas encore mesurées dans Google',
            href: `/projets/${projectId}/positionnement`,
          },
    )
  }
  const tech = dashboard?.pageHealth.find((item) => item.pillar === 'tech')
  if (tech) {
    const total = tech.counts.weak + tech.counts.medium + tech.counts.strong
    figures.push({
      label: 'Pages à corriger',
      value: `${tech.counts.weak}/${total}`,
      hint: 'note technique sous 60',
      href: `/projets/${projectId}/subpages`,
    })
  }
  const backlinks = audit.backlinks?.status === 'DONE' ? backlinkSummary(audit.backlinks) : undefined
  figures.push({
    label: 'Domaines référents',
    value: backlinks ? String(backlinks.domains) : '—',
    hint: backlinks ? 'sites qui font un lien vers le vôtre (hors score)' : 'pas encore relevés',
    href: `/projets/${projectId}/backlinks`,
  })

  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1" aria-label="Chiffres clés">
      {figures.map((figure) => (
        <li key={figure.label}>
          <Link
            href={figure.href}
            className="group flex h-full flex-col rounded-xl border border-shade-33 px-3.5 py-3 transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
              {figure.label}
              <ArrowUpRight className="size-3.5 opacity-60 group-hover:opacity-100" aria-hidden="true" />
            </span>
            <span className="mt-1 text-2xl font-extrabold leading-none tracking-tight text-foreground">{figure.value}</span>
            <span className="mt-1 text-[13px] leading-snug text-muted-foreground">{figure.hint}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * Par où commencer : les critères qui rapporteraient le plus de points sur la note globale s'ils étaient parfaits
 * partout, dans l'ordre ; les anomalies tiennent en une ligne de compteurs vers leur écran
 */
function ActionsCard({ projectId, audit, dashboard }: { projectId: string; audit: ProjectAuditData; dashboard: DashboardData }) {
  const gains = dashboard.gains.slice(0, 5)
  const total = dashboard.gains.reduce((sum, gain) => sum + gain.globalPoints, 0)
  const max = Math.max(...gains.map((gain) => gain.globalPoints), 0)
  const hrefOf = (pillar: Pillar) =>
    pillar === 'tech' ? `/projets/${projectId}/subpages` : pillar === 'editorial' ? `/projets/${projectId}/seo-editorial` : `/projets/${projectId}/geo`
  const partial = dashboard.techDetail.known < dashboard.techDetail.counted
  const counts = [
    { filter: 'critical', count: audit.kpis.criticalIssuesCount, label: 'critique', color: 'var(--viz-bad)' },
    { filter: 'warning', count: audit.kpis.warningsCount, label: 'avertissement', color: 'var(--viz-warn)' },
    { filter: 'passed', count: audit.kpis.goodPracticesCount, label: 'mineure', color: 'var(--viz-accent)' },
  ]

  return (
    <section aria-labelledby="actions-title" className={CARD}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="actions-title" className="text-lg font-bold text-foreground">
            Par où commencer
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {gains.length > 0
              ? `Environ ${Math.round(total)} points à reprendre sur la note globale, d’abord ${lowerFirst(gains[0].label)}. Gain estimé si le critère était parfait sur toutes les pages concernées.`
              : 'Aucun point notable à reprendre.'}
          </p>
        </div>
      </div>

      {gains.length > 0 && (
        <ol className="mt-4 flex flex-col" aria-label="Critères qui rapportent le plus de points">
          {gains.map((gain, index) => (
            <li key={`${gain.pillar}-${gain.key}`} className="border-t border-shade-33 first:border-t-0">
              <Link
                href={hrefOf(gain.pillar)}
                className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-lg px-1 py-3 hover:bg-shade-24 focus-visible:outline-2 focus-visible:outline-primary sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,38%)_auto]"
              >
                <span
                  className={`flex size-8 items-center justify-center rounded-full text-sm font-bold ${
                    index === 0 ? 'bg-primary text-primary-foreground' : 'border border-shade-44 text-foreground'
                  }`}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground group-hover:underline">{gain.label}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {PILLAR_LABEL[gain.pillar]} · {gain.pages} page{gain.pages > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="col-span-3 col-start-1 row-start-2 block h-2 sm:col-span-1 sm:col-start-3 sm:row-start-1" aria-hidden="true">
                  <span
                    className="block h-2 rounded-full"
                    style={{
                      width: `${Math.max(3, (gain.globalPoints / (max || 1)) * 100)}%`,
                      backgroundColor: index === 0 ? 'var(--viz-accent)' : 'var(--viz-context)',
                    }}
                  />
                </span>
                <span className="text-right text-base font-bold text-foreground sm:col-start-4">+{points(gain.globalPoints)} pts</span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {partial && (
        <p className="mt-3 text-[13px] text-sky-soft">
          Détail technique connu pour {dashboard.techDetail.known} pages sur {dashboard.techDetail.counted} (audit lancé avant
          l’enregistrement de ce détail) : relancez un audit pour l’avoir sur toutes les pages.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-shade-33 pt-4 text-sm">
        <span className="text-muted-foreground">Anomalies :</span>
        <ul className="flex flex-wrap gap-2" aria-label="Anomalies par gravité">
          {counts.map((item) => (
            <li key={item.filter}>
              <Link
                href={`/projets/${projectId}/global-issues?filter=${item.filter}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-shade-44 px-3 py-1 text-[13px] text-foreground hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
                <strong>{item.count}</strong> {item.label}
                {item.count > 1 ? 's' : ''}
              </Link>
            </li>
          ))}
        </ul>
        <Link href={`/projets/${projectId}/global-issues`} className={`${CARD_LINK} ml-auto`}>
          Toutes les anomalies
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}

const BUCKETS = {
  top3: { label: 'Top 3', color: 'var(--viz-pos-1)', ink: 'var(--viz-pos-1-ink)' },
  top10: { label: 'Positions 4 à 10', color: 'var(--viz-pos-2)', ink: 'var(--viz-pos-2-ink)' },
  top30: { label: 'Positions 11 à 30', color: 'var(--viz-pos-3)', ink: 'var(--viz-pos-3-ink)' },
  absent: { label: 'Absente', color: 'var(--viz-absent)', ink: 'var(--viz-absent-ink)' },
  unmeasured: { label: 'Non mesurée', color: 'var(--viz-unmeasured)', ink: 'var(--viz-unmeasured-ink)' },
} as const

/** Carte de contexte : titre-conclusion, une icône, le contenu, et le lien vers l'écran qui détaille */
function ContextCard({
  icon,
  kicker,
  title,
  link,
  children,
}: {
  icon: ReactNode
  kicker: string
  title: string
  link: { href: string; label: string }
  children: ReactNode
}) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col`}>
      <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {kicker}
      </p>
      <h2 className="mt-2 text-base font-bold leading-snug text-foreground">{title}</h2>
      <div className="mt-4 flex-1">{children}</div>
      <Link href={link.href} className={`${CARD_LINK} mt-4 self-start`}>
        {link.label}
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </Link>
    </section>
  )
}

/** Google : la demande de recherche répartie par position mesurée, et les recherches les plus demandées hors du top 10 */
function GoogleCard({ projectId, dashboard, locked }: { projectId: string; dashboard: DashboardData; locked: boolean }) {
  const demand = dashboard.searchDemand
  const link = { href: `/projets/${projectId}/positionnement`, label: 'Positionnement' }
  const icon = <Search className="size-4" aria-hidden="true" />
  if (!demand) {
    return (
      <ContextCard icon={icon} kicker="Google" title="Demande de recherche" link={link}>
        <p className="text-sm text-muted-foreground">
          {locked
            ? 'Disponible après l’analyse des pages stratégiques.'
            : 'Aucune recherche notée pour les pages stratégiques : relancez leur analyse.'}
        </p>
      </ContextCard>
    )
  }
  const { share, unmeasuredQueries, value } = demandSummary(demand)
  const title =
    share === null
      ? `${unmeasuredQueries} recherche${unmeasuredQueries > 1 ? 's' : ''} sur ${demand.totalQueries} à mesurer dans Google`
      : `${share} % de la demande mesurée est dans le top 10`
  return (
    <ContextCard icon={icon} kicker="Google" title={title} link={link}>
      <StackedBar
        ariaLabel={demand.hasVolumes ? 'Recherches mensuelles par position Google' : 'Recherches notées par position Google'}
        height={10}
        showShare={false}
        segments={demand.buckets.map((bucket) => ({
          key: bucket.key,
          label: BUCKETS[bucket.key].label,
          value: value(bucket),
          display: demand.hasVolumes ? `${compact(bucket.volume)}/mois` : `${bucket.queries}`,
          color: BUCKETS[bucket.key].color,
          ink: BUCKETS[bucket.key].ink,
        }))}
      />
      {demand.opportunities.length > 0 && (
        <>
          <h3 className="mt-5 text-[13px] font-semibold text-foreground">Les plus demandées hors du top 10</h3>
          <ul className="mt-2 flex flex-col divide-y divide-shade-33">
            {demand.opportunities.slice(0, 3).map((item) => (
              <li key={item.query} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-foreground" title={`${item.query} (${item.path})`}>
                  {item.query}
                </span>
                <span className="shrink-0 text-[13px] text-muted-foreground">
                  {item.volume !== undefined ? `${compact(item.volume)}/mois · ` : ''}
                  {item.position === undefined ? 'non mesurée' : item.position === null ? 'absente' : `n°${item.position}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ContextCard>
  )
}

/** Pages : nombre de pages par tranche de note, pour chaque pilier (barres fines, la légende porte les nombres) */
function PagesCard({ projectId, dashboard }: { projectId: string; dashboard: DashboardData }) {
  const tech = dashboard.pageHealth.find((item) => item.pillar === 'tech')
  const techTotal = tech ? tech.counts.weak + tech.counts.medium + tech.counts.strong : 0
  const title = tech
    ? tech.counts.weak > 0
      ? `${tech.counts.weak} page${tech.counts.weak > 1 ? 's' : ''} sur ${techTotal} à corriger en technique`
      : 'Aucune page sous 60 en technique'
    : 'État des pages'
  return (
    <ContextCard
      icon={<FileText className="size-4" aria-hidden="true" />}
      kicker="Pages"
      title={title}
      link={{ href: `/projets/${projectId}/subpages`, label: 'Sous-pages' }}
    >
      <div className="flex flex-col gap-4">
        {dashboard.pageHealth.map((item) => {
          const total = item.counts.weak + item.counts.medium + item.counts.strong
          return (
            <div key={item.pillar}>
              <p className="mb-1.5 text-sm text-foreground">
                {PILLAR_LABEL[item.pillar]}
                <span className="ml-1.5 text-[13px] text-muted-foreground">
                  {total} page{total > 1 ? 's' : ''}
                  {item.pillar === 'tech' ? '' : ' stratégiques'}
                </span>
              </p>
              <StackedBar
                ariaLabel={`Pages par tranche de note, ${PILLAR_LABEL[item.pillar]}`}
                height={10}
                showShare={false}
                segments={(['weak', 'medium', 'strong'] as const).map((band) => ({
                  key: band,
                  label: BAND_STYLE[band].label,
                  value: item.counts[band],
                  display: `${item.counts[band]}`,
                  color: BAND_STYLE[band].color,
                  ink: BAND_STYLE[band].ink,
                }))}
              />
            </div>
          )
        })}
        <p className="text-[13px] text-muted-foreground">À corriger sous 60, à consolider de 60 à 79, solide à partir de 80.</p>
      </div>
    </ContextCard>
  )
}

/** Popularité et local (hors score) : domaines référents et liens vérifiés, puis la visibilité de chaque zone */
function ReachCard({ projectId, audit }: { projectId: string; audit: ProjectAuditData }) {
  const report = audit.backlinks
  const summary = report?.status === 'DONE' ? backlinkSummary(report) : undefined
  const local: LocalVisibility | undefined = audit.localVisibility
  const zones = local?.zones ?? []
  const title = summary
    ? `${summary.domains} site${summary.domains > 1 ? 's' : ''} font un lien vers le vôtre`
    : 'Popularité pas encore relevée'
  return (
    <ContextCard
      icon={<Link2 className="size-4" aria-hidden="true" />}
      kicker="Popularité et local · hors score"
      title={title}
      link={zones.length > 0 ? { href: `/projets/${projectId}/positionnement`, label: 'Zones et backlinks' } : { href: `/projets/${projectId}/backlinks`, label: 'Backlinks' }}
    >
      {summary && report ? (
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[13px] text-muted-foreground">Liens vérifiés</dt>
            <dd className="text-2xl font-extrabold leading-tight text-foreground">
              {summary.found}
              <span className="ml-1 text-[13px] font-normal text-muted-foreground">sur {summary.verified} lus</span>
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Pages liées</dt>
            <dd className="text-2xl font-extrabold leading-tight text-foreground">{summary.targets > 0 ? summary.targets : '—'}</dd>
          </div>
          <p className="col-span-2 text-[13px] text-muted-foreground">
            Common Crawl de {releaseLabel(report.release)} : relevé partiel, les vrais totaux sont plus élevés.
          </p>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          {report ? (report.message ?? 'Backlinks indisponibles pour cet audit.') : 'Audit lancé avant l’ajout des backlinks : relancez un audit pour les obtenir.'}
        </p>
      )}
      {zones.length > 0 && (
        <ul className="mt-4 flex flex-col divide-y divide-shade-33 border-t border-shade-33">
          {zones.slice(0, 3).map(({ zone, measures }) => (
            <li key={zone.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-foreground">
                <MapPinned className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {zone.label}
              </span>
              <span className="shrink-0 text-[13px] text-muted-foreground">
                {measures.measured === 0
                  ? 'pas encore mesurée'
                  : measures.best
                    ? `au mieux n°${measures.best.rank}`
                    : `absente (${measures.measured} recherche${measures.measured > 1 ? 's' : ''})`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ContextCard>
  )
}
