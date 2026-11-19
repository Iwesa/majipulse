import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { IncidentExtractor } from '../services/ai/types'
import type { IncidentOutbox } from '../services/incidents'
import type { PatternService } from '../services/patterns'
import type { AuthService } from '../services/session'
import type { DashboardService, MaintenanceService, StaffIncidentService } from '../services/staff'
import type { IncidentSyncAdapter } from '../services/sync/types'
import type { UserAdminService } from '../services/userAdmin'
import type { WaterPointCache, WaterPointService } from '../services/waterPoints'
import type { DashboardState, DashboardStore } from '../stores/dashboardStore'
import type { IncidentState, IncidentStore } from '../stores/incidentStore'
import type { MaintenanceState, MaintenanceStore } from '../stores/maintenanceStore'
import type { PatternState, PatternStore } from '../stores/patternStore'
import type { SessionState, SessionStore } from '../stores/sessionStore'
import type { StaffIncidentState, StaffIncidentStore } from '../stores/staffIncidentStore'
import type { SyncState, SyncStore } from '../stores/syncStore'
import type { WaterPointState, WaterPointStore } from '../stores/waterPointStore'

/** Everything the UI needs from outside, injected so tests can use fakes. */
export interface AppServices {
  auth: AuthService
  userAdmin: UserAdminService
  waterPoints: WaterPointService
  waterPointCache: WaterPointCache
  incidentOutbox: IncidentOutbox
  /** Staff triage, maintenance, and dashboard counts (Phase 7). Online only. */
  staffIncidents: StaffIncidentService
  maintenance: MaintenanceService
  dashboard: DashboardService
  /** Cross-incident pattern analysis (Cloud Function) and saved results (Phase 8). */
  patterns: PatternService
  /** Server sync. Always set in the app; tests leave it out to keep reports local. */
  incidentSync?: IncidentSyncAdapter
  /** AI field suggestions (Firebase AI Logic). Optional: without it, reporting is manual only. */
  incidentExtractor?: IncidentExtractor
}

export interface ServicesValue {
  services: AppServices
  sessionStore: SessionStore
  waterPointStore: WaterPointStore
  incidentStore: IncidentStore
  syncStore: SyncStore
  staffIncidentStore: StaffIncidentStore
  maintenanceStore: MaintenanceStore
  dashboardStore: DashboardStore
  patternStore: PatternStore
}

export const ServicesContext = createContext<ServicesValue | null>(null)

function useServicesValue(): ServicesValue {
  const value = useContext(ServicesContext)
  if (!value) throw new Error('ServicesProvider is missing')
  return value
}

export function useServices(): AppServices {
  return useServicesValue().services
}

export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(useServicesValue().sessionStore, selector)
}

export function useWaterPoints<T>(selector: (state: WaterPointState) => T): T {
  return useStore(useServicesValue().waterPointStore, selector)
}

export function useIncidents<T>(selector: (state: IncidentState) => T): T {
  return useStore(useServicesValue().incidentStore, selector)
}

export function useSync<T>(selector: (state: SyncState) => T): T {
  return useStore(useServicesValue().syncStore, selector)
}

export function useIncidentStoreApi(): IncidentStore {
  return useServicesValue().incidentStore
}

export function useSyncStoreApi(): SyncStore {
  return useServicesValue().syncStore
}

export function useStaffIncidents<T>(selector: (state: StaffIncidentState) => T): T {
  return useStore(useServicesValue().staffIncidentStore, selector)
}

export function useMaintenance<T>(selector: (state: MaintenanceState) => T): T {
  return useStore(useServicesValue().maintenanceStore, selector)
}

export function useDashboard<T>(selector: (state: DashboardState) => T): T {
  return useStore(useServicesValue().dashboardStore, selector)
}

export function usePatterns<T>(selector: (state: PatternState) => T): T {
  return useStore(useServicesValue().patternStore, selector)
}
