import { Sparkles } from 'lucide-react'
import { formatDateTime } from '../../lib/formatDate'
import type { AiSuggestion, ExtractableField } from '../../schemas/incident'
import { en } from '../../strings/en'
import { Alert, Badge } from '../ui'

const FIELDS: ExtractableField[] = ['incidentType', 'severity', 'occurredAt', 'locationNote']

function suggestedValue(field: ExtractableField, s: AiSuggestion['suggested']): string | null {
  switch (field) {
    case 'incidentType':
      return s.incidentType ? en.incidentTypes[s.incidentType] : null
    case 'severity':
      return s.severity ? en.severities[s.severity] : null
    case 'occurredAt':
      return s.occurredAt ? formatDateTime(s.occurredAt) : null
    case 'locationNote':
      return s.locationNote
  }
}

/**
 * The stored AI suggestion for an incident, kept apart from the values the
 * reporter confirmed, with its provenance as recorded (R4.2). Always labeled
 * as unverified (ai-safety: "Truthfulness").
 */
export function AiProvenance({ ai }: { ai: AiSuggestion | undefined }) {
  const t = en.incidents
  return (
    <section aria-labelledby="ai-provenance-title" className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
      <h2 id="ai-provenance-title" className="text-lg font-semibold text-slate-900">
        {t.aiTitle}
      </h2>
      {!ai ? (
        <p className="text-slate-800">{t.aiNone}</p>
      ) : (
        <>
          <Alert tone="info">{t.aiDisclaimer}</Alert>
          <dl className="grid gap-2 sm:grid-cols-[12rem_1fr]">
            <dt className="font-medium">{t.aiSource}</dt>
            <dd>
              <Badge tone="info" icon={<Sparkles className="size-4" />}>
                {en.ai.source[ai.inferenceSource]}
              </Badge>
            </dd>
            <dt className="font-medium">{t.aiModel}</dt>
            <dd className="font-mono text-sm">{ai.model}</dd>
            <dt className="font-medium">{t.aiGeneratedAt}</dt>
            <dd>{formatDateTime(ai.generatedAt)}</dd>
            {FIELDS.map((field) => (
              <div key={field} className="contents">
                <dt className="font-medium">{en.reports.fields[field]}</dt>
                <dd>{suggestedValue(field, ai.suggested) ?? t.aiNoValue}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}
