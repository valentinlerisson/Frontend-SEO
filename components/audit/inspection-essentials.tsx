'use client'

import { ArrowRight, Clock, Search } from 'lucide-react'
import type { InspectionData, SubpageItem } from '@/lib/audit-data'
import type { InspectionTab } from '@/components/providers/inspection-provider'
import { describePagePosition } from '@/lib/serp-labels'
import { scoreTone } from '@/lib/score-tone'

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
  if (weakest.score >= 80) return 'Page solide sur les trois plans : il reste surtout à suivre sa position dans Google.'
  if (weakest.pillar === 'tech') return 'Des problèmes techniques freinent cette page : ce sont eux à corriger en premier.'
  if (weakest.pillar === 'editorial') {
    return `Le contenu répond encore mal à la recherche visée${query ? ` « ${query} »` : ''} : c’est lui qu’il faut retravailler en priorité.`
  }
  return 'Le contenu tient la route, mais les moteurs IA ont du mal à en reprendre des passages : c’est le chantier prioritaire.'
}

/**
 * Onglet « L'essentiel » du tiroir d'inspection : verdict, trois notes, position Google, et les trois actions qui
 * rapportent le plus (points en jeu, effort). Le détail reste dans les autres onglets.
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
  const scores: { pillar: Pillar; score: number }[] = [
    { pillar: 'tech', score: inspection.tech.score },
    ...(aiAvailable
      ? [
          { pillar: 'editorial' as const, score: inspection.editorial.score },
          { pillar: 'geo' as const, score: inspection.geo.score },
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

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="rounded-xl border border-line-indigo bg-tint-indigo p-4 text-base font-semibold text-foreground">
        {verdict(scores, aiAvailable ? inspection.editorial.targetKeyword : undefined)}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {scores.map(({ pillar, score }) => {
          const tone = scoreTone(score)
          return (
            <button
              key={pillar}
              type="button"
              onClick={() => onOpen(pillar)}
              className="rounded-xl border border-shade-33 bg-shade-1e p-4 text-left transition-colors hover:border-primary/50"
            >
              <span className="block text-xs text-muted-foreground">{PILLAR_LABEL[pillar]}</span>
              <span className="block text-2xl font-extrabold tabular-nums" style={{ color: tone.textColor }}>
                {score}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </span>
              <span className="block text-xs font-semibold" style={{ color: tone.textColor }}>
                {tone.label}
              </span>
            </button>
          )
        })}
      </div>

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
