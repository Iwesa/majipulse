import { createStore, type StoreApi } from 'zustand/vanilla'
import type { SessionScope } from '../schemas/roles'
import type { WaterPointInput, WaterPointRecord } from '../schemas/waterPoint'
import { waterPointErrorKind, type WaterPointCache, type WaterPointService } from '../services/waterPoints'

export type WaterPointList =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; points: WaterPointRecord[]; source: 'server' }
  | { status: 'ready'; points: WaterPointRecord[]; source: 'cache'; cachedAt: string; reason: 'offline' | 'error' }
  | { status: 'offline' }
  | { status: 'error' }

export interface WaterPointState {
  list: WaterPointList
  /** Server first, then the local cache if the server cannot be reached. */
  load(scope: SessionScope): Promise<void>
  /** Online only. Throws WaterPointServiceError. Returns the new ID. */
  create(scope: SessionScope, input: WaterPointInput): Promise<string>
  /** Online only. Throws WaterPointServiceError. */
  update(scope: SessionScope, id: string, input: WaterPointInput): Promise<void>
  reset(): void
}

export type WaterPointStore = StoreApi<WaterPointState>

interface Options {
  now?: () => Date
  isOnline?: () => boolean
}

const defaultIsOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

export function createWaterPointStore(service: WaterPointService, cache: WaterPointCache, options: Options = {}): WaterPointStore {
  const now = options.now ?? (() => new Date())
  const isOnline = options.isOnline ?? defaultIsOnline
  // Every load and reset takes a new generation. A response from an older
  // generation (for example a previous account) is discarded.
  let generation = 0
  let loadedKey: string | null = null
  const keyOf = (scope: SessionScope) => `${scope.organizationId}\u0000${scope.ownerUid}`

  return createStore<WaterPointState>()((set, get) => ({
    list: { status: 'idle' },

    async load(scope) {
      const mine = ++generation
      const key = keyOf(scope)
      // Keep the current list on screen during a background refresh of the same scope.
      if (loadedKey !== key || get().list.status !== 'ready') set({ list: { status: 'loading' } })
      loadedKey = key
      try {
        const points = await service.list(scope)
        if (mine !== generation) return
        set({ list: { status: 'ready', points, source: 'server' } })
        await cache.replace(scope, points, now().toISOString()).catch(() => undefined)
      } catch (error) {
        if (mine !== generation) return
        const reason = waterPointErrorKind(error) === 'network' || !isOnline() ? 'offline' : 'error'
        const saved = await cache.read(scope).catch(() => null)
        if (mine !== generation) return
        set({
          list: saved
            ? { status: 'ready', points: saved.points, source: 'cache', cachedAt: saved.cachedAt, reason }
            : { status: reason },
        })
      }
    },

    async create(scope, input) {
      const id = await service.create(scope, input)
      await get().load(scope)
      return id
    },

    async update(scope, id, input) {
      await service.update(scope, id, input)
      await get().load(scope)
    },

    reset() {
      generation += 1
      loadedKey = null
      set({ list: { status: 'idle' } })
    },
  }))
}
