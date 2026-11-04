/**
 * Éléments communs aux documents imprimables (rapport d'audit, fiche de page) : couleurs d'impression fixes,
 * indépendantes du thème de l'interface et contrastées sur blanc ; jauge dont la note est toujours écrite en plus
 * de sa couleur ; titres de section.
 */

export const INK = {
  good: '#0f7a0d',
  mid: '#8a6400',
  bad: '#b42318',
  info: '#0b5cad',
  muted: '#55555f',
  line: '#d9d9de',
  soft: '#f4f4f6',
  brand: '#f5e400',
}

export function tone(score: number) {
  if (score >= 80) return { color: INK.good, label: 'Solide' }
  if (score >= 60) return { color: INK.mid, label: 'À consolider' }
  return { color: INK.bad, label: 'À corriger' }
}

export function Gauge({ score, size = 132, label, caption }: { score: number; size?: number; label: string; caption?: string }) {
  const stroke = size / 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const { color, label: verdict } = tone(score)
  return (
    <figure className="flex flex-col items-center" aria-label={`${label} : ${score} sur 100, ${verdict}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={INK.line} strokeWidth={stroke} />
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
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size / 3.6} fontWeight="800" fill="#111">
          {score}
        </text>
      </svg>
      <figcaption className="mt-1 text-center">
        <span className="block text-sm font-bold">{label}</span>
        <span className="block text-xs font-semibold" style={{ color }}>
          {verdict}
        </span>
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
        <circle cx={size / 2} cy={size / 2} r={(size - size / 10) / 2} fill="none" stroke={INK.line} strokeWidth={size / 10} strokeDasharray="4 6" />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size / 5} fill={INK.muted}>
          —
        </text>
      </svg>
      <figcaption className="mt-1 text-center">
        <span className="block text-sm font-bold">{label}</span>
        <span className="block text-[11px]" style={{ color: INK.muted }}>
          {reason}
        </span>
      </figcaption>
    </figure>
  )
}

export function SectionTitle({ number, title, intro }: { number?: number; title: string; intro?: string }) {
  return (
    <header className="mb-3 border-b-2 pb-2" style={{ borderColor: INK.brand }}>
      <h2 className="text-xl font-extrabold">
        {number !== undefined && <span style={{ color: INK.muted }}>{number}. </span>}
        {title}
      </h2>
      {intro && (
        <p className="mt-1 text-sm" style={{ color: INK.muted }}>
          {intro}
        </p>
      )}
    </header>
  )
}
