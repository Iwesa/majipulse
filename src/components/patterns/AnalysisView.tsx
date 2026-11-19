import { Eye, Lightbulb } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDateTime } from '../../lib/formatDate'
import type { Insight } from '../../schemas/patternAnalysis'
import type { PatternAnalysisRecord } from '../../services/patterns'
import { en, format } from '../../strings/en'
import { Alert, Badge } from '../ui'
import { DemoBadge } from '../waterPoints/WaterPointBits'
import { incidentCountLabel, periodLabel } from './labels'

const p = en.patterns


/** Observation or hypothesis, always as text with an icon, never color alone (R9.4). */
export function InsightKindBadge({ kind }: { kind: Insight['kind'] }) {
  return kind === 'observation' ? (
    <Badge tone="info" icon={<Eye className="size-4" />}>
      {p.observation}
    </Badge>
  ) : (
    <Badge tone="warning" icon={<Lightbulb className="size-4" />}>
      {p.hypothesis}
    </Badge>
  )
}

interface InsightCardProps {
  insight: Insight
  index: number
  nameOf(waterPointId: string): string
  /** Position of an incident in the analysis, for readable link names. */
  incidentNumber(incidentId: string): number
}

function InsightCard({ insight, index, nameOf, incidentNumber }: InsightCardProps) {
  const headingId = `insight-${index}`
  return (
    <li>
      <article aria-labelledby={headingId} className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
        <div className="flex flex-col gap-2">
          <InsightKindBadge kind={insight.kind} />
          <h3 id={headingId} className="text-lg font-semibold text-slate-900">
            {insight.title}
          </h3>
          <p className="text-sm text-slate-700">{insight.kind === 'observation' ? p.observationHelp : p.hypothesisHelp}</p>
        </div>
        <p className="text-slate-900">{insight.statement}</p>
        <p className="text-sm text-slate-700">{format(p.confidence, { level: p.confidenceLevels[insight.confidence] })}</p>
        <dl className="grid gap-2 sm:grid-cols-[12rem_1fr]">
          <dt className="font-medium">{p.insightPeriod}</dt>
          <dd>{periodLabel(insight.period)}</dd>
          <dt className="font-medium">{p.supportingIncidents}</dt>
          <dd>
            <ul className="flex flex-wrap gap-2">
              {insight.supportingIncidentIds.map((id) => (
                <li key={id}>
                  <Link to={`/incidents/${id}`} className="font-medium text-sky-900 underline">
                    {format(p.incidentLink, { n: String(incidentNumber(id)) })}
                  </Link>
                </li>
              ))}
            </ul>
          </dd>
          <dt className="font-medium">{p.affectedWaterPoints}</dt>
          <dd>{insight.affectedWaterPointIds.map(nameOf).join(', ')}</dd>
          <dt className="font-medium">{p.insightLimitations}</dt>
          <dd>
            <ul className="list-disc pl-5">
              {insight.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </article>
    </li>
  )
}

/** A saved analysis with its period, scope, limitations, and insights (T8.4, AC11). */
export function AnalysisView({ analysis, nameOf }: { analysis: PatternAnalysisRecord; nameOf(waterPointId: string): string }) {
  const numbers = new Map(analysis.analyzedIncidentIds.map((id, i) => [id, i + 1]))
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-2 rounded-md border border-slate-300 bg-white p-4 sm:grid-cols-[12rem_1fr]">
        <dt className="font-medium">{p.period}</dt>
        <dd>{periodLabel(analysis.period)}</dd>
        <dt className="font-medium">{p.scope}</dt>
        <dd>{analysis.scope.waterPointId ? format(p.forPoint, { name: nameOf(analysis.scope.waterPointId) }) : p.allPoints}</dd>
        <dt className="font-medium">{p.incidentCount}</dt>
        <dd>{incidentCountLabel(analysis.analyzedIncidentCount)}</dd>
        <dt className="font-medium">{p.createdAt}</dt>
        <dd>{formatDateTime(analysis.createdAt)}</dd>
        {!analysis.insufficientData && (
          <>
            <dt className="font-medium">{p.model}</dt>
            <dd className="font-mono text-sm">{analysis.model}</dd>
          </>
        )}
      </dl>
      {analysis.demo && <DemoBadge />}
      {analysis.insufficientData && (
        <Alert tone="info" title={p.insufficientTitle}>
          {p.insufficient}
        </Alert>
      )}
      <section aria-labelledby="analysis-limitations" className="flex flex-col gap-2">
        <h2 id="analysis-limitations" className="text-xl font-semibold">
          {p.limitationsTitle}
        </h2>
        <ul className="list-disc pl-5 text-slate-800">
          {analysis.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>
      {!analysis.insufficientData && (
        <section aria-labelledby="analysis-insights" className="flex flex-col gap-3">
          <h2 id="analysis-insights" className="text-xl font-semibold">
            {p.insightsTitle}
          </h2>
          {analysis.insights.length === 0 ? (
            <p className="text-slate-800">{p.noInsights}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {analysis.insights.map((insight, i) => (
                <InsightCard key={i} insight={insight} index={i} nameOf={nameOf} incidentNumber={(id) => numbers.get(id) ?? 0} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
