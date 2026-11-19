/**
 * Cross-incident pattern analysis (T8.3, design 5B). Pure logic over ports:
 * index.ts wires it to the `analyzeIncidentPatterns` callable, tests use a
 * fake model and either in-memory or emulator-backed data ports.
 */
import { z } from 'zod'
import { uidSchema } from '../domain.js'
import type { MemberRecord } from '../ports.js'
import type { RedactionKind } from '../privacy.js'
import { filterModelOutput, MODEL_RESPONSE_SCHEMA, type CheckedInsight, type DropReason, type Period } from './insights.js'
import { buildPatternPrompt, type AnalyzedIncident } from './prompt.js'

export const MIN_INCIDENTS = 3
export const MAX_INCIDENTS = 200
export const MAX_PERIOD_DAYS = 366
const DAY = 86_400_000

export type PatternErrorCode = 'unauthenticated' | 'permission-denied' | 'invalid-argument' | 'not-found' | 'unavailable' | 'internal'

/** Errors with plain-language messages that are safe to return to the caller. */
export class PatternError extends Error {
  readonly code: PatternErrorCode
  constructor(code: PatternErrorCode, message: string) {
    super(message)
    this.name = 'PatternError'
    this.code = code
  }
}

/** The model could not be called (not configured, emulator, network, quota). */
export class ModelUnavailableError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ModelUnavailableError'
  }
}

export interface ModelRequest {
  systemInstruction: string
  prompt: string
  responseJsonSchema: typeof MODEL_RESPONSE_SCHEMA
}

/** The only way analysis reaches a model. Returns the model's response text. */
export interface PatternModel {
  readonly name: string
  generate(request: ModelRequest): Promise<string>
}

/** What is stored in `patternAnalyses/{id}`. Dates become Timestamps; createdAt is set by the adapter. */
export interface AnalysisRecord {
  organizationId: string
  requestedBy: string
  demo: boolean
  model: string
  period: Period
  scope: { waterPointId?: string }
  analyzedIncidentIds: string[]
  analyzedIncidentCount: number
  insufficientData: boolean
  limitations: string[]
  insights: CheckedInsight[]
}

export interface AnalysisDataPort {
  getMember(uid: string): Promise<MemberRecord | null>
  organizationIsDemo(organizationId: string): Promise<boolean>
  /** The organization's water points: ID -> name. */
  waterPointNames(organizationId: string): Promise<Map<string, string>>
  /** Newest first, at most `limit`, reported within the period, optionally for one water point. */
  listIncidents(organizationId: string, period: Period, waterPointId: string | undefined, limit: number): Promise<AnalyzedIncident[]>
  /** Returns the new document ID. */
  saveAnalysis(record: AnalysisRecord): Promise<string>
}

export interface AnalysisLog {
  /** Counts only. Never text, IDs of people, or tokens. */
  info(message: string, counts: Record<string, number>): void
}

export interface PatternPorts {
  data: AnalysisDataPort
  model: PatternModel
  now(): Date
  log: AnalysisLog
}

export interface Caller {
  uid: string
  token: Readonly<Record<string, unknown>>
}

export const analyzeInputSchema = z.strictObject({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  waterPointId: z.string().min(1).max(128).refine((id) => !id.includes('/')).optional(),
})

export interface AnalyzeResult {
  analysisId: string
  insufficientData: boolean
  analyzedIncidentCount: number
  insightCount: number
}

/** Active administrator or technician, by claims AND a matching member record (as the rules check). */
async function requireStaff(data: AnalysisDataPort, caller: Caller | null): Promise<{ uid: string; organizationId: string }> {
  if (!caller) throw new PatternError('unauthenticated', 'Sign in to run pattern analysis.')
  const { organizationId, role } = caller.token
  const denied = new PatternError('permission-denied', 'Only administrators and technicians can run pattern analysis.')
  if (typeof organizationId !== 'string' || (role !== 'administrator' && role !== 'technician')) throw denied
  if (!uidSchema.safeParse(caller.uid).success) throw denied
  const member = await data.getMember(caller.uid)
  if (!member || !member.active || member.organizationId !== organizationId || member.role !== role) throw denied
  return { uid: caller.uid, organizationId }
}

function parsePeriod(raw: unknown, now: Date): { period: Period; waterPointId: string | undefined } {
  const parsed = analyzeInputSchema.safeParse(raw)
  const invalid = new PatternError('invalid-argument', `Choose a period of up to ${MAX_PERIOD_DAYS} days that has already started.`)
  if (!parsed.success) throw invalid
  const from = new Date(parsed.data.from)
  const to = new Date(parsed.data.to)
  // A little clock skew between the device and the server is allowed.
  if (from >= to || from > now || to.getTime() > now.getTime() + 5 * 60_000 || to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY) throw invalid
  return { period: { from, to: to > now ? now : to }, waterPointId: parsed.data.waterPointId }
}

const day = (d: Date) => d.toISOString().slice(0, 10)

const DROP_NOTE: Record<DropReason, string> = {
  schema: 'were incomplete',
  foreignIncident: 'cited incidents outside this analysis',
  unlinkedWaterPoint: 'named water points not linked to the cited incidents',
  period: 'used a period outside the analysis period',
  personalData: 'contained personal information',
  confirmedCause: 'stated a cause as confirmed',
}

export async function analyzeIncidentPatterns(ports: PatternPorts, caller: Caller | null, rawInput: unknown): Promise<AnalyzeResult> {
  const { uid, organizationId } = await requireStaff(ports.data, caller)
  const now = ports.now()
  const { period, waterPointId } = parsePeriod(rawInput, now)

  const names = await ports.data.waterPointNames(organizationId)
  if (waterPointId !== undefined && !names.has(waterPointId)) {
    throw new PatternError('not-found', 'This water point does not exist in your organization.')
  }
  const incidents = await ports.data.listIncidents(organizationId, period, waterPointId, MAX_INCIDENTS)
  const demo = (await ports.data.organizationIsDemo(organizationId)) || incidents.some((i) => i.demo)
  const scope = waterPointId !== undefined ? { waterPointId } : {}
  const sample = `Based on ${incidents.length} incident report${incidents.length === 1 ? '' : 's'} from ${day(period.from)} to ${day(period.to)}${
    incidents.length >= MAX_INCIDENTS ? `; only the ${MAX_INCIDENTS} most recent were analyzed` : ''
  }.`
  const base = {
    organizationId,
    requestedBy: uid,
    demo,
    period,
    scope,
    analyzedIncidentIds: incidents.map((i) => i.id),
    analyzedIncidentCount: incidents.length,
  }

  // Too little data: store the result, no model call (R9.3).
  if (incidents.length < MIN_INCIDENTS) {
    const analysisId = await ports.data.saveAnalysis({
      ...base,
      model: 'none',
      insufficientData: true,
      limitations: [sample, `At least ${MIN_INCIDENTS} incident reports are needed. No AI analysis was run.`],
      insights: [],
    })
    ports.log.info('pattern analysis: insufficient data', { incidents: incidents.length })
    return { analysisId, insufficientData: true, analyzedIncidentCount: incidents.length, insightCount: 0 }
  }

  const prompt = buildPatternPrompt(incidents, names, period)
  let responseText: string
  try {
    responseText = await ports.model.generate({ systemInstruction: prompt.systemInstruction, prompt: prompt.text, responseJsonSchema: MODEL_RESPONSE_SCHEMA })
  } catch {
    ports.log.info('pattern analysis: model unavailable', { incidents: incidents.length })
    throw new PatternError('unavailable', 'Pattern analysis is not available right now. Try again later.')
  }

  const result = filterModelOutput(responseText, {
    incidentWaterPoints: new Map(incidents.map((i) => [i.id, i.waterPointId])),
    period,
  })
  if (!result) {
    ports.log.info('pattern analysis: invalid model output', { incidents: incidents.length })
    throw new PatternError('unavailable', 'The AI answer could not be used. Try again later.')
  }

  const droppedTotal = Object.values(result.dropped).reduce((a, b) => a + b, 0)
  const dropNotes = (Object.keys(result.dropped) as DropReason[]).filter((r) => result.dropped[r] > 0).map((r) => `${result.dropped[r]} ${DROP_NOTE[r]}`)
  const limitations = [
    sample,
    'Insights are AI-generated from unverified field reports. Hypotheses need inspection by a technician before any action.',
    ...(droppedTotal > 0 ? [`${droppedTotal} AI insight${droppedTotal === 1 ? ' was' : 's were'} removed: ${dropNotes.join('; ')}.`] : []),
    ...result.modelLimitations,
  ]
  const analysisId = await ports.data.saveAnalysis({ ...base, model: ports.model.name, insufficientData: false, limitations, insights: result.insights })

  const redactionCounts: Record<string, number> = {}
  for (const kind of Object.keys(prompt.redactions) as RedactionKind[]) redactionCounts[`redacted_${kind}`] = prompt.redactions[kind]
  ports.log.info('pattern analysis: complete', {
    incidents: incidents.length,
    insightsKept: result.insights.length,
    insightsDropped: droppedTotal,
    ...redactionCounts,
  })
  return { analysisId, insufficientData: false, analyzedIncidentCount: incidents.length, insightCount: result.insights.length }
}
