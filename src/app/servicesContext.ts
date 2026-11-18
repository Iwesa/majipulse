import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { AuthService } from '../services/session'
import type { UserAdminService } from '../services/userAdmin'
import type { SessionState, SessionStore } from '../stores/sessionStore'

/** Everything the UI needs from outside, injected so tests can use fakes. */
export interface AppServices {
  auth: AuthService
  userAdmin: UserAdminService
}

export interface ServicesValue {
  services: AppServices
  sessionStore: SessionStore
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
