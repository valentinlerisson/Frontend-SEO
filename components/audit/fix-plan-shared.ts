import { getIssueImpact } from '@/lib/issue-impact'
import type { PlanTask } from '@/core/services/fix-plan-service'

/** Libellés et petits utilitaires partagés par les cartes du plan d'action (tâche, groupe) */

export const PILLAR_LABEL: Record<string, string> = { TECH: 'Technique', EDITORIAL: 'Contenu', GEO: 'Moteurs IA', CUSTOM: 'Tâche libre' }

export const SEVERITY: Record<string, { label: string; color: string; ui: 'critical' | 'warning' | 'passed' }> = {
  CRITICAL: { label: 'Critique', color: 'var(--viz-bad)', ui: 'critical' },
  WARNING: { label: 'Avertissement', color: 'var(--viz-warn)', ui: 'warning' },
  INFO: { label: 'Mineure', color: 'var(--viz-accent)', ui: 'passed' },
}

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

export const impactOf = (task: PlanTask) =>
  getIssueImpact({ pillar: task.pillar as 'TECH' | 'EDITORIAL' | 'GEO', code: task.code, severity: SEVERITY[task.severity]?.ui ?? 'warning' })

/** Tâche libre : créée à la main, sans anomalie (ni gravité, ni impact, ni vérification par l'audit) */
export const isCustom = (task: PlanTask) => task.source === 'CUSTOM'

export const pageLabel = (task: PlanTask) => task.path ?? (isCustom(task) ? 'Sans page' : 'Tout le site')

export const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`
