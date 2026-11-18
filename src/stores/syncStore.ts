import { createStore, type StoreApi } from 'zustand/vanilla'
import type { SyncEngine, SyncEngineState, SyncTrigger } from '../services/sync/syncEngine'

export interface SyncState {
  /** False when no sync adapter is configured (some tests). */
  enabled: boolean
  engine: SyncEngine | null
  status: SyncEngineState
  attach(engine: SyncEngine): void
  /** Stops the engine; its late results are ignored (R3.6). */
  detach(engine?: SyncEngine): void
  setStatus(status: SyncEngineState): void
  requestSync(trigger?: SyncTrigger): Promise<void>
  retry(id: string): Promise<void>
  reset(): void
}

export type SyncStore = StoreApi<SyncState>

const IDLE: SyncEngineState = { running: false, lastSyncAt: null, lastRun: null }

export function createSyncStore(enabled: boolean): SyncStore {
  return createStore<SyncState>()((set, get) => ({
    enabled,
    engine: null,
    status: IDLE,
    attach(engine) {
      get().engine?.stop()
      set({ engine, status: engine.getState() })
    },
    detach(engine) {
      const current = get().engine
      if (engine && current !== engine) {
        engine.stop()
        return
      }
      current?.stop()
      set({ engine: null, status: IDLE })
    },
    setStatus(status) {
      set({ status })
    },
    async requestSync(trigger = 'manual') {
      await get().engine?.requestSync(trigger)
    },
    async retry(id) {
      await get().engine?.retry(id)
    },
    reset() {
      get().detach()
    },
  }))
}
