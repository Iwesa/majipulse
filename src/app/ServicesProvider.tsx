import { useEffect, useMemo, type ReactNode } from 'react'
import { createSessionStore } from '../stores/sessionStore'
import { registerStoreReset } from '../stores/storeRegistry'
import { createWaterPointStore } from '../stores/waterPointStore'
import { ServicesContext, type AppServices } from './servicesContext'

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const sessionStore = useMemo(() => createSessionStore(services.auth), [services.auth])
  const waterPointStore = useMemo(
    () => createWaterPointStore(services.waterPoints, services.waterPointCache),
    [services.waterPoints, services.waterPointCache],
  )
  // Cleared when the signed-in user changes or signs out (R3.6).
  useEffect(() => registerStoreReset(() => waterPointStore.getState().reset()), [waterPointStore])
  useEffect(() => sessionStore.getState().start(), [sessionStore])
  const value = useMemo(() => ({ services, sessionStore, waterPointStore }), [services, sessionStore, waterPointStore])
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}
