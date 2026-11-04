'use client'

import { useEffect, useRef, useState } from 'react'
import { useAudit } from '@/components/providers/audit-provider'

/**
 * Annonce aux lecteurs d'écran l'avancement des tâches longues (exploration, analyse IA, mesure Google), sans rien
 * afficher : zone `role="status"` lue poliment, à chaque étape et non à chaque rafraîchissement (paliers de 10 %).
 */
export function ProgressAnnouncer() {
  const { audit, state, progress } = useAudit()
  const [message, setMessage] = useState('')
  const last = useRef('')
  const phase = useRef<'crawl' | 'ai' | 'serp' | 'idle'>('idle')

  useEffect(() => {
    let next = ''
    const status = audit?.status
    const serpQueries = (audit?.subpages ?? []).flatMap((page) =>
      page.serpQueries?.length ? page.serpQueries : page.serp ? [page.serp] : [],
    )
    const serpRunning = serpQueries.some((serp) => serp.status === 'RUNNING')

    if (state === 'LOADING' && (status === 'QUEUED' || status === 'CRAWLING_TECH' || !status)) {
      phase.current = 'crawl'
      next = `Exploration du site en cours : ${Math.floor(progress / 10) * 10} %.`
    } else if (status === 'ANALYZING_AI') {
      phase.current = 'ai'
      next = `Analyse IA en cours : ${Math.floor(progress / 10) * 10} %.`
    } else if (serpRunning) {
      phase.current = 'serp'
      // Pages en cours de mesure : leurs recherches terminées sur leurs recherches prévues
      const pages = (audit?.subpages ?? []).filter((page) =>
        (page.serpQueries ?? (page.serp ? [page.serp] : [])).some((serp) => serp.status === 'RUNNING'),
      )
      const queries = pages.flatMap((page) => page.serpQueries ?? (page.serp ? [page.serp] : []))
      const done = queries.filter((serp) => serp.status !== 'RUNNING').length
      next = `Mesure Google : ${done} recherche(s) sur ${queries.length} terminée(s).`
    } else if (state === 'SUCCESS' && phase.current !== 'idle') {
      next =
        phase.current === 'serp'
          ? 'Mesure Google terminée.'
          : status === 'AWAITING_AI_SELECTION'
            ? 'Exploration terminée : choisissez vos pages stratégiques.'
            : `Audit terminé${audit?.scores.global !== null && audit?.scores.global !== undefined ? ` : note globale ${audit.scores.global} sur 100` : ''}.`
      phase.current = 'idle'
    } else if (state === 'ERROR') {
      next = 'L’audit a échoué.'
      phase.current = 'idle'
    }

    if (next && next !== last.current) {
      last.current = next
      setMessage(next)
    }
  }, [audit, state, progress])

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  )
}
