import { describe, expect, it } from 'vitest'
import { INCIDENT_ID, T0, T1, T2, patternAnalysis } from '../test/fixtures'
import { insightSchema, patternAnalysisSchema } from './patternAnalysis'

const insight = () => patternAnalysis().insights[0]

function issuePaths(value: unknown): string[] {
  const result = patternAnalysisSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'))
}

describe('insightSchema', () => {
  it('accepts an observation and a hypothesis', () => {
    expect(insightSchema.safeParse(insight()).success).toBe(true)
    expect(insightSchema.safeParse({ ...insight(), kind: 'hypothesis' }).success).toBe(true)
  })
  it('rejects an insight with no limitations', () => {
    expect(insightSchema.safeParse({ ...insight(), limitations: [] }).success).toBe(false)
  })
  it('rejects a blank limitation', () => {
    expect(insightSchema.safeParse({ ...insight(), limitations: ['  '] }).success).toBe(false)
  })
  it('rejects missing supporting incidents or affected water points', () => {
    expect(insightSchema.safeParse({ ...insight(), supportingIncidentIds: [] }).success).toBe(false)
    expect(insightSchema.safeParse({ ...insight(), affectedWaterPointIds: [] }).success).toBe(false)
  })
  it('rejects duplicate incident IDs', () => {
    expect(insightSchema.safeParse({ ...insight(), supportingIncidentIds: [INCIDENT_ID, INCIDENT_ID] }).success).toBe(false)
  })
  it('rejects cause, diagnosis, and verified fields', () => {
    expect(insightSchema.safeParse({ ...insight(), cause: 'worn pump seal' }).success).toBe(false)
    expect(insightSchema.safeParse({ ...insight(), diagnosis: 'faulty valve' }).success).toBe(false)
    expect(insightSchema.safeParse({ ...insight(), verified: true }).success).toBe(false)
  })
  it.each([
    ['kind', 'cause'],
    ['kind', 'diagnosis'],
    ['confidence', 'certain'],
    ['title', ''],
    ['statement', 's'.repeat(1001)],
  ])('rejects %s = %j', (key, value) => {
    expect(insightSchema.safeParse({ ...insight(), [key]: value }).success).toBe(false)
  })
  it('rejects a missing or inverted period', () => {
    const { period: _p, ...noPeriod } = insight()
    void _p
    expect(insightSchema.safeParse(noPeriod).success).toBe(false)
    expect(insightSchema.safeParse({ ...insight(), period: { from: T1, to: T0 } }).success).toBe(false)
  })
})

describe('patternAnalysisSchema', () => {
  it('accepts a valid analysis', () => {
    expect(issuePaths(patternAnalysis())).toEqual([])
  })
  it('accepts an insufficient-data analysis with no insights', () => {
    const value = {
      ...patternAnalysis(),
      analyzedIncidentIds: [INCIDENT_ID],
      analyzedIncidentCount: 1,
      insufficientData: true,
      insights: [],
      limitations: ['Fewer than 3 incidents matched the scope.'],
    }
    expect(issuePaths(value)).toEqual([])
  })
  it('rejects insights when data is insufficient', () => {
    expect(issuePaths({ ...patternAnalysis(), insufficientData: true })).toContain('insights')
  })
  it('requires analysis-level limitations', () => {
    expect(issuePaths({ ...patternAnalysis(), limitations: [] })).toContain('limitations')
  })
  it('requires the count to match the analyzed IDs', () => {
    expect(issuePaths({ ...patternAnalysis(), analyzedIncidentCount: 5 })).toContain('analyzedIncidentCount')
  })
  it('rejects insights citing incidents that were not analyzed', () => {
    const foreign = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'
    const value = { ...patternAnalysis(), insights: [{ ...insight(), supportingIncidentIds: [foreign] }] }
    expect(issuePaths(value)).toContain('insights.0.supportingIncidentIds')
  })
  it('rejects insight periods outside the analysis period', () => {
    const before = { ...insight(), period: { from: '2026-02-01T00:00:00Z', to: T1 } }
    const after = { ...insight(), period: { from: T1, to: '2026-04-01T00:00:00Z' } }
    expect(issuePaths({ ...patternAnalysis(), insights: [before] })).toContain('insights.0.period')
    expect(issuePaths({ ...patternAnalysis(), insights: [after] })).toContain('insights.0.period')
  })
  it('accepts an insight period equal to the analysis period', () => {
    const value = { ...patternAnalysis(), insights: [{ ...insight(), period: { from: T0, to: T2 } }] }
    expect(issuePaths(value)).toEqual([])
  })
  it('rejects unknown keys and a scope with extra fields', () => {
    expect(issuePaths({ ...patternAnalysis(), rootCause: 'x' })).not.toEqual([])
    expect(issuePaths({ ...patternAnalysis(), scope: { ward: 'Demo Ward' } })).not.toEqual([])
  })
})
