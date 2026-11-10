'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'

/**
 * Graphiques de l'application, dessinés à la main (SVG et CSS) : tuile de chiffre clé, mini-courbe, barres classées,
 * barre empilée et jauge à seuils. Règles du skill dataviz : marques fines, extrémité arrondie de 4 px, écart de 2 px
 * entre segments, texte dans les couleurs du texte (jamais celle de la donnée), étiquettes sélectives, infobulle au
 * survol et au clavier, et toujours une lecture sans couleur (libellé, légende avec valeurs). Couleurs : `--viz-*`
 * dans app/globals.css.
 */

const compactFormat = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })

/** Première lettre en minuscule, pour glisser un libellé dans une phrase sans toucher aux sigles (« IA », « H1 ») */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** 1 234 → « 1,2 k » ; 14 800 → « 14,8 k » */
export function compact(value: number): string {
  return value >= 10_000 ? compactFormat.format(value) : value.toLocaleString('fr-FR')
}

/** Écart avec un audit passé : flèche, signe et libellé, vert ou rouge selon que la hausse est bonne */
export function Delta({ value, suffix = '', label, upIsGood = true }: { value: number; suffix?: string; label?: string; upIsGood?: boolean }) {
  const rounded = Math.round(value)
  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden="true" /> stable{label ? ` ${label}` : ''}
      </span>
    )
  }
  const good = rounded > 0 === upIsGood
  const Icon = rounded > 0 ? ArrowUp : ArrowDown
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${good ? 'text-green-soft' : 'text-red-soft'}`}>
        <Icon className="size-3" aria-hidden="true" />
        {rounded > 0 ? '+' : '−'}
        {Math.abs(rounded)}
        {suffix}
      </span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </span>
  )
}

/** Infobulle commune : la valeur d'abord, le libellé ensuite */
function Tip({ value, label, style }: { value: string; label: string; style?: React.CSSProperties }) {
  return (
    <span
      role="tooltip"
      style={style}
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-shade-44 bg-popover px-2 py-1 text-xs shadow-lg"
    >
      <strong className="block text-foreground">{value}</strong>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

/**
 * Mini-courbe : la ligne en gris de contexte, le dernier point dans la couleur d'accent. `invert` : une valeur plus
 * basse est mieux placée (position Google). Moins de deux points : rien.
 */
export function Sparkline({
  points,
  label,
  format = (value) => String(value),
  invert = false,
  width = 120,
  height = 34,
}: {
  points: { label: string; value: number | null }[]
  label: string
  format?: (value: number) => string
  invert?: boolean
  width?: number
  height?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const valid = points.filter((point): point is { label: string; value: number } => point.value !== null)
  if (valid.length < 2) return null
  const pad = 5
  const values = valid.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (index: number) => pad + (index * (width - pad * 2)) / (valid.length - 1)
  const y = (value: number) => {
    const ratio = (value - min) / span
    return pad + (invert ? ratio : 1 - ratio) * (height - pad * 2)
  }
  const path = valid.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')
  const last = valid.length - 1
  const summary = `${label} : ${valid.map((point) => `${point.label} ${format(point.value)}`).join(', ')}`

  return (
    <span className="relative inline-block" style={{ width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} className="overflow-visible">
        <path d={path} fill="none" stroke="var(--viz-context)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(last)} cy={y(valid[last].value)} r={4} fill="var(--viz-accent)" stroke="var(--viz-ring)" strokeWidth={2} />
        {hover !== null && hover !== last && (
          <circle cx={x(hover)} cy={y(valid[hover].value)} r={4} fill="var(--viz-context)" stroke="var(--viz-ring)" strokeWidth={2} />
        )}
        {valid.map((point, index) => (
          <rect
            key={index}
            x={x(index) - (width - pad * 2) / (valid.length - 1) / 2}
            y={0}
            width={Math.max(12, (width - pad * 2) / (valid.length - 1))}
            height={height}
            fill="transparent"
            onPointerEnter={() => setHover(index)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <Tip value={format(valid[hover].value)} label={valid[hover].label} style={{ left: x(hover), top: y(valid[hover].value) - 6 }} />
      )}
    </span>
  )
}

/** Couleur et mention d'un état (à corriger, à consolider, solide) : toujours affichées ensemble */
export const BAND_STYLE = {
  weak: { label: 'À corriger', color: 'var(--viz-bad)', ink: '#ffffff' },
  medium: { label: 'À consolider', color: 'var(--viz-warn)', ink: '#0b0b0b' },
  strong: { label: 'Solide', color: 'var(--viz-good)', ink: '#ffffff' },
} as const

/**
 * Tuile de chiffre clé : libellé, valeur (chiffres proportionnels), état avec sa mention, écart avec l'audit précédent
 * et mini-courbe de l'évolution. `hero` : le chiffre qui ouvre la page (un seul par vue).
 */
export function StatTile({
  label,
  value,
  unit,
  band,
  delta,
  trend,
  hint,
  href,
  onClick,
  hero = false,
  children,
}: {
  label: string
  value: ReactNode
  unit?: string
  band?: keyof typeof BAND_STYLE
  delta?: ReactNode
  trend?: ReactNode
  hint?: ReactNode
  href?: string
  onClick?: () => void
  hero?: boolean
  children?: ReactNode
}) {
  const body = (
    <>
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {band && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-foreground">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: BAND_STYLE[band].color }} aria-hidden="true" />
            {BAND_STYLE[band].label}
          </span>
        )}
      </span>
      <span className="mt-1 flex items-end justify-between gap-3">
        <span className="flex items-baseline gap-1">
          <span className={`${hero ? 'text-6xl' : 'text-3xl'} font-extrabold leading-none tracking-tight text-foreground`}>{value}</span>
          {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        </span>
        {trend}
      </span>
      {delta && <span className="mt-2 block">{delta}</span>}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
      {children}
    </>
  )
  const className = `flex min-w-0 flex-col rounded-2xl border border-shade-33 bg-shade-1e p-4 text-left ${
    href || onClick ? 'transition-colors hover:border-primary/50 focus-visible:border-primary' : ''
  } ${hero ? 'sm:p-5' : ''}`
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    )
  }
  return <div className={className}>{body}</div>
}

/** Piste d'une jauge : un pas plus clair de la couleur de l'état, pour que l'état se lise sur toute la jauge */
const trackOf = (color: string) => `color-mix(in srgb, ${color} 24%, var(--viz-track))`

/**
 * Jauge en anneau d'une note sur 100 : le chiffre en grand au centre (seul chiffre vedette de la vue), l'anneau
 * rempli dans la couleur de l'état, la piste dans un pas plus clair de la même couleur. L'état est aussi écrit à côté
 * (jamais la couleur seule) ; le nom accessible donne la note et l'état.
 */
export function RingMeter({
  value,
  band,
  label,
  size = 152,
  stroke = 10,
}: {
  value: number
  band: keyof typeof BAND_STYLE
  label: string
  size?: number
  stroke?: number
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const share = Math.max(0, Math.min(100, value)) / 100
  const color = BAND_STYLE[band].color
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label} : ${value} sur 100, ${BAND_STYLE[band].label.toLowerCase()}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackOf(color)} strokeWidth={stroke} />
        {share > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * share} ${circumference}`}
          />
        )}
      </svg>
      <span className="flex items-baseline gap-0.5" aria-hidden="true">
        <span className="text-6xl font-extrabold leading-none tracking-tight text-foreground">{value}</span>
        <span className="text-sm text-muted-foreground">/100</span>
      </span>
    </span>
  )
}

/** Jauge en barre d'une note sur 100 : remplissage dans la couleur de l'état, piste du même ton, extrémités arrondies */
export function BarMeter({ value, band, label }: { value: number; band: keyof typeof BAND_STYLE; label: string }) {
  const color = BAND_STYLE[band].color
  return (
    <span
      className="block h-2 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: trackOf(color) }}
      role="img"
      aria-label={`${label} : ${value} sur 100, ${BAND_STYLE[band].label.toLowerCase()}`}
    >
      <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
    </span>
  )
}

export type RankedItem = {
  id: string
  label: string
  /** Précision sous le libellé (pilier, nombre de pages) */
  sub?: string
  value: number
  /** Valeur affichée au bout de la barre */
  display: string
  href?: string
  onSelect?: () => void
}

/**
 * Barres horizontales classées : une seule série, la première barre (la plus forte) dans la couleur d'accent, les
 * autres en gris de contexte. Libellé au-dessus, valeur au bout : se lit aussi bien dans un tiroir étroit.
 */
export function RankedBars({ items, ariaLabel }: { items: RankedItem[]; ariaLabel: string }) {
  const max = Math.max(...items.map((item) => item.value), 0)
  if (items.length === 0 || max <= 0) return null
  return (
    <ol className="flex flex-col gap-2.5" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const width = `${Math.max(2, (item.value / max) * 100)}%`
        const content = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-sm text-foreground">
                {item.label}
                {item.sub && <span className="ml-1.5 text-xs text-muted-foreground">{item.sub}</span>}
              </span>
              <span className="shrink-0 text-sm font-semibold text-foreground">{item.display}</span>
            </span>
            <span className="mt-1 block h-3 w-full" aria-hidden="true">
              <span
                className="block h-3 rounded-r-[4px] transition-opacity group-hover:opacity-80"
                style={{ width, backgroundColor: index === 0 ? 'var(--viz-accent)' : 'var(--viz-context)' }}
              />
            </span>
          </>
        )
        const className = 'group block w-full rounded-lg px-2 py-1.5 text-left hover:bg-shade-25 focus-visible:bg-shade-25'
        return (
          <li key={item.id}>
            {item.href ? (
              <Link href={item.href} className={className}>
                {content}
              </Link>
            ) : item.onSelect ? (
              <button type="button" onClick={item.onSelect} className={className}>
                {content}
              </button>
            ) : (
              <div className={className}>{content}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export type StackSegment = {
  key: string
  label: string
  value: number
  /** Valeur lue dans la légende et l'infobulle */
  display: string
  color: string
  /** Couleur d'un texte posé dans le segment (blanc ou presque noir selon la couleur) */
  ink?: string
}

/**
 * Barre empilée horizontale : parts d'un tout, segments séparés par 2 px, légende toujours présente avec les valeurs
 * (elle tient lieu de tableau), étiquette dans le segment seulement s'il est assez large.
 */
export function StackedBar({
  segments,
  ariaLabel,
  height = 22,
  showShare = true,
}: {
  segments: StackSegment[]
  ariaLabel: string
  height?: number
  /** Part écrite dans les segments assez larges ; false pour une barre fine (la légende porte les valeurs) */
  showShare?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const visible = segments.filter((segment) => segment.value > 0)
  return (
    <div className="min-w-0">
      <div className="relative">
        <div className="flex w-full gap-[2px]" style={{ height }} role="img" aria-label={`${ariaLabel} : ${segments.map((segment) => `${segment.label} ${segment.display}`).join(', ')}`}>
          {total <= 0 ? (
            <span className="h-full w-full rounded-[4px] bg-[var(--viz-track)]" />
          ) : (
            visible.map((segment, index) => {
              const share = segment.value / total
              const first = index === 0
              const lastOne = index === visible.length - 1
              return (
                <span
                  key={segment.key}
                  tabIndex={0}
                  onPointerEnter={() => setHover(index)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  className="relative flex h-full min-w-[4px] items-center justify-center outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-primary"
                  style={{
                    flexGrow: segment.value,
                    flexBasis: 0,
                    backgroundColor: segment.color,
                    borderRadius: `${first ? 4 : 0}px ${lastOne ? 4 : 0}px ${lastOne ? 4 : 0}px ${first ? 4 : 0}px`,
                  }}
                >
                  {showShare && share >= 0.16 && (
                    <span className="px-1 text-[11px] font-semibold" style={{ color: segment.ink ?? '#ffffff' }}>
                      {Math.round(share * 100)} %
                    </span>
                  )}
                </span>
              )
            })
          )}
        </div>
        {hover !== null && visible[hover] && (
          <Tip
            value={visible[hover].display}
            label={visible[hover].label}
            style={{
              left: `${(visible.slice(0, hover).reduce((sum, segment) => sum + segment.value, 0) + visible[hover].value / 2) / total * 100}%`,
              top: -4,
            }}
          />
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((segment) => (
          <li key={segment.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: segment.color }} aria-hidden="true" />
            <span className="text-muted-foreground">{segment.label}</span>
            <span className="font-semibold text-foreground">{segment.display}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Jauge à seuils, pour une mesure où plus bas est mieux (Core Web Vitals) : piste en trois zones (bon, à améliorer,
 * mauvais), repère à la valeur mesurée, verdict écrit.
 */
export function ThresholdMeter({
  label,
  value,
  display,
  good,
  poor,
  max,
}: {
  label: string
  value: number
  display: string
  good: number
  poor: number
  max: number
}) {
  const band = value <= good ? 'strong' : value <= poor ? 'medium' : 'weak'
  const verdict = band === 'strong' ? 'Bon' : band === 'medium' ? 'À améliorer' : 'Mauvais'
  const at = (point: number) => `${Math.min(100, (point / max) * 100)}%`
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-foreground">{label}</span>
        <span>
          <strong className="text-foreground">{display}</strong>
          <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className="size-2 rounded-full" style={{ backgroundColor: BAND_STYLE[band].color }} aria-hidden="true" />
            {verdict}
          </span>
        </span>
      </div>
      <div className="relative mt-1.5 h-2.5" role="img" aria-label={`${label} : ${display}, ${verdict.toLowerCase()} (bon jusqu'à ${good}, mauvais au-delà de ${poor})`}>
        <div className="flex h-full w-full gap-[2px]">
          <span className="h-full rounded-l-[4px]" style={{ width: at(good), backgroundColor: 'color-mix(in srgb, var(--viz-good) 35%, var(--viz-track))' }} />
          <span className="h-full" style={{ width: `calc(${at(poor)} - ${at(good)})`, backgroundColor: 'color-mix(in srgb, var(--viz-warn) 35%, var(--viz-track))' }} />
          <span className="h-full flex-1 rounded-r-[4px]" style={{ backgroundColor: 'color-mix(in srgb, var(--viz-bad) 35%, var(--viz-track))' }} />
        </div>
        <span
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--viz-ring)]"
          style={{ left: at(value), backgroundColor: BAND_STYLE[band].color }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
