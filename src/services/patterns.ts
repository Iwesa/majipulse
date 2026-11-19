/**
 * Pattern analysis for staff (T8.4). Analyses run only in the
 * `analyzeIncidentPatterns` Cloud Function; the client reads saved results
 * and requests new runs. Online only. Methods throw StaffDataError.
 */
import { z } from 'zod'
import type { PatternAnalysis } from '../schemas/patternAnalysis'
import type { SessionScope } from '../schemas/roles'

export type PatternAnalysisRecord = PatternAnalysis & { id: string }

/** The callable's answer, validated before use. */
export const runResultSchema = z.object({
  analysisId: z.string().min(1).max(128),
  insufficientData: z.boolean(),
  analyzedIncidentCount: z.int().min(0),
  insightCount: z.int().min(0),
})
export type RunResult = z.infer<typeof runResultSchema>

export interface RunInput {
  /** ISO 8601 with offset. */
  from: string
  to: string
  waterPointId?: string
}

export interface PatternService {
  /** The organization's saved analyses, newest first. Invalid documents are skipped. */
  list(scope: SessionScope): Promise<PatternAnalysisRecord[]>
  /** Null if missing or in another organization. */
  get(scope: SessionScope, id: string): Promise<PatternAnalysisRecord | null>
  run(input: RunInput): Promise<RunResult>
}
