import { useEffect, useMemo, type ReactNode } from 'react'
import { createIncidentStore } from '../stores/incidentStore'
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
  const incidentStore = useMemo(() => createIncidentStore(services.incidentOutbox), [services.incidentOutbox])
  // Cleared when the signed-in user changes or signs out (R3.6).
  useEffect(() => registerStoreReset(() => waterPointStore.getState().reset()), [waterPointStore])
  useEffect(() => registerStoreReset(() => incidentStore.getState().reset()), [incidentStore])
  useEffect(() => sessionStore.getState().start(), [sessionStore])
  const value = useMemo(
    () => ({ services, sessionStore, waterPointStore, incidentStore }),
    [services, sessionStore, waterPointStore, incidentStore],
  )
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}
