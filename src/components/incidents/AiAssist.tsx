import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatDateTime } from '../../lib/formatDate'
import type { AiSuggestion, ExtractableField } from '../../schemas/incident'
import { buildRedactionPreview, type PreviewSegment, type RedactionPreview } from '../../services/ai/preview'
import type { ExtractionFailure, IncidentExtractor } from '../../services/ai/types'
import { reviewableSuggestions } from '../../services/incidentDrafts'
import { en, format } from '../../strings/en'
import { Alert, Badge, Button } from '../ui'

const a = en.ai

function Segments({ segments }: { segments: readonly PreviewSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'text' ? (
          <span key={i}>{s.text}</span>
        ) : (
          // The placeholder is what is sent; the hidden text names what was removed.
          <mark key={i} className="rounded bg-amber-200 px-1 font-mono text-amber-950">
            [{s.placeholder}]<span className="sr-only"> ({a.removed[s.placeholder]})</span>
          </mark>
        ),
      )}
    </>
  )
}

function Panel({ title, children, labelId }: { title: string; children: ReactNode; labelId: string }) {
  return (
    <section aria-labelledby={labelId} className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
      <h2 id={labelId} className="text-lg font-semibold text-slate-900">
        {title}
      </h2>
      {children}
    </section>
  )
}

interface AiPreviewProps {
  preview: RedactionPreview
  onSend(): void
  onEditFirst(): void
  onCancel(): void
}

/** Shows exactly the redacted text that would be sent, before any AI call (R4.9). */
export function AiPreview({ preview, onSend, onEditFirst, onCancel }: AiPreviewProps) {
  return (
    <Panel title={a.previewTitle} labelId="ai-preview-title">
      {preview.removedCount > 0 && <p className="text-slate-800">{a.previewIntro}</p>}
      <div data-testid="ai-preview-text" className="flex flex-col gap-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 text-slate-900">
        {preview.waterPointName && (
          <p>
            <span className="font-medium">{a.previewWaterPoint}</span>{' '}
            <Segments segments={preview.waterPointName} />
          </p>
        )}
        <p>
          <span className="font-medium">{a.previewReport}</span>{' '}
          <Segments segments={preview.description} />
        </p>
      </div>
      <Alert tone="warning">{a.previewWarning}</Alert>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSend}>{a.send}</Button>
        <Button variant="secondary" onClick={onEditFirst}>
          {a.editFirst}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {a.cancel}
        </Button>
      </div>
    </Panel>
  )
}

export function AiUnavailable({ reason }: { reason: ExtractionFailure }) {
  return (
    <Alert tone="warning" title={a.unavailableTitle}>
      {a.unavailable[reason]}
    </Alert>
  )
}

export interface AiProposal {
  field: ExtractableField
  label: string
  value: string
}

interface AiReviewProps {
  suggestion: AiSuggestion
  proposals: readonly AiProposal[]
  /** Some suggested fields were left alone because the reporter already set them. */
  keptYours: boolean
  onUse(field: ExtractableField): void
  onUseAndEdit(field: ExtractableField): void
  onIgnore(field: ExtractableField): void
}

/** Suggestions as proposals; nothing is applied until the reporter chooses "Use" (R4.4). */
export function AiReview({ suggestion, proposals, keptYours, onUse, onUseAndEdit, onIgnore }: AiReviewProps) {
  return (
    <Panel title={a.reviewTitle} labelId="ai-review-title">
      <Badge tone="info" icon={<Sparkles className="size-4" />} className="self-start">
        {a.source[suggestion.inferenceSource]}
      </Badge>
      <p className="text-slate-800">{a.reviewIntro}</p>
      {proposals.length === 0 ? (
        <p className="text-slate-800">{a.none}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {proposals.map((p) => (
            <li key={p.field} className="flex flex-col gap-2 rounded border border-slate-200 p-3">
              <p>
                <span className="font-medium">{p.label}:</span> {p.value}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => onUse(p.field)} aria-label={`${a.use}: ${p.label}`}>
                  {a.use}
                </Button>
                <Button variant="secondary" onClick={() => onUseAndEdit(p.field)} aria-label={`${a.useAndEdit}: ${p.label}`}>
                  {a.useAndEdit}
                </Button>
                <Button variant="ghost" onClick={() => onIgnore(p.field)} aria-label={`${a.ignore}: ${p.label}`}>
                  {a.ignore}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {keptYours && <p className="text-sm text-slate-700">{a.keptYours}</p>}
    </Panel>
  )
}

type View =
  | { kind: 'closed' }
  | { kind: 'needsDescription' }
  | { kind: 'preview' }
  | { kind: 'sending' }
  | { kind: 'failed'; reason: ExtractionFailure }
  | { kind: 'review'; suggestion: AiSuggestion; keptYours: boolean }

type Suggested = AiSuggestion['suggested']

const valueLabel = (field: ExtractableField, s: Suggested): string => {
  switch (field) {
    case 'incidentType':
      return s.incidentType ? en.incidentTypes[s.incidentType] : ''
    case 'severity':
      return s.severity ? en.severities[s.severity] : ''
    case 'occurredAt':
      return s.occurredAt ? formatDateTime(s.occurredAt) : ''
    case 'locationNote':
      return s.locationNote ?? ''
  }
}

interface AiAssistProps {
  extractor: IncidentExtractor
  /** Current description, as typed. */
  description: string
  waterPointName: string | null
  /** Fields the reporter has set or changed; suggestions never replace them (R4.5). */
  confirmed: readonly ExtractableField[]
  /** A validated suggestion arrived; the form keeps it as provenance for saving. */
  onSuggestion(suggestion: AiSuggestion): void
  /** The reporter accepted a suggested value. */
  onUse(field: ExtractableField, suggested: Suggested, thenEdit: boolean): void
  /** Move focus to the description field. */
  onEditDescription(): void
}

/**
 * Optional AI help for the report form (T6.4b, T6.5). The flow is: preview
 * of the redacted text, explicit "Send", then per-field review. Any failure
 * leaves the manual form as it is (R4.7).
 */
export function AiAssist({ extractor, description, waterPointName, confirmed, onSuggestion, onUse, onEditDescription }: AiAssistProps) {
  const [view, setView] = useState<View>({ kind: 'closed' })
  const [ignored, setIgnored] = useState<ExtractableField[]>([])
  const [announcement, setAnnouncement] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const open = () => {
    setAnnouncement('')
    setView(description.trim() ? { kind: 'preview' } : { kind: 'needsDescription' })
  }

  const send = () => {
    const confirmedAtSend = [...confirmed]
    setView({ kind: 'sending' })
    setAnnouncement(a.working)
    // Called directly from the click: the on-device model needs a user interaction.
    void extractor.extract({ description, waterPointName }).then((result) => {
      if (!mounted.current) return
      if (!result.ok) {
        setAnnouncement('')
        setView({ kind: 'failed', reason: result.reason })
        return
      }
      onSuggestion(result.suggestion)
      setIgnored([])
      const suggestedFields = reviewableSuggestions(result.suggestion.suggested, [])
      const keptYours = suggestedFields.some((f) => confirmedAtSend.includes(f))
      const count = reviewableSuggestions(result.suggestion.suggested, confirmedAtSend).length
      setAnnouncement(count === 0 ? a.none : a.reviewReady)
      setView({ kind: 'review', suggestion: result.suggestion, keptYours })
    })
  }

  const label = (field: ExtractableField) => en.reports.fields[field]

  let body: ReactNode = null
  switch (view.kind) {
    case 'needsDescription':
      body = <p className="text-slate-800">{a.needsDescription}</p>
      break
    case 'preview':
      body = !description.trim() ? (
        <p className="text-slate-800">{a.needsDescription}</p>
      ) : (
        <AiPreview
          preview={buildRedactionPreview(description, waterPointName)}
          onSend={send}
          onEditFirst={onEditDescription}
          onCancel={() => setView({ kind: 'closed' })}
        />
      )
      break
    case 'failed':
      body = <AiUnavailable reason={view.reason} />
      break
    case 'review': {
      const s = view.suggestion.suggested
      const proposals = reviewableSuggestions(s, [...confirmed, ...ignored]).map((field) => ({
        field,
        label: label(field),
        value: valueLabel(field, s),
      }))
      const use = (field: ExtractableField, thenEdit: boolean) => {
        onUse(field, s, thenEdit)
        setAnnouncement(format(a.used, { field: label(field) }))
      }
      body = (
        <AiReview
          suggestion={view.suggestion}
          proposals={proposals}
          keptYours={view.keptYours}
          onUse={(field) => use(field, false)}
          onUseAndEdit={(field) => use(field, true)}
          onIgnore={(field) => setIgnored((list) => [...list, field])}
        />
      )
      break
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Button
          variant="secondary"
          className="self-start"
          onClick={open}
          loading={view.kind === 'sending'}
          disabled={view.kind === 'preview'}
        >
          <Sparkles aria-hidden="true" className="size-5" />
          {a.suggest}
        </Button>
        <p className="text-sm text-slate-700">{a.suggestHelp}</p>
      </div>
      <p role="status" className="text-slate-800 empty:hidden">
        {announcement}
      </p>
      {body}
    </div>
  )
}