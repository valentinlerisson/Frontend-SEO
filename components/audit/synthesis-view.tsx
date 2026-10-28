'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowUpRight, Bot, Cpu, FileText, Globe2, Link2, Lock, Sparkles } from 'lucide-react'
import { CircularGauge } from './score-gauges'
import { AuditHeader, ExportPdfButton } from './audit-header'
import { PageInspectionSheet } from './page-inspection-sheet'
import { useAudit } from '@/components/providers/audit-provider'
import { AuditStateGate, PhaseLockBanner } from './audit-state-gate'
import { ImpactBadge } from './impact-badge'
import { pickPriorities } from '@/lib/issue-impact'
import { scoreTone } from '@/lib/score-tone'
import { backlinkSummary, releaseLabel } from '@/lib/backlink-labels'
import type { BacklinkReport } from '@/core/domain/types'


export function SynthesisView({ projectId }: { projectId: string }) {
  const { audit, state } = useAudit()

  if (state !== 'SUCCESS' || !audit) return <AuditStateGate currentTitle="Synthèse" />

  const priorities = pickPriorities(audit.globalIssues, 5)

  return (
    <div className="flex flex-col gap-6">
      <AuditHeader domain={audit.domain} currentTitle="Synthèse" />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Synthèse de l’audit
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {audit.domain} · {audit.crawlStats.crawledPages} pages explorées
            {!audit.isLocked && ` · ${audit.pillarPages.length} pages piliers analysées`}
          </p>
        </div>
        <ExportPdfButton />
      </div>

      {audit.isLocked && <PhaseLockBanner projectId={projectId} />}

      {/* Scores : global à gauche, piliers à droite */}
      <section aria-label="Scores" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex flex-col items-center justify-center glass-card glass-lift rounded-2xl border p-6 text-center lg:col-span-4">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Score global
          </h2>
          {audit.scores.global !== null ? (
            <>
              <CircularGauge
                score={audit.scores.global}
                size={176}
                strokeWidth={16}
                accentColor={scoreTone(audit.scores.global).color}
              />
              <span
                className="mt-4 rounded-full px-3 py-1 text-xs font-bold"
                style={{
                  color: scoreTone(audit.scores.global).textColor,
                  backgroundColor: `color-mix(in srgb, ${scoreTone(audit.scores.global).color} 18%, transparent)`,
                }}
              >
                {scoreTone(audit.scores.global).label}
              </span>
              <p className="mt-3 text-xs text-muted-foreground">
                Technique 40 % · Éditorial 35 % · GEO 25 %
              </p>
            </>
          ) : (
            <LockedScore label="Score global disponible après l’analyse des pages piliers" size={176} />
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-8">
          <PillarCard
            href={`/projets/${projectId}/subpages`}
            icon={<Cpu className="size-4" aria-hidden="true" />}
            title="SEO Technique"
            score={audit.scores.tech}
            caption={`Crawl de ${audit.crawlStats.crawledPages} pages`}
          />
          <PillarCard
            href={`/projets/${projectId}/seo-editorial`}
            icon={<FileText className="size-4" aria-hidden="true" />}
            title="SEO Éditorial"
            score={audit.scores.editorial}
            caption={`${audit.pillarPages.length} pages piliers`}
          />
          <PillarCard
            href={`/projets/${projectId}/geo`}
            icon={<Globe2 className="size-4" aria-hidden="true" />}
            title="GEO (moteurs IA)"
            score={audit.scores.geo}
            caption={`${audit.pillarPages.length} pages piliers`}
          />
        </div>
      </section>

      {/* Anomalies par niveau */}
      <section aria-label="Anomalies" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <IssueTile
          href={`/projets/${projectId}/global-issues?filter=critical`}
          color="#ef4444"
          count={audit.kpis.criticalIssuesCount}
          label="Erreurs critiques"
          hint="Bloquent l’indexation ou le classement"
        />
        <IssueTile
          href={`/projets/${projectId}/global-issues?filter=warning`}
          color="#eab308"
          count={audit.kpis.warningsCount}
          label="Avertissements"
          hint="À corriger pour progresser"
        />
        <IssueTile
          href={`/projets/${projectId}/global-issues?filter=passed`}
          color="#38bdf8"
          count={audit.kpis.goodPracticesCount}
          label="Recommandations mineures"
          hint="Améliorations à faible effort"
        />
      </section>

      <PopularityCard projectId={projectId} report={audit.backlinks} />

      {/* Priorités et conseil */}
      <section
        aria-label="Priorités et conseil"
        className={`grid grid-cols-1 gap-4 ${audit.advice ? 'lg:grid-cols-12' : ''}`}
      >
        <div
          className={`rounded-2xl border border-shade-3e bg-shade-2b p-6 shadow-md ${
            audit.advice ? 'lg:col-span-7' : ''
          }`}
        >
          <h2 className="text-lg font-bold text-foreground">Vos priorités pour monter dans Google</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Les anomalies à fort ou moyen impact sur le classement, par ordre d’importance.
          </p>

          {priorities.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-shade-44 p-4 text-sm text-muted-foreground">
              Aucune anomalie à fort ou moyen impact détectée pour le moment.
            </p>
          ) : (
            <ol className="mt-5 flex flex-col gap-3">
              {priorities.map((issue, index) => (
                <li key={issue.id}>
                  <Link
                    href={`/projets/${projectId}/global-issues/${issue.id}`}
                    className={`group flex items-start gap-3 rounded-xl border border-shade-3e border-l-4 bg-shade-24 p-4 transition-colors hover:bg-shade-2c ${
                      issue.impact === 'high' ? 'border-l-[#ef4444]' : 'border-l-[#eab308]'
                    }`}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{issue.title}</span>
                        <ImpactBadge impact={issue.impact} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {issue.impactCount ?? 0} page{(issue.impactCount ?? 0) > 1 ? 's' : ''} concernée
                        {(issue.impactCount ?? 0) > 1 ? 's' : ''}
                      </p>
                      {issue.recommendation && (
                        <p className="mt-1 line-clamp-2 text-sm text-foreground/80">{issue.recommendation}</p>
                      )}
                    </div>
                    <ArrowUpRight
                      className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>

        {audit.advice && (
          <aside className="rounded-2xl border border-line-indigo bg-gradient-to-b from-grad-indigo-from to-grad-indigo-to p-6 shadow-md lg:col-span-5">
            <div className="flex items-center gap-2 text-indigo-pale">
              <Sparkles className="size-5" aria-hidden="true" />
              <h2 className="text-lg font-bold text-foreground">Conseil de l’analyse</h2>
            </div>
            <p className="mt-3 text-base font-semibold text-indigo-pale">{audit.advice.headline}</p>
            <ul className="mt-4 flex flex-col gap-3">
              {audit.advice.points.map((point) => (
                <li key={point.label} className="rounded-xl bg-inset p-3 text-sm text-foreground">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-indigo-soft">
                    {point.label}
                  </span>
                  <span className="mt-1 block">{point.text}</span>
                </li>
              ))}
            </ul>
            {audit.advice.note && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Bot className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {audit.advice.note}
              </p>
            )}
          </aside>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Hors du score : les liens reçus d’autres sites (relevé partiel, à titre indicatif), vos positions dans Google
        (mesurées à la demande dans Positionnement) et la force de vos concurrents. Un bon score améliore votre site,
        il ne garantit pas une place en première page.
      </p>

      <PageInspectionSheet />
    </div>
  )
}

/** Popularité du site (hors score) : domaines référents relevés pendant le crawl, et évolution depuis l'audit précédent */
function PopularityCard({ projectId, report }: { projectId: string; report?: BacklinkReport }) {
  const summary = report?.status === 'DONE' ? backlinkSummary(report) : undefined
  return (
    <section aria-label="Popularité du site" className="glass-card rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
            <Link2 className="size-4 text-muted-foreground" aria-hidden="true" />
            Popularité du site
            <span className="rounded-full border border-shade-44 px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              Hors score
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary
              ? `Sites qui font un lien vers le vôtre, d’après l’exploration Common Crawl de ${releaseLabel(report?.release)}. Relevé partiel : les vrais totaux sont plus élevés.`
              : report
                ? report.message ?? 'Backlinks indisponibles pour cet audit.'
                : 'Audit lancé avant l’ajout des backlinks : relancez un audit pour les obtenir.'}
          </p>
        </div>
        <Link
          href={`/projets/${projectId}/backlinks`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-ink hover:underline"
        >
          Voir les backlinks
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      {summary && report && (
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-inset p-3">
            <dt className="text-xs text-muted-foreground">Domaines référents</dt>
            <dd className="text-2xl font-extrabold text-foreground">{summary.domains}</dd>
          </div>
          <div className="rounded-xl bg-inset p-3">
            <dt className="text-xs text-muted-foreground">Liens vérifiés</dt>
            <dd className="text-2xl font-extrabold text-foreground">
              {summary.found} <span className="text-sm font-normal text-muted-foreground">sur {summary.verified} domaines lus</span>
            </dd>
          </div>
          <div className="rounded-xl bg-inset p-3">
            <dt className="text-xs text-muted-foreground">Depuis l’audit précédent</dt>
            {report.changes ? (
              <dd className="text-2xl font-extrabold text-foreground">
                <span className="text-green-soft">+{report.changes.added.length}</span>{' '}
                <span className="text-sky-soft">−{report.changes.lost.length}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  domaines gagnés et perdus depuis le {new Date(report.changes.previousDate).toLocaleDateString('fr-FR')}
                </span>
              </dd>
            ) : (
              <dd className="text-sm text-muted-foreground">Premier relevé : l’évolution s’affichera au prochain audit.</dd>
            )}
          </div>
        </dl>
      )}
    </section>
  )
}

function PillarCard({
  href,
  icon,
  title,
  score,
  caption,
}: {
  href: string
  icon: ReactNode
  title: string
  score: number | null
  caption: string
}) {
  const tone = score === null ? null : scoreTone(score)

  return (
    <Link
      href={href}
      className="group flex flex-col items-center glass-card glass-lift rounded-2xl border p-5 text-center hover:border-primary/50"
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground group-hover:text-primary-ink">{icon}</span>
        {title}
      </span>
      <div className="mt-4">
        {score !== null && tone ? (
          <CircularGauge score={score} size={112} strokeWidth={12} accentColor={tone.color} displayFormat="fraction" />
        ) : (
          <LockedScore label="Verrouillé : sélectionnez vos pages piliers" size={112} />
        )}
      </div>
      {tone && (
        <span className="mt-3 text-xs font-semibold" style={{ color: tone.textColor }}>
          {tone.label}
        </span>
      )}
      <span className="mt-1 text-xs text-muted-foreground">{caption}</span>
    </Link>
  )
}

function IssueTile({
  href,
  color,
  count,
  label,
  hint,
}: {
  href: string
  color: string
  count: number
  label: string
  hint: string
}) {
  return (
    <Link
      href={href}
      className="glass-card glass-lift group relative flex items-center justify-between overflow-hidden rounded-2xl border p-5 hover:border-foreground/20"
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="pl-2">
        <span className="block text-4xl font-extrabold tracking-tight text-foreground">{count}</span>
        <span className="mt-1 block text-sm font-semibold text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </div>
      <ArrowUpRight
        className="size-5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        style={{ color }}
        strokeWidth={2.5}
        aria-hidden="true"
      />
    </Link>
  )
}

function LockedScore({ label, size }: { label: string; size: number }) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      <div
        className="flex items-center justify-center rounded-full border-[10px] border-shade-3a text-muted-foreground"
        style={{ width: size, height: size }}
      >
        <Lock className="size-8" aria-hidden="true" />
      </div>
      <span className="mt-4 max-w-[200px] text-xs text-muted-foreground sm:text-sm">{label}</span>
    </div>
  )
}
