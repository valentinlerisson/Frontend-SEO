'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_MAX_AI_PAGES,
  MAX_MAX_AI_PAGES,
  MIN_MAX_AI_PAGES,
  useSettings,
} from '@/components/providers/settings-provider'
import { DEFAULT_MAX_CRAWL_PAGES, MAX_MAX_CRAWL_PAGES, MIN_MAX_CRAWL_PAGES } from '@/core/domain/crawl-scope'
import {
  DEFAULT_SERP_PER_DAY,
  DEFAULT_SERP_PER_RUN,
  MAX_SERP_PER_DAY,
  MAX_SERP_PER_RUN,
  MIN_SERP_PER_DAY,
  MIN_SERP_PER_RUN,
} from '@/core/domain/serp-budget'

function NumberSetting({
  id,
  label,
  help,
  value,
  min,
  max,
  defaultValue,
  onChange,
}: {
  id: string
  label: string
  help: string
  value: number
  min: number
  max: number
  defaultValue: number
  onChange: (value: number) => void
}) {
  // Saisie libre, enregistrée (et bornée) en quittant le champ ou sur Entrée : sinon taper « 500 » passerait par « 5 »
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    onChange(Number(draft))
    setDraft(String(value))
  }
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-semibold text-foreground">
        {label}
      </label>
      <p id={`${id}-help`} className="mt-1 text-xs text-muted-foreground">
        {help} Entre {min} et {max}, {defaultValue} par défaut.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          value={draft}
          aria-describedby={`${id}-help`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
          className="h-11 w-32 rounded-xl border border-shade-44 bg-shade-18 px-3.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={() => onChange(defaultValue)}
          className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-shade-33 hover:text-foreground"
        >
          Réinitialiser
        </button>
      </div>
    </div>
  )
}

export function SettingsView() {
  const { maxAiPages, setMaxAiPages, maxCrawlPages, setMaxCrawlPages, serpPerRun, setSerpPerRun, serpPerDay, setSerpPerDay } =
    useSettings()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Paramètres</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enregistrés dans ce navigateur.</p>
      </div>

      <section className="glass-card max-w-2xl rounded-2xl border p-6">
        <h2 className="text-lg font-bold text-foreground">Exploration du site</h2>
        <NumberSetting
          id="max-crawl-pages"
          label="Pages explorées au maximum par audit"
          help="S’applique à tous les périmètres : tout le site, sitemaps choisis (les pages principales restent limitées à 50). Plus il y a de pages, plus l’audit est long."
          value={maxCrawlPages}
          min={MIN_MAX_CRAWL_PAGES}
          max={MAX_MAX_CRAWL_PAGES}
          defaultValue={DEFAULT_MAX_CRAWL_PAGES}
          onChange={setMaxCrawlPages}
        />
      </section>

      <section className="glass-card max-w-2xl rounded-2xl border p-6">
        <h2 className="text-lg font-bold text-foreground">Mesure Google (Positionnement)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Les recherches automatisées vont à l’encontre des conditions d’utilisation de Google et peuvent déclencher un
          captcha. Chaque page de résultats lue compte ; un résultat déjà en cache (moins de 24 h) ne compte pas. Ce qui
          dépasse le budget reste « en attente » et se reprend plus tard.
        </p>
        <NumberSetting
          id="serp-per-run"
          label="Recherches Google par lancement"
          help="Plafond d’un clic sur « Analyser la sélection »."
          value={serpPerRun}
          min={MIN_SERP_PER_RUN}
          max={MAX_SERP_PER_RUN}
          defaultValue={DEFAULT_SERP_PER_RUN}
          onChange={setSerpPerRun}
        />
        <NumberSetting
          id="serp-per-day"
          label="Recherches Google par jour"
          help="Tous projets confondus : toutes les recherches partent de cet ordinateur."
          value={serpPerDay}
          min={MIN_SERP_PER_DAY}
          max={MAX_SERP_PER_DAY}
          defaultValue={DEFAULT_SERP_PER_DAY}
          onChange={setSerpPerDay}
        />
      </section>

      <section className="glass-card max-w-2xl rounded-2xl border p-6">
        <h2 className="text-lg font-bold text-foreground">Analyse IA</h2>
        <NumberSetting
          id="max-ai-pages"
          label="Pages stratégiques analysables par l’IA"
          help="Plafond de pages stratégiques sélectionnables dans Sous-pages."
          value={maxAiPages}
          min={MIN_MAX_AI_PAGES}
          max={MAX_MAX_AI_PAGES}
          defaultValue={DEFAULT_MAX_AI_PAGES}
          onChange={setMaxAiPages}
        />
      </section>
    </div>
  )
}
