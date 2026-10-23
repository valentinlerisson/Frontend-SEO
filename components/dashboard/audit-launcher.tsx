import { AuditUrlForm } from './audit-url-form'

type AuditLauncherProps = {
  firstName: string
  onLaunch: (domain: string) => void
}

export function AuditLauncher({ firstName, onLaunch }: AuditLauncherProps) {
  return (
    <section
      aria-labelledby="welcome-title"
      className="rounded-2xl border border-primary bg-card px-6 py-8 md:px-12 md:py-10"
    >
      <h1 id="welcome-title" className="text-3xl font-medium text-balance md:text-5xl">
        Bonjour, {firstName}
      </h1>
      <p className="mt-3 text-base text-muted-foreground md:text-xl">
        Prêt à lancer un nouvel audit ou reprendre une analyse en cours ?
      </p>
      <AuditUrlForm onLaunch={onLaunch} className="mt-8" />
    </section>
  )
}
