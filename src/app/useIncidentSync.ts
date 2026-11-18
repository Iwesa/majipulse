import { useEffect } from 'react'
import { SyncEngine } from '../services/sync/syncEngine'
import { useIncidentStoreApi, useServices, useSession, useSyncStoreApi } from './servicesContext'

/**
 * Runs the sync engine for the signed-in user (T5.3). Triggers: sign-in
 * (start), the browser's `online` event, saves and manual actions (through
 * the sync store), and backoff retries inside the engine. The engine stops
 * on sign-out or account switch, and its late results are discarded.
 */
export function useIncidentSync(organizationId: string, ownerUid: string): void {
  const services = useServices()
  const refreshClaims = useSession((s) => s.refreshClaims)
  const syncStore = useSyncStoreApi()
  const incidentStore = useIncidentStoreApi()

  useEffect(() => {
    const adapter = services.incidentSync
    if (!adapter) return
    const scope = { organizationId, ownerUid }
    const engine = new SyncEngine({
      scope,
      repository: services.incidentOutbox.forScope(scope),
      adapter,
      refreshClaims,
      onChange: () => void incidentStore.getState().load(scope),
      onState: (status) => {
        if (syncStore.getState().engine === engine) syncStore.getState().setStatus(status)
      },
    })
    syncStore.getState().attach(engine)
    void engine.start()
    const onOnline = () => void engine.requestSync('online')
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      syncStore.getState().detach(engine)
    }
  }, [services.incidentSync, services.incidentOutbox, refreshClaims, syncStore, incidentStore, organizationId, ownerUid])
}
