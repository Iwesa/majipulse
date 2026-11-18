/**
 * FICTIONAL demo dataset (T2.13). Every organization, person, place, and
 * water point is invented and marked `demo: true`. Emails use the reserved
 * example.org domain. Dates are JavaScript Dates; the writer stores them as
 * Firestore Timestamps.
 */
import type { Role } from '../domain.js'

export interface DemoUser {
  uid: string
  email: string
  displayName: string
  role: Role
}

export interface DemoOrganization {
  id: string
  name: string
  county: string
  users: DemoUser[]
}

export interface DemoWaterPoint {
  id: string
  data: {
    organizationId: string
    name: string
    type: 'borehole' | 'handpump' | 'kiosk' | 'tap' | 'other'
    locationDescription: string
    ward: string
    status: 'working' | 'needs_repair' | 'not_working' | 'unknown'
    demo: true
    createdBy: string
    createdAt: Date
    updatedAt: Date
  }
}

type IncidentStatus = 'new' | 'triaged' | 'in_progress' | 'resolved'

export interface DemoIncident {
  id: string
  data: {
    organizationId: string
    waterPointId: string
    reporterId: string
    demo: true
    description: string
    incidentType: 'no_water' | 'low_flow' | 'leak' | 'water_quality_concern' | 'pump_or_equipment_issue' | 'other'
    severity: 'low' | 'medium' | 'high' | null
    status: IncidentStatus
    lastStatusChange?: { by: string; at: Date; from: IncidentStatus; to: IncidentStatus }
    baseRevision: number
    clientRevision: number
    mutationId: string
    serverRevision: number
    clientCreatedAt: Date
    createdAt: Date
    updatedAt: Date
    confirmedFields: string[]
  }
}

export interface DemoData {
  organizations: DemoOrganization[]
  waterPoints: DemoWaterPoint[]
  incidents: DemoIncident[]
}

const user = (orgKey: string, role: Role, displayName: string): DemoUser => ({
  uid: `demo-${orgKey}-${role}`,
  email: `${role}.${orgKey}@example.org`,
  displayName,
  role,
})

export const DEMO_ORGANIZATIONS: DemoOrganization[] = [
  {
    id: 'kwale-demo',
    name: 'Kwale Demo Water Users Association (fictional)',
    county: 'Kwale',
    users: [
      user('kwale', 'administrator', 'Demo Administrator (Kwale)'),
      user('kwale', 'technician', 'Demo Technician (Kwale)'),
      user('kwale', 'reporter', 'Demo Reporter (Kwale)'),
    ],
  },
  {
    id: 'pwani-demo',
    name: 'Pwani Demo Water Office (fictional)',
    county: 'Kwale',
    users: [
      user('pwani', 'administrator', 'Demo Administrator (Pwani)'),
      user('pwani', 'technician', 'Demo Technician (Pwani)'),
      user('pwani', 'reporter', 'Demo Reporter (Pwani)'),
    ],
  },
]

const WATER_POINTS: Array<[orgIndex: number, id: string, name: string, type: DemoWaterPoint['data']['type'], status: DemoWaterPoint['data']['status']]> = [
  [0, 'wp-mwamanga-borehole', 'Mwamanga Borehole (fictional)', 'borehole', 'working'],
  [0, 'wp-kilimani-handpump', 'Kilimani Handpump (fictional)', 'handpump', 'needs_repair'],
  [0, 'wp-soko-kiosk', 'Soko Water Kiosk (fictional)', 'kiosk', 'working'],
  [0, 'wp-shule-tap', 'Shule Standpipe (fictional)', 'tap', 'not_working'],
  [1, 'wp-pwani-borehole', 'Pwani Demo Borehole (fictional)', 'borehole', 'working'],
  [1, 'wp-pwani-kiosk', 'Pwani Demo Kiosk (fictional)', 'kiosk', 'unknown'],
]

const INCIDENTS: Array<[
  waterPointIndex: number,
  description: string,
  type: DemoIncident['data']['incidentType'],
  severity: DemoIncident['data']['severity'],
  status: IncidentStatus,
]> = [
  [0, 'Borehole pump runs but very little water comes out in the morning.', 'low_flow', 'medium', 'new'],
  [0, 'Water flow dropped again after two days of normal use.', 'low_flow', 'medium', 'triaged'],
  [0, 'Users report the water tastes salty this week.', 'water_quality_concern', 'high', 'in_progress'],
  [1, 'Handpump handle is loose and hard to use.', 'pump_or_equipment_issue', 'medium', 'new'],
  [1, 'No water from the handpump since yesterday.', 'no_water', 'high', 'triaged'],
  [1, 'Handpump repaired, flow back to normal.', 'other', 'low', 'resolved'],
  [2, 'Water is leaking from the kiosk pipe joint.', 'leak', 'medium', 'new'],
  [3, 'Standpipe has had no water for three days.', 'no_water', 'high', 'in_progress'],
  [3, 'Puddle forming around the standpipe base.', 'leak', 'low', 'new'],
  [4, 'Borehole water looks cloudy after rain.', 'water_quality_concern', 'medium', 'new'],
  [5, 'Kiosk closed, no water available today.', 'no_water', null, 'triaged'],
  [5, 'Kiosk tap drips constantly.', 'leak', 'low', 'new'],
]

const PATH: Record<IncidentStatus, IncidentStatus[]> = {
  new: [],
  triaged: ['triaged'],
  in_progress: ['triaged', 'in_progress'],
  resolved: ['triaged', 'in_progress', 'resolved'],
}
const PREVIOUS: Record<Exclude<IncidentStatus, 'new'>, IncidentStatus> = {
  triaged: 'new',
  in_progress: 'triaged',
  resolved: 'in_progress',
}

/** Builds the dataset. `now` and `uuid` are injectable for deterministic tests. */
export function buildDemoData(now: Date, uuid: () => string): DemoData {
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)

  const waterPoints: DemoWaterPoint[] = WATER_POINTS.map(([orgIndex, id, name, type, status], index) => {
    const org = DEMO_ORGANIZATIONS[orgIndex]
    const created = hoursAgo(24 * 30 + index)
    return {
      id,
      data: {
        organizationId: org.id,
        name,
        type,
        locationDescription: `Fictional location for ${name}`,
        ward: 'Demo Ward',
        status,
        demo: true,
        createdBy: org.users[0].uid,
        createdAt: created,
        updatedAt: created,
      },
    }
  })

  const incidents: DemoIncident[] = INCIDENTS.map(([wpIndex, description, incidentType, severity, status], index) => {
    const wp = waterPoints[wpIndex]
    const org = DEMO_ORGANIZATIONS.find((o) => o.id === wp.data.organizationId)
    if (!org) throw new Error('Demo data is inconsistent')
    const reporter = org.users.find((u) => u.role === 'reporter')
    const technician = org.users.find((u) => u.role === 'technician')
    if (!reporter || !technician) throw new Error('Demo data is inconsistent')

    const created = hoursAgo(24 * 10 - index * 12)
    const changes = PATH[status]
    const updated = changes.length > 0 ? new Date(created.getTime() + changes.length * 3_600_000) : created
    const data: DemoIncident['data'] = {
      organizationId: org.id,
      waterPointId: wp.id,
      reporterId: reporter.uid,
      demo: true,
      description: `${description} (fictional demo report)`,
      incidentType,
      severity,
      status,
      baseRevision: 0,
      clientRevision: 1,
      mutationId: uuid(),
      serverRevision: 1 + changes.length,
      clientCreatedAt: created,
      createdAt: created,
      updatedAt: updated,
      confirmedFields: [],
    }
    if (status !== 'new') {
      data.lastStatusChange = { by: technician.uid, at: updated, from: PREVIOUS[status], to: status }
    }
    return { id: uuid(), data }
  })

  return { organizations: DEMO_ORGANIZATIONS, waterPoints, incidents }
}
