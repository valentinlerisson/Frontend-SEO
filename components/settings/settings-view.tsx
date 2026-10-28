'use client'

import {
  DEFAULT_MAX_AI_PAGES,
  MAX_MAX_AI_PAGES,
  MIN_MAX_AI_PAGES,
  useSettings,
} from '@/components/providers/settings-provider'

export function SettingsView() {
  const { maxAiPages, setMaxAiPages } = useSettings()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-medium md:text-4xl">Paramètres</h1>

      <section className="glass-card max-w-2xl rounded-2xl border p-6">
        <h2 className="text-xl font-bold text-foreground">Analyse IA</h2>

        <label htmlFor="max-ai-pages" className="mt-4 block text-sm font-medium text-foreground">
          Nombre maximal de pages analysables par l’IA
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Plafond de pages piliers sélectionnables dans Subpages (entre {MIN_MAX_AI_PAGES} et{' '}
          {MAX_MAX_AI_PAGES}). Valeur par défaut : {DEFAULT_MAX_AI_PAGES}.
        </p>

        <div className="mt-3 flex items-center gap-3">
          <input
            id="max-ai-pages"
            type="number"
            min={MIN_MAX_AI_PAGES}
            max={MAX_MAX_AI_PAGES}
            value={maxAiPages}
            onChange={(e) => setMaxAiPages(Number(e.target.value))}
            className="w-28 rounded-xl border border-shade-44 bg-shade-18 px-3.5 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => setMaxAiPages(DEFAULT_MAX_AI_PAGES)}
            className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-shade-33 hover:text-foreground"
          >
            Réinitialiser
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Ce réglage est enregistré dans ce navigateur.
        </p>
      </section>
    </div>
  )
}
