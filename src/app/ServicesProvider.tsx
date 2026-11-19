import { useEffect, useMemo, type ReactNode } from 'react'
import { createDashboardStore } from '../stores/dashboardStore'
import { createIncidentStore } from '../stores/incidentStore'
import { createMaintenanceStore } from '../stores/maintenanceStore'
import { createPatternStore } from '../stores/patternStore'
import { createSessionStore } from '../stores/sessionStore'
import { createStaffIncidentStore } from '../stores/staffIncidentStore'
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
  const staffIncidentStore = useMemo(() => createStaffIncidentStore(services.staffIncidents), [services.staffIncidents])
  const maintenanceStore = useMemo(
    () => createMaintenanceStore({ service: services.maintenance, listMembers: (scope) => services.userAdmin.listMembers(scope) }),
    [services.maintenance, services.userAdmin],
  )
  const dashboardStore = useMemo(() => createDashboardStore(services.dashboard), [services.dashboard])
  const patternStore = useMemo(() => createPatternStore(services.patterns), [services.patterns])
  // Cleared when the signed-in user changes or signs out (R3.6). The sync
  // engine is stopped first, so it cannot write results for the old account.
  useEffect(() => registerStoreReset(() => syncStore.getState().reset()), [syncStore])
  useEffect(() => registerStoreReset(() => waterPointStore.getState().reset()), [waterPointStore])
  useEffect(() => registerStoreReset(() => incidentStore.getState().reset()), [incidentStore])
  useEffect(() => registerStoreReset(() => staffIncidentStore.getState().reset()), [staffIncidentStore])
  useEffect(() => registerStoreReset(() => maintenanceStore.getState().reset()), [maintenanceStore])
  useEffect(() => registerStoreReset(() => dashboardStore.getState().reset()), [dashboardStore])
  useEffect(() => registerStoreReset(() => patternStore.getState().reset()), [patternStore])
  useEffect(() => sessionStore.getState().start(), [sessionStore])
  const value = useMemo(
    () => ({ services, sessionStore, waterPointStore, incidentStore, syncStore, staffIncidentStore, maintenanceStore, dashboardStore, patternStore }),
    [services, sessionStore, waterPointStore, incidentStore, syncStore, staffIncidentStore, maintenanceStore, dashboardStore, patternStore],
  )
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}
