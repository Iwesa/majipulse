import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { IncidentExtractor } from '../services/ai/types'
import type { IncidentOutbox } from '../services/incidents'
import type { AuthService } from '../services/session'
import type { IncidentSyncAdapter } from '../services/sync/types'
import type { UserAdminService } from '../services/userAdmin'
import type { WaterPointCache, WaterPointService } from '../services/waterPoints'
import type { IncidentState, IncidentStore } from '../stores/incidentStore'
import type { SessionState, SessionStore } from '../stores/sessionStore'
import type { SyncState, SyncStore } from '../stores/syncStore'
import type { WaterPointState, WaterPointStore } from '../stores/waterPointStore'

/** Everything the UI needs from outside, injected so tests can use fakes. */
export interface AppServices {
  auth: AuthService
  userAdmin: UserAdminService
  waterPoints: WaterPointService
  waterPointCache: WaterPointCache
  incidentOutbox: IncidentOutbox
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
