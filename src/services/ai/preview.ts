/**
 * What the reporter sees before AI suggestions are requested (T6.4b, R4.9):
 * the same redacted text the prompt builder sends, split so removed parts
 * can be marked. Built from the redacted text only, so original values never
 * reach the preview.
 */
import { PLACEHOLDER_PATTERN, redact } from '../../../shared/privacy/redact'

export type PlaceholderName = 'PHONE' | 'EMAIL' | 'ID' | 'NAME' | 'NUMBER'

export type PreviewSegment = { kind: 'text'; text: string } | { kind: 'removed'; placeholder: PlaceholderName }

export interface RedactionPreview {
  description: PreviewSegment[]
  waterPointName: PreviewSegment[] | null
  removedCount: number
}

function segments(redacted: string): PreviewSegment[] {
  const out: PreviewSegment[] = []
  let cursor = 0
  for (const m of redacted.matchAll(new RegExp(PLACEHOLDER_PATTERN.source, 'g'))) {
    if (m.index > cursor) out.push({ kind: 'text', text: redacted.slice(cursor, m.index) })
    out.push({ kind: 'removed', placeholder: m[0].slice(1, -1) as PlaceholderName })
    cursor = m.index + m[0].length
  }
  if (cursor < redacted.length) out.push({ kind: 'text', text: redacted.slice(cursor) })
  return out
}

export function buildRedactionPreview(description: string, waterPointName: string | null): RedactionPreview {
  const d = redact(description)
  const w = waterPointName ? redact(waterPointName) : null
  return {
    description: segments(d.text),
    waterPointName: w ? segments(w.text) : null,
    removedCount: d.findings.length + (w?.findings.length ?? 0),
  }
}
