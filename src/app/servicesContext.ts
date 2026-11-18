import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { IncidentOutbox } from '../services/incidents'
import type { AuthService } from '../services/session'
import type { UserAdminService } from '../services/userAdmin'
import type { WaterPointCache, WaterPointService } from '../services/waterPoints'
import type { IncidentState, IncidentStore } from '../stores/incidentStore'
import type { SessionState, SessionStore } from '../stores/sessionStore'
import type { WaterPointState, WaterPointStore } from '../stores/waterPointStore'

/** Everything the UI needs from outside, injected so tests can use fakes. */
export interface AppServices {
  auth: AuthService
  userAdmin: UserAdminService
  waterPoints: WaterPointService
  waterPointCache: WaterPointCache
  incidentOutbox: IncidentOutbox
}

export interface ServicesValue {
  services: AppServices
  sessionStore: SessionStore
  waterPointStore: WaterPointStore
  incidentStore: IncidentStore
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
