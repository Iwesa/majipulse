// FICTIONAL demo fixtures for tests. All names, places, and IDs are invented
// Kwale County examples and do not describe real people or facilities.
import type {
  Incident,
  LocalIncidentRecord,
  MaintenanceTask,
  Member,
  Organization,
  PatternAnalysis,
  WaterPoint,
} from '../schemas'

export const ORG_ID = 'kwale-demo'
export const ADMIN_UID = 'uid-admin-demo'
export const REPORTER_UID = 'uid-reporter-demo'
export const WATER_POINT_ID = 'wp-mwamanga-borehole'
export const INCIDENT_ID = '3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f'
export const INCIDENT_ID_2 = '7a2b3c4d-1e2f-4a5b-8c6d-9e0f1a2b3c4d'
export const MUTATION_ID = 'b1c2d3e4-f5a6-4b7c-9d8e-0f1a2b3c4d5e'
export const MUTATION_ID_2 = 'c2d3e4f5-a6b7-4c8d-ae9f-1a2b3c4d5e6f'
export const T0 = '2026-03-01T08:00:00Z'
export const T1 = '2026-03-02T09:30:00Z'
export const T2 = '2026-03-03T10:45:00Z'

export const organization = (): Organization => ({
  name: 'Kwale Demo Water Users Association (fictional)',
  county: 'Kwale',
  demo: true,
  createdAt: T0,
  createdBy: ADMIN_UID,
  bootstrap: { status: 'complete', adminUid: ADMIN_UID, userCreatedByBootstrap: true, startedAt: T0, completedAt: T1 },
})

export const member = (): Member => ({
  organizationId: ORG_ID,
  role: 'reporter',
  email: 'reporter@example.org',
  displayName: 'Demo Reporter',
  active: true,
  createdAt: T0,
  updatedAt: T0,
})

export const waterPoint = (): WaterPoint => ({
  organizationId: ORG_ID,
  name: 'Mwamanga Borehole (fictional)',
  type: 'borehole',
  locationDescription: 'Beside the fictional Mwamanga primary school',
  ward: 'Demo Ward',
  status: 'working',
  demo: true,
  createdBy: ADMIN_UID,
  createdAt: T0,
  updatedAt: T0,
})

export const incident = (): Incident => ({
  organizationId: ORG_ID,
  waterPointId: WATER_POINT_ID,
  reporterId: REPORTER_UID,
  demo: true,
  description: 'Handpump gives very little water since Monday morning.',
  incidentType: 'low_flow',
  severity: 'medium',
  status: 'new',
  baseRevision: 0,
  clientRevision: 1,
  mutationId: MUTATION_ID,
  serverRevision: 1,
  clientCreatedAt: T0,
  createdAt: T0,
  updatedAt: T0,
  confirmedFields: [],
})

export const localRecord = (): LocalIncidentRecord => {
  const { serverRevision: _s, createdAt: _c, updatedAt: _u, ...content } = incident()
  void _s
  void _c
  void _u
  return { ...content, id: INCIDENT_ID, ownerUid: REPORTER_UID, syncStatus: 'pending' }
}

export const maintenanceTask = (): MaintenanceTask => ({
  organizationId: ORG_ID,
  waterPointId: WATER_POINT_ID,
  incidentId: INCIDENT_ID,
  title: 'Inspect handpump flow',
  notes: '',
  status: 'open',
  assigneeId: null,
  createdBy: ADMIN_UID,
  createdAt: T1,
  updatedAt: T1,
  demo: true,
})

export const patternAnalysis = (): PatternAnalysis => ({
  organizationId: ORG_ID,
  requestedBy: ADMIN_UID,
  createdAt: T2,
  demo: true,
  model: 'test-model',
  period: { from: T0, to: T2 },
  scope: {},
  analyzedIncidentIds: [INCIDENT_ID, INCIDENT_ID_2],
  analyzedIncidentCount: 2,
  insufficientData: false,
  limitations: ['Only 2 incidents in this period.'],
  insights: [
    {
      kind: 'observation',
      title: 'Repeated low flow reports',
      statement: 'Two reports of low flow at the same borehole within three days.',
      supportingIncidentIds: [INCIDENT_ID, INCIDENT_ID_2],
      affectedWaterPointIds: [WATER_POINT_ID],
      period: { from: T0, to: T1 },
      limitations: ['Small sample.'],
      confidence: 'low',
    },
  ],
})
