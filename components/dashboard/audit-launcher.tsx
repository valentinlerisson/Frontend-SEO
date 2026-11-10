import type { CrawlScopeChoice } from '@/components/providers/projects-provider'
import { AuditUrlForm } from './audit-url-form'
import { GEO_ENABLED } from '@/core/domain/features'

type AuditLauncherProps = {
  onLaunch: (domain: string, scope?: CrawlScopeChoice) => void
}

/** Carte de lancement d'un audit : explique en une phrase ce qui sera mesuré */
export function AuditLauncher({ onLaunch }: AuditLauncherProps) {
  return (
    <section aria-labelledby="launch-title" className="glass-card rounded-2xl border p-5 md:p-6">
      <h2 id="launch-title" className="text-lg font-bold text-foreground">
        Lancer un audit
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Auditly explore le site, note la technique de chaque page, puis le contenu
        {GEO_ENABLED && ' et la visibilité dans les moteurs IA'} des pages que vous jugez stratégiques.
      </p>
      <AuditUrlForm onLaunch={onLaunch} showLabel withScope className="mt-4" />
    </section>
  )
}
