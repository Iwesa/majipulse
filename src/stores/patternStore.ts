import { createStore, type StoreApi } from 'zustand/vanilla'
import type { SessionScope } from '../schemas/roles'
import type { PatternAnalysisRecord, PatternService, RunInput, RunResult } from '../services/patterns'
import { createGeneration, defaultIsOnline, failedState, type RemoteData } from './remoteData'

export interface PatternState {
  list: RemoteData<PatternAnalysisRecord[]>
  detail: { id: string | null; data: RemoteData<PatternAnalysisRecord | null> }
  loadList(scope: SessionScope): Promise<void>
  loadDetail(scope: SessionScope, id: string): Promise<void>
  /** Runs a new analysis in the Cloud Function, then refreshes the list. Throws StaffDataError. */
  run(scope: SessionScope, input: RunInput): Promise<RunResult>
  reset(): void
}

export type PatternStore = StoreApi<PatternState>

export function createPatternStore(service: PatternService, options: { isOnline?: () => boolean } = {}): PatternStore {
  const isOnline = options.isOnline ?? defaultIsOnline
  const listGen = createGeneration()
  const detailGen = createGeneration()
  return createStore<PatternState>()((set, get) => ({
    list: { status: 'idle' },
    detail: { id: null, data: { status: 'idle' } },

    async loadList(scope) {
      const mine = listGen.next()
      if (get().list.status !== 'ready') set({ list: { status: 'loading' } })
      try {
        const data = await service.list(scope)
        if (listGen.isCurrent(mine)) set({ list: { status: 'ready', data } })
      } catch (error) {
        if (listGen.isCurrent(mine)) set({ list: failedState(error, isOnline) })
      }
    },

    async loadDetail(scope, id) {
      const mine = detailGen.next()
      if (get().detail.id !== id || get().detail.data.status !== 'ready') set({ detail: { id, data: { status: 'loading' } } })
      try {
        const data = await service.get(scope, id)
        if (detailGen.isCurrent(mine)) set({ detail: { id, data: { status: 'ready', data } } })
      } catch (error) {
        if (detailGen.isCurrent(mine)) set({ detail: { id, data: failedState(error, isOnline) } })
      }
    },

    async run(scope, input) {
      const result = await service.run(input)
      await get().loadList(scope)
      return result
    },

    reset() {
      listGen.bump()
      detailGen.bump()
      set({ list: { status: 'idle' }, detail: { id: null, data: { status: 'idle' } } })
    },
  }))
}
