import { z } from 'zod'
import {
  documentIdSchema,
  isNotAfter,
  isoDateTimeSchema,
  organizationIdSchema,
  periodSchema,
  requiredText,
  uidSchema,
  uniqueArray,
  uuidSchema,
} from './common'

/**
 * Insights are observations (patterns in the data) or hypotheses (unverified
 * possible explanations). There is deliberately no cause or diagnosis field,
 * and strict objects reject one if a model adds it (R9.4).
 */
export const insightKindSchema = z.enum(['observation', 'hypothesis'])
export const confidenceSchema = z.enum(['low', 'medium', 'high'])

const limitationsSchema = z.array(requiredText(500)).min(1, { error: 'At least one limitation is required' })

export const insightSchema = z.strictObject({
  kind: insightKindSchema,
  title: requiredText(120),
  statement: requiredText(1000),
  supportingIncidentIds: uniqueArray(uuidSchema).refine((ids) => ids.length >= 1, {
    error: 'An insight needs at least one supporting incident',
  }),
  affectedWaterPointIds: uniqueArray(documentIdSchema).refine((ids) => ids.length >= 1, {
    error: 'An insight needs at least one affected water point',
  }),
  period: periodSchema,
  limitations: limitationsSchema,
  confidence: confidenceSchema,
})
export type Insight = z.infer<typeof insightSchema>

/**
 * `patternAnalyses/{analysisId}`. Written only by the Cloud Function.
 * Checks that need incident data (water points linked to cited incidents)
 * run in the function, not here (R9.5).
 */
export const patternAnalysisSchema = z
  .strictObject({
    organizationId: organizationIdSchema,
    requestedBy: uidSchema,
    createdAt: isoDateTimeSchema,
    demo: z.boolean(),
    model: requiredText(100),
    period: periodSchema,
    scope: z.strictObject({ waterPointId: documentIdSchema.optional() }),
    analyzedIncidentIds: uniqueArray(uuidSchema),
    analyzedIncidentCount: z.int().min(0),
    insufficientData: z.boolean(),
    limitations: limitationsSchema,
    insights: z.array(insightSchema),
  })
  .superRefine((a, ctx) => {
    if (a.analyzedIncidentCount !== a.analyzedIncidentIds.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'analyzedIncidentCount must equal the number of analyzed incident IDs',
        path: ['analyzedIncidentCount'],
      })
    }
    if (a.insufficientData && a.insights.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'Insufficient-data analyses have no insights', path: ['insights'] })
    }
    const analyzed = new Set(a.analyzedIncidentIds)
    a.insights.forEach((insight, index) => {
      if (!insight.supportingIncidentIds.every((id) => analyzed.has(id))) {
        ctx.addIssue({
          code: 'custom',
          message: 'Insights may only cite analyzed incidents',
          path: ['insights', index, 'supportingIncidentIds'],
        })
      }
      if (!isNotAfter(a.period.from, insight.period.from) || !isNotAfter(insight.period.to, a.period.to)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Insight period must be within the analysis period',
          path: ['insights', index, 'period'],
        })
      }
    })
  })
export type PatternAnalysis = z.infer<typeof patternAnalysisSchema>
