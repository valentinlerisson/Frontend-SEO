'use client'

import { ArrowRight, Clock, Search } from 'lucide-react'
import type { InspectionData, SubpageItem } from '@/lib/audit-data'
import type { InspectionTab } from '@/components/providers/inspection-provider'
import { describePagePosition } from '@/lib/serp-labels'
import { bandOf, bucketOf } from '@/lib/score-bands'
import { compact, Delta, lowerFirst, RankedBars, Sparkline, StatTile, ThresholdMeter } from '@/components/charts/viz'
import { GEO_ENABLED } from '@/core/domain/features'

type Pillar = 'tech' | 'editorial' | 'geo'
const PILLAR_LABEL: Record<Pillar, string> = { tech: 'Technique', editorial: 'Contenu', geo: 'Moteurs IA' }

/**
 * Effort indicatif d'une action, d'après le pilier et ce qu'elle touche : une balise se corrige en quelques minutes,
 * un contenu se réécrit, la vitesse ou la configuration demandent un développeur. C'est un ordre de grandeur.
 */
function effortOf(pillar: Pillar, text: string): string {
  if (/\b(title|méta|meta description|h1|texte alternatif|alt)\b/i.test(text)) return 'Quelques minutes'
  if (pillar === 'tech' || /(balisage|schema|json-ld|llms|robots|redirection|vitesse|affichage|serveur)/i.test(text)) {
    return 'Avec un développeur'
  }
  return 'Réécriture du contenu'
}

/** Verdict en une phrase : le pilier le plus faible dit par où commencer */
function verdict(scores: { pillar: Pillar; score: number }[], query?: string): string {
  if (scores.length === 1) return 'Page non stratégique : seule la technique est analysée. Ajoutez-la aux pages stratégiques pour juger son contenu.'
  const weakest = [...scores].sort((a, b) => a.score - b.score)[0]
  if (weakest.score >= 80) return `Page solide sur les ${scores.length === 3 ? 'trois' : 'deux'} plans : il reste surtout à suivre sa position dans Google.`
  if (weakest.pillar === 'tech') return 'Des problèmes techniques freinent cette page : ce sont eux à corriger en premier.'
  if (weakest.pillar === 'editorial') {
    return `Le contenu répond encore mal aux recherches visées${query ? `, à commencer par « ${query} »` : ''} : c’est lui qu’il faut retravailler en priorité.`
  }
  return 'Le contenu tient la route, mais les moteurs IA ont du mal à en reprendre des passages : c’est le chantier prioritaire.'
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

/** Position mesurée d'une requête, avec la teinte de sa tranche (top 3, top 10, au-delà) */
function PositionChip({ position }: { position?: number | null }) {
  const bucket = bucketOf(position)
  const color =
    bucket === 'top3' ? 'var(--viz-pos-1)' : bucket === 'top10' ? 'var(--viz-pos-2)' : bucket === 'top30' ? 'var(--viz-pos-3)' : bucket === 'absent' ? 'var(--viz-absent)' : 'var(--viz-unmeasured)'
  const text = position === undefined ? 'Non mesurée' : position === null ? 'Absente' : `n°${position}`
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {text}
    </span>
  )
}

/** Requête présente dans le Title, l'introduction et un sous-titre H2/H3 */
function PlacementChips({ missing }: { missing: string[] }) {
  const zones = [
    { key: 'Title', label: 'Title' },
    { key: 'début du texte', label: 'Intro' },
    { key: 'sous-titres', label: 'H2' },
  ]
  return (
    <span className="inline-flex gap-1" aria-label={`Placée dans : ${zones.filter((zone) => !missing.includes(zone.key)).map((zone) => zone.label).join(', ') || 'aucune zone'}`}>
      {zones.map((zone) => {
        const present = !missing.includes(zone.key)
        return (
          <span
            key={zone.key}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${present ? 'bg-chip-indigo text-foreground' : 'text-muted-foreground line-through opacity-70'}`}
          >
            {zone.label}
          </span>
        )
      })}
    </span>
  )
}

/**
 * Onglet « L'essentiel » du tiroir d'inspection : verdict, trois notes avec leur évolution, où la page perd ses
 * points, recherches visées et place dans Google, vitesse, et les trois actions qui rapportent le plus. Le détail
 * reste dans les autres onglets ; chaque élément y renvoie.
 */
export function InspectionEssentials({
  inspection,
  subpage,
  aiAvailable,
  onOpen,
}: {
  inspection: InspectionData
  subpage?: SubpageItem
  aiAvailable: boolean
  onOpen: (tab: InspectionTab, section?: number) => void
}) {
  const essentials = inspection.essentials
  // Page non notée (contact, légale, utilitaire) : pas de note éditoriale à afficher
  const editorialScore = inspection.editorial.score
  const scores: { pillar: Pillar; score: number }[] = [
    { pillar: 'tech', score: inspection.tech.score },
    ...(aiAvailable
      ? [
          ...(editorialScore !== null ? [{ pillar: 'editorial' as const, score: editorialScore }] : []),
          // GEO mis de côté (GEO_ENABLED) : ni note ni actions
          ...(GEO_ENABLED ? [{ pillar: 'geo' as const, score: inspection.geo.score }] : []),
        ]
      : []),
  ]
  // Actions : celles qui retirent des points d'abord (les plus lourdes en tête), puis les recommandations
  const actions = scores
    .flatMap(({ pillar }) => inspection[pillar].priorities.map((priority) => ({ ...priority, pillar })))
    .sort(
      (a, b) =>
        Number(b.type === 'alert') - Number(a.type === 'alert') ||
        Number(Boolean(b.affectsScore)) - Number(Boolean(a.affectsScore)) ||
        (b.maxPoints ?? 0) - (a.maxPoints ?? 0),
    )
    .slice(0, 3)
  const serp = subpage?.serp?.status === 'DONE' ? subpage.serp : undefined
  const querySet = aiAvailable ? inspection.editorial.querySet ?? [] : []
  const mainQuery = querySet[0]?.query ?? (aiAvailable ? inspection.editorial.targetKeyword : undefined)

  // Où la page perd ses points : 5 critères au plus, seulement les piliers analysés
  const pillars = new Set(scores.map((item) => item.pillar))
  const losses = (essentials?.losses ?? []).filter((loss) => pillars.has(loss.pillar)).slice(0, 5)
  const topLoss = losses[0]

  // Recherches visées : part du volume déjà dans le top 10, et évolution de la position sur la requête principale
  const totalVolume = querySet.reduce((sum, entry) => sum + (entry.volume ?? 0), 0)
  const measured = querySet.filter((entry) => entry.position !== undefined)
  const inTop10 = measured.filter((entry) => typeof entry.position === 'number' && entry.position <= 10)
  const top10Volume = inTop10.reduce((sum, entry) => sum + (entry.volume ?? 0), 0)
  const maxVolume = Math.max(...querySet.map((entry) => entry.volume ?? 0), 0)
  const queriesInsight =
    measured.length === 0
      ? 'Positions de ces recherches pas encore mesurées : lancez la mesure dans Positionnement.'
      : totalVolume > 0
        ? `${Math.round((top10Volume / totalVolume) * 100)} % du volume visé est déjà dans le top 10 de Google`
        : `${inTop10.length} recherche${inTop10.length > 1 ? 's' : ''} sur ${querySet.length} dans le top 10 de Google`
  const history = (subpage?.serpHistory ?? [])
    .filter((entry) => mainQuery && entry.query.toLowerCase().startsWith(mainQuery.toLowerCase()))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8)
    .map((entry) => ({ label: shortDate(entry.date), value: entry.pagePosition ?? entry.sitelinkOf }))

  const cwv = essentials?.cwv
  const previous = essentials?.previous
  const previousOf = (pillar: Pillar) => (previous ? previous[pillar] : null)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="rounded-xl border border-line-indigo bg-tint-indigo p-4 text-base font-semibold text-foreground">
        {verdict(scores, mainQuery)}
      </p>

      {/* Notes côte à côte, sur toute la largeur de la fiche (sa largeur varie : pas de colonnes fixes) */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {scores.map(({ pillar, score }) => {
          const before = previousOf(pillar)
          return (
            <StatTile
              key={pillar}
              label={PILLAR_LABEL[pillar]}
              value={score}
              unit="/100"
              band={bandOf(score)}
              onClick={() => onOpen(pillar)}
              delta={
                previous && typeof before === 'number' ? (
                  <Delta value={score - before} suffix=" pts" label={`depuis le ${shortDate(previous.date)}`} />
                ) : undefined
              }
            />
          )
        })}
      </div>

      <section aria-labelledby="essentials-losses" className="rounded-xl border border-shade-33 bg-shade-1e p-4">
        <h3 id="essentials-losses" className="text-base font-bold text-foreground">
          {topLoss
            ? `${PILLAR_LABEL[topLoss.pillar]} : ${lowerFirst(topLoss.label)} coûte le plus de points`
            : 'Aucun point perdu notable sur cette page'}
        </h3>
        {losses.length > 0 && (
          <>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Points perdus sur la note de chaque pilier, critère par critère. Cliquez pour voir le détail.
            </p>
            <div className="mt-3">
              <RankedBars
                ariaLabel="Où cette page perd ses points"
                items={losses.map((loss) => ({
                  id: `${loss.pillar}-${loss.key}`,
                  label: loss.label,
                  sub: PILLAR_LABEL[loss.pillar],
                  value: loss.lost,
                  display: `−${Math.round(loss.lost)} pts`,
                  onSelect: () => onOpen(loss.pillar, loss.section),
                }))}
              />
            </div>
          </>
        )}
      </section>

      {querySet.length > 0 ? (
        <section aria-labelledby="essentials-queries" className="rounded-xl border border-shade-33 bg-shade-1e p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="essentials-queries" className="text-base font-bold text-foreground">{queriesInsight}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Recherches sur lesquelles la page est notée{totalVolume > 0 ? `, ${compact(totalVolume)} recherches par mois au total` : ''}.
              </p>
            </div>
            {history.filter((point) => point.value !== null).length >= 2 && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                Position sur « {mainQuery} »
                <Sparkline points={history} label={`Position sur « ${mainQuery} »`} format={(value) => `n°${value}`} invert />
              </span>
            )}
          </div>
          <ul className="mt-3 flex flex-col gap-2.5">
            {querySet.map((entry) => (
              <li key={entry.query}>
                <button
                  type="button"
                  onClick={() => onOpen('serp')}
                  className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-shade-25 focus-visible:bg-shade-25"
                >
                  <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 text-sm text-foreground">{entry.query}</span>
                    <span className="flex items-center gap-3">
                      <PlacementChips missing={entry.coverage.missing} />
                      <PositionChip position={entry.position} />
                    </span>
                  </span>
                  {maxVolume > 0 && (
                    <span className="mt-1 flex items-center gap-2">
                      <span className="block h-2.5 flex-1" aria-hidden="true">
                        <span
                          className="block h-2.5 rounded-r-[4px]"
                          style={{ width: `${Math.max(2, ((entry.volume ?? 0) / maxVolume) * 100)}%`, backgroundColor: 'var(--viz-accent)' }}
                        />
                      </span>
                      <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                        {entry.volume !== undefined ? `${compact(entry.volume)} / mois` : 'volume inconnu'}
                      </span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => onOpen('serp')}
          className="flex items-center gap-2 rounded-xl border border-shade-33 bg-shade-1e p-3 text-left text-sm hover:border-primary/50"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {serp ? (
            <span>
              Google : <strong>{describePagePosition(serp).badge}</strong> sur « {serp.query} »
              {serp.zone ? ` depuis ${serp.zone.city}` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">Position dans Google non mesurée : lancez la mesure dans Positionnement.</span>
          )}
          <ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      )}

      {cwv && (
        <section aria-labelledby="essentials-speed" className="rounded-xl border border-shade-33 bg-shade-1e p-4">
          <h3 id="essentials-speed" className="text-base font-bold text-foreground">
            Vitesse d’affichage mesurée par Google
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Seuils de Google : vert bon, jaune à améliorer, rouge mauvais.</p>
          <div className="mt-3 flex flex-col gap-3">
            {typeof cwv.lcp === 'number' && (
              <ThresholdMeter label="Affichage du contenu principal (LCP)" value={cwv.lcp} display={`${cwv.lcp.toLocaleString('fr-FR')} s`} good={2.5} poor={4} max={6} />
            )}
            {typeof cwv.inp === 'number' && (
              <ThresholdMeter label="Réactivité aux clics (INP)" value={cwv.inp} display={`${Math.round(cwv.inp)} ms`} good={200} poor={500} max={800} />
            )}
            {typeof cwv.cls === 'number' && (
              <ThresholdMeter label="Stabilité de la mise en page (CLS)" value={cwv.cls} display={cwv.cls.toLocaleString('fr-FR')} good={0.1} poor={0.25} max={0.4} />
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="essentials-actions">
        <h3 id="essentials-actions" className="text-base font-bold text-foreground">
          Les 3 actions qui comptent le plus
        </h3>
        {actions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Rien d’important à corriger sur cette page.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-2">
            {actions.map((action, index) => (
              <li key={`${action.pillar}-${index}`}>
                <button
                  type="button"
                  onClick={() => onOpen(action.pillar, action.section)}
                  className={`flex w-full items-start gap-3 rounded-xl border border-shade-33 border-l-4 bg-shade-1e p-3 text-left hover:bg-shade-25 ${
                    action.type === 'alert' ? 'border-l-[#ef4444]' : 'border-l-primary'
                  }`}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">{action.text}</span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{PILLAR_LABEL[action.pillar]}</span>
                      {action.affectsScore && action.maxPoints ? (
                        <span className="font-semibold text-primary-ink">
                          {action.maxPoints >= 100 ? 'bloque la note' : `jusqu’à ${action.maxPoints} pts`}
                        </span>
                      ) : (
                        <span>sans effet sur la note</span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" aria-hidden="true" />
                        {effortOf(action.pillar, action.text)}
                      </span>
                    </span>
                  </span>
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
