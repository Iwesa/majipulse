/**
 * Validation of AI extraction output (T6.2). The model's text is untrusted:
 * it is parsed as JSON, checked with Zod, and then each field is checked
 * against the redacted description the model saw (grounding) and against the
 * personal-information detectors (R4.3, R4.6, R4.10).
 */
import { containsPersonalData } from '../../../shared/privacy/redact'
import { aiExtractionOutputSchema, type AiSuggestion, type ExtractableField } from '../../schemas/incident'

export type SuggestedValues = AiSuggestion['suggested']

export type ExtractionValidation =
  | { ok: true; suggested: SuggestedValues; dropped: ExtractableField[] }
  | { ok: false }

/** Lower case, punctuation removed, whitespace collapsed. Used for substring grounding. */
export function normalizeForGrounding(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const monthIndex = (word: string): number => {
  const w = word.toLowerCase()
  return MONTHS.findIndex((m) => w === m || (w.length >= 3 && m.startsWith(w)))
}

interface StatedDate {
  year: number | null
  month: number
  day: number
}

/**
 * Calendar dates written out in the text: `2026-03-12`, `12/03/2026`
 * (day first, as used in Kenya), `12 March [2026]`, `March 12[, 2026]`.
 * Relative phrases ("yesterday", "3 days") are not dates.
 */
export function statedDates(text: string): StatedDate[] {
  const dates: StatedDate[] = []
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) {
    dates.push({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) })
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?!\d)/g)) {
    dates.push({ year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) })
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?(?!\d)/g)) {
    const month = monthIndex(m[2])
    if (month >= 0) dates.push({ year: m[3] ? Number(m[3]) : null, month: month + 1, day: Number(m[1]) })
  }
  for (const m of text.matchAll(/(?<![A-Za-z])([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?!\d)/g)) {
    const month = monthIndex(m[1])
    if (month >= 0) dates.push({ year: m[3] ? Number(m[3]) : null, month: month + 1, day: Number(m[2]) })
  }
  return dates.filter((d) => d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31)
}

/**
 * The suggested time is kept only if its calendar date (as written in the ISO
 * string) is a date the description states, and it is not in the future.
 * Without a stated year, only the current year is accepted.
 */
function occurredAtIsGrounded(iso: string, description: string, now: Date): boolean {
  if (Date.parse(iso) > now.getTime()) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(iso)
  if (!m) return false
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return statedDates(description).some(
    (d) => d.month === month && d.day === day && (d.year ?? now.getFullYear()) === year,
  )
}

function locationIsGrounded(note: string, description: string): boolean {
  const needle = normalizeForGrounding(note)
  return needle.length > 0 && ` ${normalizeForGrounding(description)} `.includes(` ${needle} `)
}

/**
 * @param raw the model's response text
 * @param redactedDescription the exact redacted text the model received
 */
export function validateExtraction(raw: string, redactedDescription: string, now: Date): ExtractionValidation {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false }
  }
  const parsed = aiExtractionOutputSchema.safeParse(json)
  if (!parsed.success) return { ok: false }

  const suggested: SuggestedValues = { ...parsed.data }
  const dropped: ExtractableField[] = []
  const drop = (field: ExtractableField) => {
    suggested[field] = null
    dropped.push(field)
  }

  if (suggested.occurredAt !== null) {
    if (containsPersonalData(suggested.occurredAt) || !occurredAtIsGrounded(suggested.occurredAt, redactedDescription, now)) {
      drop('occurredAt')
    }
  }
  if (suggested.locationNote !== null) {
    if (containsPersonalData(suggested.locationNote) || !locationIsGrounded(suggested.locationNote, redactedDescription)) {
      drop('locationNote')
    }
  }
  return { ok: true, suggested, dropped }
}
