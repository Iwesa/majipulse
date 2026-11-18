import { useEffect, useMemo, type ReactNode } from 'react'
import { createSessionStore } from '../stores/sessionStore'
import { ServicesContext, type AppServices } from './servicesContext'

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const sessionStore = useMemo(() => createSessionStore(services.auth), [services.auth])
  useEffect(() => sessionStore.getState().start(), [sessionStore])
  const value = useMemo(() => ({ services, sessionStore }), [services, sessionStore])
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}
