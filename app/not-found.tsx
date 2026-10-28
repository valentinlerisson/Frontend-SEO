import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-6xl font-extrabold text-primary-ink">404</p>
      <h1 className="text-2xl font-bold text-foreground">Projet ou page introuvable</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Ce projet n’existe pas ou a été supprimé. Retournez au tableau de bord pour lancer un audit ou
        ouvrir un projet existant.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-[#e0d100]"
        >
          Tableau de bord
        </Link>
        <Link
          href="/projets"
          className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-shade-2b"
        >
          Mes projets
        </Link>
      </div>
    </div>
  )
}
