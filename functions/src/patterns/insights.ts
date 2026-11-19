/**
 * Validation and filtering of model output for pattern analysis (T8.2,
 * design 5B step 7). The model's JSON is untrusted. Each insight is checked
 * on its own and dropped if any check fails, so one bad insight does not
 * discard the others (R9.4, R9.5, R4.10).
 */
import { z } from 'zod'
import { containsPersonalData } from '../privacy.js'

export const INSIGHT_KINDS = ['observation', 'hypothesis'] as const
export const CONFIDENCES = ['low', 'medium', 'high'] as const

const text = (max: number) => z.string().trim().min(1).max(max)
const isoDateTime = z.iso.datetime({ offset: true })

/**
 * One insight as the model returns it. Unknown keys (for example "cause" or
 * "diagnosis") are stripped; there is no field for a verified cause.
 */
const modelInsightSchema = z.object({
  kind: z.enum(INSIGHT_KINDS),
  title: text(120),
  statement: text(1000),
  supportingIncidentIds: z.array(z.string().min(1).max(128)).min(1).max(100),
  affectedWaterPointIds: z.array(z.string().min(1).max(128)).min(1).max(50),
  period: z.object({ from: isoDateTime, to: isoDateTime }),
  limitations: z.array(text(500)).min(1).max(10),
  confidence: z.enum(CONFIDENCES),
})

/** Top level. Insights are validated one by one below. */
const modelOutputSchema = z.object({
  insights: z.array(z.unknown()).max(20),
  limitations: z.array(z.unknown()).max(10),
})

export interface Period {
  from: Date
  to: Date
}

/** An insight that passed every check. Periods are Dates (stored as Timestamps). */
export interface CheckedInsight {
  kind: (typeof INSIGHT_KINDS)[number]
  title: string
  statement: string
  supportingIncidentIds: string[]
  affectedWaterPointIds: string[]
  period: Period
  limitations: string[]
  confidence: (typeof CONFIDENCES)[number]
}

export type DropReason = 'schema' | 'foreignIncident' | 'unlinkedWaterPoint' | 'period' | 'personalData' | 'confirmedCause'

export interface InsightContext {
  /** Incident ID -> its water point, for the analyzed incidents only. */
  incidentWaterPoints: ReadonlyMap<string, string>
  period: Period
}

export interface FilterResult {
  insights: CheckedInsight[]
  /** Analysis-level limitations from the model that passed the text checks. */
  modelLimitations: string[]
  dropped: Record<DropReason, number>
}

/**
 * Statements that present a cause or diagnosis as established. Hypotheses must
 * use tentative wording ("may be caused by"), which these do not match.
 */
const CONFIRMED_CAUSE = [
  /\bconfirmed\b/i,
  /\bdiagnos(?:ed|is|es)\b/i,
  /\bthe (?:root )?cause (?:is|was|has been)\b/i,
  /\b(?:is|was|were|are|has been|have been) (?:definitely |clearly )?caused by\b/i,
  /\b(?:proven|proved)\b/i,
  /\bdefinitely\b/i,
]

/** Negated claims ("No cause has been confirmed", "not yet diagnosed") are honest and are removed before checking. */
const NEGATED = /\b(?:no|not|never)\b[^.;:!?]*?\b(?:confirmed|diagnos(?:ed|is|es)|proven|proved)\b/gi

export const assertsConfirmedCause = (value: string): boolean => {
  const affirmative = value.replace(NEGATED, ' ')
  return CONFIRMED_CAUSE.some((p) => p.test(affirmative))
}

const unique = (values: readonly string[]) => [...new Set(values)]

function check(raw: unknown, ctx: InsightContext): CheckedInsight | DropReason {
  const parsed = modelInsightSchema.safeParse(raw)
  if (!parsed.success) return 'schema'
  const insight = parsed.data
  const texts = [insight.title, insight.statement, ...insight.limitations]
  if (texts.some(containsPersonalData)) return 'personalData'
  if (texts.some(assertsConfirmedCause)) return 'confirmedCause'

  const incidentIds = unique(insight.supportingIncidentIds)
  if (!incidentIds.every((id) => ctx.incidentWaterPoints.has(id))) return 'foreignIncident'
  // Every affected water point must belong to at least one cited incident.
  const linked = new Set(incidentIds.map((id) => ctx.incidentWaterPoints.get(id)))
  const waterPointIds = unique(insight.affectedWaterPointIds)
  if (!waterPointIds.every((id) => linked.has(id))) return 'unlinkedWaterPoint'

  const from = new Date(insight.period.from)
  const to = new Date(insight.period.to)
  if (from > to || from < ctx.period.from || to > ctx.period.to) return 'period'

  return {
    kind: insight.kind,
    title: insight.title,
    statement: insight.statement,
    supportingIncidentIds: incidentIds,
    affectedWaterPointIds: waterPointIds,
    period: { from, to },
    limitations: insight.limitations,
    confidence: insight.confidence,
  }
}

/**
 * Parses the model's text and keeps only insights that pass every check.
 * Returns null when the text is not valid JSON of the expected shape.
 */
export function filterModelOutput(rawText: string, ctx: InsightContext): FilterResult | null {
  let json: unknown
  try {
    json = JSON.parse(rawText)
  } catch {
    return null
  }
  const parsed = modelOutputSchema.safeParse(json)
  if (!parsed.success) return null

  const dropped: Record<DropReason, number> = { schema: 0, foreignIncident: 0, unlinkedWaterPoint: 0, period: 0, personalData: 0, confirmedCause: 0 }
  const insights: CheckedInsight[] = []
  for (const raw of parsed.data.insights) {
    const result = check(raw, ctx)
    if (typeof result === 'string') dropped[result] += 1
    else insights.push(result)
  }
  const modelLimitations = parsed.data.limitations
    .flatMap((value) => {
      const limitation = text(500).safeParse(value)
      return limitation.success ? [limitation.data] : []
    })
    .filter((value) => !containsPersonalData(value) && !assertsConfirmedCause(value))
    .slice(0, 5)
  return { insights, modelLimitations, dropped }
}

/** JSON Schema for the model's structured output. Hand-written so it uses only keywords the API supports. */
export const MODEL_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insights', 'limitations'],
  properties: {
    insights: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'statement', 'supportingIncidentIds', 'affectedWaterPointIds', 'period', 'limitations', 'confidence'],
        properties: {
          kind: { type: 'string', enum: [...INSIGHT_KINDS] },
          title: { type: 'string' },
          statement: { type: 'string' },
          supportingIncidentIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          affectedWaterPointIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          period: {
            type: 'object',
            additionalProperties: false,
            required: ['from', 'to'],
            properties: { from: { type: 'string' }, to: { type: 'string' } },
          },
          limitations: { type: 'array', items: { type: 'string' }, minItems: 1 },
          confidence: { type: 'string', enum: [...CONFIDENCES] },
        },
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
  },
} as const
