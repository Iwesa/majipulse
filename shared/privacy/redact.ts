/**
 * Best-effort removal of personal information from free text before any AI
 * model sees it (design "Privacy preprocessing", R4.8). Dependency-free and
 * free of relative imports, so both the Vite app and the Cloud Functions
 * package compile it.
 *
 * Never log the input or the removed values. Only counts per kind may be
 * logged (see `countByKind`).
 *
 * Known gaps (not reliably detectable): names without a cue or a title,
 * nicknames, household descriptions, addresses. The reporter preview and
 * warning cover these.
 */

export type RedactionKind = 'phone' | 'email' | 'id' | 'name' | 'number'

export interface RedactionFinding {
  kind: RedactionKind
  /** Offsets in the original text. */
  start: number
  end: number
}

export interface RedactionResult {
  text: string
  findings: RedactionFinding[]
}

export const PLACEHOLDERS: Record<RedactionKind, string> = {
  phone: '[PHONE]',
  email: '[EMAIL]',
  id: '[ID]',
  name: '[NAME]',
  number: '[NUMBER]',
}

/** Matches any placeholder, for marking them in previews and rejecting echoes. */
export const PLACEHOLDER_PATTERN = /\[(?:PHONE|EMAIL|ID|NAME|NUMBER)\]/g

/** Kenyan numbers: 0, 254, +254 or (+254), then a 7 or 1 prefix and 8 more digits, with single separators. */
const PHONE = /(?<![\w+])(?:\(\+254\)[\s.-]?|\+254[\s.-]?|254[\s.-]?|0)[17](?:[\s.-]?\d){8}(?!\d)/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const SPELLED_EMAIL = /(?<![\w@])[A-Za-z0-9._%+-]+\s+at\s+[A-Za-z0-9-]+(?:\s+dot\s+[A-Za-z]{2,})+(?![\w])/gi
/** 3+ digit groups joined by single spaces or dashes. Dates and times have shorter groups, so they never match. */
const DIGIT_GROUPS = /(?<![\w])\d{3,}(?:[ -]\d{3,})*(?![\w])/g
// No `i` flag: with `iu`, \p{Lu} would also match lowercase ("Mama mboga" must stay).
const TITLED_NAME = /(?<![\p{L}])(?:[Mm][Rr][Ss]?|[Mm][Ss]|[Dd][Rr]|[Mm]zee|MZEE|[Mm]ama|MAMA|[Bb]aba|BABA)\.?\s+(\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?)/gu

const NAME_CUES = ['my name is', 'i am called', "i'm called", 'call me', 'jina langu ni', 'naitwa', 'contact', 'name:']
const ID_CUES = ['national id', 'id number', 'id no.', 'id no', 'kitambulisho', 'passport', 'id']

const cueRegex = (cues: string[]) =>
  new RegExp(`(?<![\\p{L}])(?:${cues.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}])`, 'giu')
const NAME_CUE = cueRegex(NAME_CUES)
const ID_CUE = cueRegex(ID_CUES)

/** Words that end a name after a cue ("my name is Amina and ..."). English and Swahili. */
const STOP_WORDS = new Set([
  'and', 'the', 'a', 'an', 'is', 'in', 'at', 'on', 'from', 'since', 'for', 'to', 'of', 'by', 'with', 'about', 'please',
  'na', 'ni', 'kwa', 'wa', 'ya', 'la', 'za', 'katika', 'hapa', 'tafadhali',
])
const WORD = /^(\p{L}[\p{L}'’-]*)/u

function addSpan(spans: RedactionFinding[], span: RedactionFinding): void {
  if (span.end <= span.start) return
  if (spans.some((s) => span.start < s.end && s.start < span.end)) return
  spans.push(span)
}

function matchAll(text: string, pattern: RegExp, kind: RedactionKind, spans: RedactionFinding[], accept: (m: RegExpExecArray) => boolean = () => true) {
  pattern.lastIndex = 0
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (accept(m)) addSpan(spans, { kind, start: m.index, end: m.index + m[0].length })
  }
}

const digitCount = (s: string) => (s.match(/\d/g) ?? []).length

/** Up to 3 words after a name cue, stopping at stop words, punctuation, or earlier findings. */
function nameAfter(text: string, from: number, spans: RedactionFinding[]): { start: number; end: number } | null {
  let i = from
  while (text[i] === ' ' || text[i] === ':') i += 1
  const start = i
  let end = i
  for (let words = 0; words < 3; words += 1) {
    if (spans.some((s) => i >= s.start && i < s.end)) break
    const m = WORD.exec(text.slice(i))
    if (!m) break
    const word = m[1]
    if (STOP_WORDS.has(word.toLowerCase())) break
    i += word.length
    // An initial such as "J." stays part of the name.
    if (word.length === 1 && text[i] === '.') i += 1
    end = i
    if (text[i] !== ' ') break
    i += 1
  }
  return end > start ? { start, end } : null
}

/** An ID token after an ID cue: optional "number"/"no."/"#"/":", then up to 2 letters and 3+ digits. */
function idAfter(text: string, from: number): { start: number; end: number } | null {
  const rest = text.slice(from)
  const m = /^\s*(?:(?:number|no\.?|#)\s*)?:?\s*([A-Za-z]{0,2}\d{3,})(?!\w)/i.exec(rest)
  if (!m) return null
  const start = from + m[0].length - m[1].length
  return { start, end: start + m[1].length }
}

export function redact(input: string): RedactionResult {
  const spans: RedactionFinding[] = []
  matchAll(input, EMAIL, 'email', spans)
  matchAll(input, SPELLED_EMAIL, 'email', spans)
  matchAll(input, PHONE, 'phone', spans)

  ID_CUE.lastIndex = 0
  for (let m = ID_CUE.exec(input); m; m = ID_CUE.exec(input)) {
    const token = idAfter(input, m.index + m[0].length)
    if (token) addSpan(spans, { kind: 'id', ...token })
  }
  NAME_CUE.lastIndex = 0
  for (let m = NAME_CUE.exec(input); m; m = NAME_CUE.exec(input)) {
    const name = nameAfter(input, m.index + m[0].length, spans)
    if (name) addSpan(spans, { kind: 'name', ...name })
  }
  TITLED_NAME.lastIndex = 0
  for (let m = TITLED_NAME.exec(input); m; m = TITLED_NAME.exec(input)) {
    const start = m.index + m[0].length - m[1].length
    addSpan(spans, { kind: 'name', start, end: start + m[1].length })
  }
  matchAll(input, DIGIT_GROUPS, 'number', spans, (m) => digitCount(m[0]) >= 9)

  spans.sort((a, b) => a.start - b.start)
  let text = ''
  let cursor = 0
  for (const span of spans) {
    text += input.slice(cursor, span.start) + PLACEHOLDERS[span.kind]
    cursor = span.end
  }
  text += input.slice(cursor)
  return { text, findings: spans }
}

/** True if text contains a placeholder or anything the redactor would remove. */
export function containsPersonalData(text: string): boolean {
  PLACEHOLDER_PATTERN.lastIndex = 0
  return PLACEHOLDER_PATTERN.test(text) || redact(text).findings.length > 0
}

/** Safe to log: how many items of each kind were removed, never the values. */
export function countByKind(findings: readonly RedactionFinding[]): Record<RedactionKind, number> {
  const counts: Record<RedactionKind, number> = { phone: 0, email: 0, id: 0, name: 0, number: 0 }
  for (const f of findings) counts[f.kind] += 1
  return counts
}
