'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Circle, CircleMarker, GeoJSON as GeoJsonLayer, LayerGroup, Map as LeafletMap } from 'leaflet'
import type { GeoPoint, ShapeGeometry } from '@/core/domain/geo-radius'
import type { GeoZone } from '@/core/domain/zones'
import type { ZoneBand } from '@/core/domain/local-visibility'

export const BAND_LABEL: Record<ZoneBand, string> = {
  top3: 'Top 3',
  top10: 'Positions 4 à 10',
  top30: 'Positions 11 à 30',
  absent: 'Absente du Top 30',
  unmeasured: 'Pas encore mesurée',
}

export type MapZone = { zone: GeoZone; band: ZoneBand; detail: string }
export type MapPin = { id: string; label: string; detail: string; point: GeoPoint }
export type MapCommune = { code: string; name: string; population: number; distanceKm: number; latitude: number; longitude: number }

/** Contours déjà chargés (zone → géométrie), gardés le temps de la session */
const contourCache = new Map<string, Promise<ShapeGeometry | null>>()
function contourOf(zone: GeoZone): Promise<ShapeGeometry | null> {
  if (zone.kind !== 'commune' && zone.kind !== 'departement' && zone.kind !== 'region') return Promise.resolve(null)
  const key = `${zone.kind}:${zone.code}`
  if (!contourCache.has(key)) {
    contourCache.set(
      key,
      fetch(`/api/geo/contour?kind=${zone.kind}&code=${encodeURIComponent(zone.code)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => (data?.geometry as ShapeGeometry | undefined) ?? null)
        .catch(() => null),
    )
  }
  return contourCache.get(key)!
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)

/**
 * Carte des zones (Leaflet, fond OpenStreetMap, contours IGN) : zones ciblées colorées selon leur meilleure position
 * mesurée, siège et établissements, cercle du rayon et villes qu'il contient. Un clic sur la carte déplace le centre
 * du rayon ; un clic sur une ville du rayon la propose comme zone.
 */
export function ZonesMap({
  zones,
  pins,
  center,
  radiusKm,
  communes,
  onCenterChange,
  onCommuneClick,
}: {
  zones: MapZone[]
  pins: MapPin[]
  center: GeoPoint | null
  radiusKm: number
  communes: MapCommune[]
  onCenterChange: (point: GeoPoint) => void
  onCommuneClick: (commune: MapCommune) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const layersRef = useRef<{ zones?: LayerGroup; pins?: LayerGroup; communes?: LayerGroup; circle?: Circle; centerMark?: CircleMarker }>({})
  const fittedRef = useRef(false)
  // Rappels à jour sans recréer la carte
  const callbacks = useRef({ onCenterChange, onCommuneClick })
  callbacks.current = { onCenterChange, onCommuneClick }

  // Création de la carte (une fois, côté navigateur)
  useEffect(() => {
    let disposed = false
    void import('leaflet').then((L) => {
      if (disposed || !containerRef.current || mapRef.current) return
      leafletRef.current = L
      const map = L.map(containerRef.current, { center: [46.6, 2.4], zoom: 5, scrollWheelZoom: false, attributionControl: true })
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · contours © IGN',
      }).addTo(map)
      map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>')
      map.on('click', (event) => callbacks.current.onCenterChange({ latitude: event.latlng.lat, longitude: event.latlng.lng }))
      // Molette active après un clic dans la carte, pour ne pas bloquer le défilement de la page
      map.on('focus', () => map.scrollWheelZoom.enable())
      map.on('blur', () => map.scrollWheelZoom.disable())
      layersRef.current.zones = L.layerGroup().addTo(map)
      layersRef.current.communes = L.layerGroup().addTo(map)
      layersRef.current.pins = L.layerGroup().addTo(map)
      mapRef.current = map
    })
    return () => {
      disposed = true
      mapRef.current?.remove()
      mapRef.current = null
      layersRef.current = {}
      fittedRef.current = false
    }
  }, [])

  // Contours des zones
  const zonesKey = zones.map((item) => `${item.zone.id}:${item.band}:${item.detail}`).join('|')
  useEffect(() => {
    let active = true
    const draw = async () => {
      const L = leafletRef.current
      const map = mapRef.current
      const group = layersRef.current.zones
      if (!L || !map || !group) return
      const shapes = await Promise.all(zones.map(async (item) => ({ item, geometry: await contourOf(item.zone) })))
      if (!active) return
      group.clearLayers()
      const layers: GeoJsonLayer[] = []
      for (const { item, geometry } of shapes) {
        if (!geometry) continue
        const layer = L.geoJSON({ type: 'Feature', properties: {}, geometry } as GeoJSON.Feature, {
          style: { className: `zone-shape zone-${item.band}`, weight: 2 },
          interactive: true,
        })
        layer.bindTooltip(`<strong>${escapeHtml(item.zone.label)}</strong><br>${escapeHtml(item.detail)}`, { sticky: true })
        layer.addTo(group)
        layers.push(layer)
      }
      // Premier cadrage : toutes les zones (et le cercle s'il existe)
      if (!fittedRef.current && layers.length > 0) {
        const bounds = L.featureGroup(layers).getBounds()
        const circle = layersRef.current.circle
        if (circle) bounds.extend(circle.getBounds())
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 11 })
        fittedRef.current = true
      }
    }
    const map = mapRef.current
    if (map) void draw()
    else {
      // Carte pas encore prête : dessin dès sa création
      const timer = window.setInterval(() => {
        if (mapRef.current) {
          window.clearInterval(timer)
          void draw()
        }
      }, 100)
      return () => {
        active = false
        window.clearInterval(timer)
      }
    }
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonesKey])

  // Siège, établissements, cercle du rayon et villes du rayon
  const pinsKey = pins.map((pin) => `${pin.id}:${pin.point.latitude}:${pin.point.longitude}`).join('|')
  const communesKey = communes.map((commune) => commune.code).join('|')
  useEffect(() => {
    const apply = () => {
      const L = leafletRef.current
      const map = mapRef.current
      const layers = layersRef.current
      if (!L || !map || !layers.pins || !layers.communes) return false

      layers.pins.clearLayers()
      for (const pin of pins) {
        L.circleMarker([pin.point.latitude, pin.point.longitude], { radius: 7, className: 'map-pin', weight: 2 })
          .bindTooltip(`<strong>${escapeHtml(pin.label)}</strong><br>${escapeHtml(pin.detail)}`)
          .addTo(layers.pins)
      }

      layers.communes.clearLayers()
      for (const commune of communes) {
        L.circleMarker([commune.latitude, commune.longitude], { radius: 5, className: 'map-commune', weight: 1.5 })
          .bindTooltip(
            `<strong>${escapeHtml(commune.name)}</strong><br>${commune.population.toLocaleString('fr-FR')} habitants · ${commune.distanceKm.toLocaleString('fr-FR')} km<br>Cliquer pour l’ajouter comme zone`,
          )
          .on('click', (event) => {
            L.DomEvent.stopPropagation(event)
            callbacks.current.onCommuneClick(commune)
          })
          .addTo(layers.communes)
      }

      layers.circle?.remove()
      layers.centerMark?.remove()
      layers.circle = undefined
      layers.centerMark = undefined
      if (center) {
        const latlng: [number, number] = [center.latitude, center.longitude]
        layers.circle = L.circle(latlng, { radius: radiusKm * 1000, className: 'map-radius', weight: 2, interactive: false }).addTo(map)
        layers.centerMark = L.circleMarker(latlng, { radius: 4, className: 'map-radius-center', interactive: false }).addTo(map)
        // Cercle hors de la vue (nouveau centre, rayon agrandi) : la carte le recadre
        const bounds = layers.circle.getBounds()
        if (!map.getBounds().contains(bounds)) map.fitBounds(bounds, { padding: [24, 24] })
      }
      return true
    }
    if (apply()) return
    const timer = window.setInterval(() => {
      if (apply()) window.clearInterval(timer)
    }, 100)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsKey, communesKey, center?.latitude, center?.longitude, radiusKm])

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Carte des zones ciblées, du siège et du rayon"
      className="zones-map relative isolate z-0 h-[360px] w-full overflow-hidden rounded-xl border border-shade-3e md:h-[420px]"
    />
  )
}
