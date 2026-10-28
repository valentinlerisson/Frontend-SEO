'use client'

import { useState } from 'react'
import { Check, Code2, Copy } from 'lucide-react'
import type { SchemaSnippet } from '@/lib/audit-data'

/**
 * Balisage Schema.org suggéré pour porter les signaux E-E-A-T.
 * Ouvert et mis en avant quand l'anomalie E-E-A-T est levée, replié et discret sinon.
 */
export function SchemaSnippetBlock({ snippet }: { snippet: SchemaSnippet }) {
  const [copied, setCopied] = useState(false)
  const script = `<script type="application/ld+json">\n${snippet.json}\n</script>`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Presse-papiers indisponible : le code reste sélectionnable
    }
  }

  return (
    <details
      open={snippet.recommended}
      className={`group rounded-lg border ${
        snippet.recommended ? 'border-line-yellow bg-tint-yellow' : 'border-shade-2f bg-shade-14'
      }`}
    >
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs ${
          snippet.recommended ? 'font-semibold text-yellow-pale' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Code2 className="size-3.5 shrink-0" aria-hidden="true" />
        {snippet.recommended
          ? `À intégrer : balisage Schema.org ${snippet.type} pour renforcer les signaux E-E-A-T`
          : `Balisage Schema.org ${snippet.type} suggéré`}
      </summary>

      <div className="space-y-2 border-t border-shade-2f p-3">
        {snippet.alreadyPresent && (
          <p className="text-xs text-yellow-pale/90">
            Un balisage {snippet.type} existe déjà sur cette page : complétez-le avec ces champs plutôt que
            d’ajouter un doublon.
          </p>
        )}
        {snippet.placeholders.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {snippet.placeholders.length} champ{snippet.placeholders.length > 1 ? 's' : ''} « [À COMPLÉTER] » à
            renseigner avec vos vraies informations avant de publier. Rien n’est inventé à votre place.
          </p>
        )}
        <pre className="max-h-72 overflow-auto rounded-md bg-inset-strong p-3 text-[11px] leading-relaxed text-foreground">
          <code>{script}</code>
        </pre>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md border border-shade-44 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-green-ink" /> : <Copy className="size-3.5" />}
          {copied ? 'Copié' : 'Copier le code'}
        </button>
      </div>
    </details>
  )
}
