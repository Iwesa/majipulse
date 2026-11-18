import { useEffect, useMemo, type ReactNode } from 'react'
import { createIncidentStore } from '../stores/incidentStore'
import { createSessionStore } from '../stores/sessionStore'
import { registerStoreReset } from '../stores/storeRegistry'
import { createSyncStore } from '../stores/syncStore'
import { createWaterPointStore } from '../stores/waterPointStore'
import { ServicesContext, type AppServices } from './servicesContext'

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const sessionStore = useMemo(() => createSessionStore(services.auth), [services.auth])
  const waterPointStore = useMemo(
    () => createWaterPointStore(services.waterPoints, services.waterPointCache),
    [services.waterPoints, services.waterPointCache],
  )
  const incidentStore = useMemo(() => createIncidentStore(services.incidentOutbox), [services.incidentOutbox])
  const syncStore = useMemo(() => createSyncStore(services.incidentSync !== undefined), [services.incidentSync])
  // Cleared when the signed-in user changes or signs out (R3.6). The sync
  // engine is stopped first, so it cannot write results for the old account.
  useEffect(() => registerStoreReset(() => syncStore.getState().reset()), [syncStore])
  useEffect(() => registerStoreReset(() => waterPointStore.getState().reset()), [waterPointStore])
  useEffect(() => registerStoreReset(() => incidentStore.getState().reset()), [incidentStore])
  useEffect(() => sessionStore.getState().start(), [sessionStore])
  const value = useMemo(
    () => ({ services, sessionStore, waterPointStore, incidentStore, syncStore }),
    [services, sessionStore, waterPointStore, incidentStore, syncStore],
  )
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}
