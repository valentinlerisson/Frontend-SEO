'use client'

import { useEffect, useId, useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import type { GeoZone } from '@/core/domain/zones'

const KIND_LABEL: Record<GeoZone['kind'], string> = { commune: 'Ville', departement: 'Département', region: 'Région' }

/**
 * Recherche d'une zone (ville, code postal, numéro ou nom de département, région) dans l'API Géo officielle.
 * Le nom de la zone choisie est ajouté à la fin des recherches Google (« agence web eure-et-loir »).
 */
export function ZonePicker({
  onPick,
  placeholder = 'Ville, code postal, département ou région',
  disabled = false,
}: {
  onPick: (zone: GeoZone) => void
  placeholder?: string
  disabled?: boolean
}) {
  const inputId = useId()
  const [text, setText] = useState('')
  const [zones, setZones] = useState<GeoZone[]>([])
  const [loading, setLoading] = useState(false)

  // Propositions après une courte pause de frappe (l'API limite les appels rapprochés)
  useEffect(() => {
    const query = text.trim()
    if (query.length < 2) {
      setZones([])
      return
    }
    let active = true
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`)
        const data = await res.json().catch(() => ({}))
        if (active) setZones(Array.isArray(data.zones) ? data.zones : [])
      } finally {
        if (active) setLoading(false)
      }
    }, 350)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [text])

  return (
    <div className="relative w-full max-w-sm">
      <label htmlFor={inputId} className="sr-only">
        Ajouter une zone
      </label>
      <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        id={inputId}
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-shade-44 bg-shade-18 pr-9 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
      />
      {loading && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />}
      {zones.length > 0 && (
        <ul
          role="listbox"
          aria-label="Zones proposées"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-shade-44 bg-shade-18 shadow-lg"
        >
          {zones.map((zone) => (
            <li key={zone.id} role="option" aria-selected="false">
              <button
                type="button"
                onClick={() => {
                  onPick(zone)
                  setText('')
                  setZones([])
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-shade-33"
              >
                <span className="font-semibold text-foreground">
                  {zone.label} <span className="font-normal text-muted-foreground">· {KIND_LABEL[zone.kind]}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {zone.kind === 'commune' ? zone.region?.name ?? '' : `Ajouté aux recherches : « … ${zone.name.toLowerCase()} »`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
