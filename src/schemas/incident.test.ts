import { describe, expect, it } from 'vitest'
import { ADMIN_UID, T0, T1, incident } from '../test/fixtures'
import {
  DESCRIPTION_MAX,
  INCIDENT_STATUS_TRANSITIONS,
  aiExtractionOutputSchema,
  aiSuggestionSchema,
  incidentSchema,
  isAllowedIncidentTransition,
  statusChangeSchema,
  type IncidentStatus,
} from './incident'

const triaged = () => ({
  ...incident(),
  status: 'triaged' as const,
  serverRevision: 2,
  lastStatusChange: { by: ADMIN_UID, at: T1, from: 'new' as const, to: 'triaged' as const },
})

describe('incidentSchema: valid', () => {
  it('accepts a new incident', () => {
    expect(incidentSchema.safeParse(incident()).success).toBe(true)
  })
  it('accepts a triaged incident with matching status history', () => {
    expect(incidentSchema.safeParse(triaged()).success).toBe(true)
  })
  it('accepts null severity and optional fields', () => {
    const value = { ...incident(), severity: null, occurredAt: T0, locationNote: 'Near the cattle trough' }
    expect(incidentSchema.safeParse(value).success).toBe(true)
  })
  it('accepts a description at exactly the maximum length', () => {
    expect(incidentSchema.safeParse({ ...incident(), description: 'd'.repeat(DESCRIPTION_MAX) }).success).toBe(true)
  })
})

describe('incidentSchema: invalid', () => {
  it('rejects a description over the maximum length', () => {
    expect(incidentSchema.safeParse({ ...incident(), description: 'd'.repeat(DESCRIPTION_MAX + 1) }).success).toBe(false)
  })
  it('rejects a blank description', () => {
    expect(incidentSchema.safeParse({ ...incident(), description: '   ' }).success).toBe(false)
  })
  it.each([
    ['incidentType', 'burst_pipe'],
    ['severity', 'critical'],
    ['status', 'closed'],
    ['mutationId', 'not-a-uuid'],
    ['organizationId', 'KWALE'],
    ['clientRevision', 0],
    ['clientRevision', 1.5],
    ['baseRevision', -1],
    ['serverRevision', 0],
    ['occurredAt', '2026-03-01'],
    ['locationNote', ''],
  ])('rejects %s = %j', (key, value) => {
    expect(incidentSchema.safeParse({ ...incident(), [key]: value }).success).toBe(false)
  })
  it.each(['organizationId', 'reporterId', 'waterPointId', 'demo', 'mutationId', 'confirmedFields'])(
    'requires %s',
    (key) => {
      const value: Record<string, unknown> = { ...incident() }
      delete value[key]
      expect(incidentSchema.safeParse(value).success).toBe(false)
    },
  )
  it('rejects unknown keys such as a cause field', () => {
    expect(incidentSchema.safeParse({ ...incident(), cause: 'worn seal' }).success).toBe(false)
  })
  it('rejects baseRevision not lower than serverRevision', () => {
    expect(incidentSchema.safeParse({ ...incident(), baseRevision: 1, serverRevision: 1 }).success).toBe(false)
  })
  it('rejects a new incident with status history', () => {
    const value = { ...incident(), lastStatusChange: triaged().lastStatusChange }
    expect(incidentSchema.safeParse(value).success).toBe(false)
  })
  it('rejects a triaged incident without status history', () => {
    const { lastStatusChange: _l, ...value } = triaged()
    void _l
    expect(incidentSchema.safeParse(value).success).toBe(false)
  })
  it('rejects status history that does not match the status', () => {
    const value = { ...triaged(), status: 'in_progress' as const }
    expect(incidentSchema.safeParse(value).success).toBe(false)
  })
  it('rejects duplicate or unknown confirmed fields', () => {
    expect(incidentSchema.safeParse({ ...incident(), confirmedFields: ['severity', 'severity'] }).success).toBe(false)
    expect(incidentSchema.safeParse({ ...incident(), confirmedFields: ['description'] }).success).toBe(false)
  })
})

describe('status transitions', () => {
  const statuses: IncidentStatus[] = ['new', 'triaged', 'in_progress', 'resolved']
  const allowed = new Set(['new>triaged', 'triaged>in_progress', 'in_progress>resolved'])

  it.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))('%s -> %s', (from, to) => {
    expect(isAllowedIncidentTransition(from, to)).toBe(allowed.has(`${from}>${to}`))
  })
  it('defines no transition out of resolved', () => {
    expect(INCIDENT_STATUS_TRANSITIONS.resolved).toEqual([])
  })
  it('statusChangeSchema rejects skipped and reversed transitions', () => {
    const base = { by: ADMIN_UID, at: T1 }
    expect(statusChangeSchema.safeParse({ ...base, from: 'new', to: 'triaged' }).success).toBe(true)
    expect(statusChangeSchema.safeParse({ ...base, from: 'new', to: 'resolved' }).success).toBe(false)
    expect(statusChangeSchema.safeParse({ ...base, from: 'triaged', to: 'new' }).success).toBe(false)
    expect(statusChangeSchema.safeParse({ ...base, from: 'new', to: 'new' }).success).toBe(false)
  })
})

describe('AI extraction payloads', () => {
  const output = { incidentType: 'leak', severity: null, occurredAt: null, locationNote: null }

  it('accepts all-null output (nothing stated)', () => {
    const empty = { incidentType: null, severity: null, occurredAt: null, locationNote: null }
    expect(aiExtractionOutputSchema.safeParse(empty).success).toBe(true)
  })
  it('strips unknown keys from model output', () => {
    const parsed = aiExtractionOutputSchema.parse({ ...output, cause: 'worn seal', confidence: 0.9 })
    expect(parsed).toEqual(output)
  })
  it('requires every field to be present, even if null', () => {
    expect(aiExtractionOutputSchema.safeParse({ incidentType: 'leak' }).success).toBe(false)
  })
  it.each([
    ['incidentType', 'pipe_burst'],
    ['severity', 'urgent'],
    ['occurredAt', 'Monday morning'],
    ['locationNote', ''],
    ['locationNote', 'l'.repeat(301)],
  ])('rejects %s = %j', (key, value) => {
    expect(aiExtractionOutputSchema.safeParse({ ...output, [key]: value }).success).toBe(false)
  })
  it('accepts a stored suggestion with an SDK inference source', () => {
    const suggestion = { suggested: output, inferenceSource: 'on_device', model: 'test-model', generatedAt: T0 }
    expect(aiSuggestionSchema.safeParse(suggestion).success).toBe(true)
    expect(aiSuggestionSchema.safeParse({ ...suggestion, inferenceSource: 'in_cloud' }).success).toBe(true)
  })
  it('rejects unknown inference sources and extra keys in stored suggestions', () => {
    const suggestion = { suggested: output, inferenceSource: 'on_device', model: 'test-model', generatedAt: T0 }
    expect(aiSuggestionSchema.safeParse({ ...suggestion, inferenceSource: 'HYBRID' }).success).toBe(false)
    expect(aiSuggestionSchema.safeParse({ ...suggestion, suggested: { ...output, cause: 'x' } }).success).toBe(false)
  })
})
