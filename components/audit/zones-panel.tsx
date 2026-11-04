'use client'

import { useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { MAX_PROJECT_ZONES, type GeoZone } from '@/core/domain/zones'
import { ZonePicker } from './zone-picker'

/**
 * Zones ciblées du projet (3 au plus) : les recherches proposées n'ont aucun lieu ; le nom de chaque zone est ajouté
 * à la fin de la recherche au moment de la mesure Google (une mesure par zone).
 */
export function ZonesPanel({
  projectId,
  zones,
  onSaved,
}: {
  projectId: string
  zones: GeoZone[]
  onSaved: () => Promise<void> | void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async (next: GeoZone[]) => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/zones`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zones: next.map((zone) => ({ kind: zone.kind, code: zone.code })) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`)
      setSaved(true)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="zones-title" className="glass-card relative z-30 rounded-2xl border p-5">
      <div className="flex flex-col gap-1">
        <h2 id="zones-title" className="flex items-center gap-2 text-base font-bold text-foreground">
          <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
          Zones ciblées
          <span className="text-xs font-normal text-muted-foreground">
            {zones.length} sur {MAX_PROJECT_ZONES}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Les recherches proposées n’ont aucun lieu : au moment de la mesure, le nom de chaque zone est ajouté à la fin
          (« agence web » devient « agence web chartres »). Sans zone, rien n’est ajouté. Une page peut avoir sa propre
          zone, à choisir dans sa ligne : elle remplace alors celles du projet.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {zones.map((zone) => (
          <span
            key={zone.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-shade-44 py-1 pr-1.5 pl-3 text-sm text-foreground"
          >
            {zone.label}
            <button
              type="button"
              disabled={saving}
              onClick={() => save(zones.filter((item) => item.id !== zone.id))}
              aria-label={`Retirer la zone ${zone.label}`}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-shade-33 hover:text-foreground disabled:opacity-50"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        {zones.length === 0 && <span className="text-sm text-muted-foreground">Aucune zone : recherches mesurées sans lieu.</span>}
      </div>

      {zones.length < MAX_PROJECT_ZONES && (
        <div className="mt-3">
          <ZonePicker
            disabled={saving}
            onPick={(zone) => {
              if (!zones.some((item) => item.id === zone.id)) void save([...zones, zone])
            }}
          />
        </div>
      )}

      <p role="status" className="mt-2 text-xs">
        {error ? (
          <span className="text-red-soft">{error}</span>
        ) : saved ? (
          <span className="text-muted-foreground">
            Zones enregistrées. Les recherches proposées seront mises à jour à la prochaine analyse IA de chaque page
            (« Ré-analyser » dans son tiroir).
          </span>
        ) : (
          ''
        )}
      </p>
    </section>
  )
}
