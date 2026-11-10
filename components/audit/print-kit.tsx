import type { ReactNode } from 'react'

/**
 * Éléments communs aux documents imprimables (rapport d'audit, fiche de page) : couleurs d'impression fixes,
 * indépendantes du thème de l'interface ; jauge et barre dont la note est toujours écrite en plus de leur couleur ;
 * pastilles, encadrés et titres de section.
 *
 * Deux jeux de couleurs par état : `good`, `mid`, `bad`, `info` pour les formes (traits, barres, jauges : l'accent
 * jaune est `#eab308`), et `*Text` pour le texte, plus sombre pour rester lisible sur blanc (le jaune seul est trop
 * clair pour écrire dessus). `*Tint` sert de fond aux pastilles.
 */

export const INK = {
  good: '#16a34a',
  mid: '#eab308',
  bad: '#dc2626',
  info: '#2563eb',
  goodText: '#166534',
  midText: '#854d0e',
  badText: '#991b1b',
  infoText: '#1e40af',
  goodTint: '#dcfce7',
  midTint: '#fef9c3',
  badTint: '#fee2e2',
  infoTint: '#dbeafe',
  text: '#111827',
  muted: '#4b5563',
  line: '#e5e7eb',
  track: '#eceef1',
  soft: '#f6f7f9',
  brand: '#eab308',
}

/** Accord français : 0 et 1 au singulier (« 0 page », « 1 page », « 2 pages ») */
export const count = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

export type Tone = 'good' | 'mid' | 'bad' | 'info' | 'neutral'

/** Couleurs d'un état : forme, texte, fond */
export function palette(tone: Tone) {
  if (tone === 'neutral') return { color: INK.muted, text: INK.muted, tint: INK.soft }
  return { color: INK[tone], text: INK[`${tone}Text`], tint: INK[`${tone}Tint`] }
}

/** Verdict d'une note : au-dessus de 80 solide, de 60 à 79 à consolider, sous 60 à corriger */
export function tone(score: number) {
  const state: Tone = score >= 80 ? 'good' : score >= 60 ? 'mid' : 'bad'
  return { ...palette(state), state, label: score >= 80 ? 'Solide' : score >= 60 ? 'À consolider' : 'À corriger' }
}

/** Pastille : un mot, sur fond teinté (la couleur n'est jamais seule) */
export function Chip({ tone: state = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const { text, tint, color } = palette(state)
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold leading-4"
      style={{ background: tint, color: text, boxShadow: `inset 0 0 0 1px ${state === 'neutral' ? INK.line : `${color}55`}` }}
    >
      {children}
    </span>
  )
}

/** Encadré d'une action à mener ou d'une remarque : filet jaune à gauche, fond doux */
export function Callout({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <p className="mt-2 break-inside-avoid rounded-lg border-l-4 px-3 py-2 text-sm leading-relaxed" style={{ borderColor: INK.brand, background: INK.soft }}>
      {label && <strong className="mr-1">{label}</strong>}
      {children}
    </p>
  )
}

/** Note sur 100 en barre (pour les tableaux) : la valeur et le verdict sont écrits à côté */
export function ScoreBar({ score }: { score: number }) {
  const { color, text, label } = tone(score)
  return (
    <span className="block">
      <span className="block whitespace-nowrap">
        <strong className="text-lg font-extrabold" style={{ color: text }}>
          {score}
        </strong>
        <span className="text-xs" style={{ color: INK.muted }}>
          {' '}
          / 100
        </span>
      </span>
      <span className="my-1 block h-1.5 w-full overflow-hidden rounded-full" style={{ background: INK.track }} role="img" aria-label={`${score} sur 100`}>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, score))}%`, background: color }} />
      </span>
      <span className="block text-[11px] font-semibold" style={{ color: INK.muted }}>
        {label}
      </span>
    </span>
  )
}

export function Gauge({ score, size = 132, label, caption }: { score: number; size?: number; label: string; caption?: string }) {
  const stroke = size / 9
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const { color, label: verdict, state } = tone(score)
  return (
    <figure className="flex flex-col items-center" aria-label={`${label} : ${score} sur 100, ${verdict}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={INK.track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(circumference * score) / 100} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="48%" textAnchor="middle" dominantBaseline="central" fontSize={size / 3.2} fontWeight="800" fill={INK.text}>
          {score}
        </text>
        <text x="50%" y="70%" textAnchor="middle" dominantBaseline="central" fontSize={size / 12} fontWeight="600" fill={INK.muted}>
          sur 100
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-col items-center gap-1 text-center">
        <span className="block text-sm font-bold">{label}</span>
        <Chip tone={state}>{verdict}</Chip>
        {caption && (
          <span className="block text-[11px]" style={{ color: INK.muted }}>
            {caption}
          </span>
        )}
      </figcaption>
    </figure>
  )
}

/** Note indisponible (page non stratégique ou non analysée) : cercle vide et raison écrite */
export function EmptyGauge({ size = 132, label, reason }: { size?: number; label: string; reason: string }) {
  return (
    <figure className="flex flex-col items-center" aria-label={`${label} : ${reason}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={(size - size / 9) / 2} fill="none" stroke={INK.line} strokeWidth={size / 9} strokeDasharray="4 6" />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size / 5} fill={INK.muted}>
          —
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-col items-center gap-1 text-center">
        <span className="block text-sm font-bold">{label}</span>
        <Chip>{reason}</Chip>
      </figcaption>
    </figure>
  )
}

/** Titre de section : pastille numérotée jaune, titre, filet, phrase d'introduction */
export function SectionTitle({ number, title, intro }: { number?: number; title: string; intro?: string }) {
  return (
    <header className="mb-4 break-after-avoid border-b pb-3" style={{ borderColor: INK.line }}>
      <h2 className="flex items-center gap-3 text-xl font-extrabold leading-tight">
        {number !== undefined && (
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-extrabold"
            style={{ background: INK.brand, color: INK.text }}
          >
            {number}
          </span>
        )}
        {title}
      </h2>
      {intro && (
        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: INK.muted }}>
          {intro}
        </p>
      )}
    </header>
  )
}
