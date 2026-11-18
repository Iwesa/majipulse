import { documentIdSchema, isoDateTimeSchema, uidSchema } from '../../schemas/common'
import { sessionScopeSchema, type SessionScope } from '../../schemas/roles'
import { waterPointSchema, type WaterPointRecord } from '../../schemas/waterPoint'
import { sortByName, type WaterPointCache } from '../waterPoints'
import type { MajiPulseDatabase } from './db'

/** A cached record: the water point plus its scope and when it was saved. */
const cachedRecordSchema = waterPointSchema.extend({
  id: documentIdSchema,
  ownerUid: uidSchema,
  cachedAt: isoDateTimeSchema,
})

const metaKey = (scope: SessionScope) => JSON.stringify(['waterPoints', scope.organizationId, scope.ownerUid])

/**
 * IndexedDB cache scoped by organization AND signed-in user. A user can only
 * read records saved under their own scope, so switching accounts on a shared
 * device never shows another account's copy (R3.6, S11).
 */
export function createIdbWaterPointCache(database: Promise<MajiPulseDatabase>): WaterPointCache {
  return {
    async read(rawScope) {
      const scope = sessionScopeSchema.parse(rawScope)
      const db = await database
      const meta = await db.get('meta', metaKey(scope))
      if (!meta) return null
      const values = await db.getAllFromIndex('waterPointsCache', 'byScope', IDBKeyRange.only([scope.organizationId, scope.ownerUid]))
      const points: WaterPointRecord[] = []
      for (const value of values) {
        const parsed = cachedRecordSchema.safeParse(value)
        if (!parsed.success) continue
        const { ownerUid, cachedAt: _cachedAt, ...point } = parsed.data
        void _cachedAt
        if (ownerUid === scope.ownerUid && point.organizationId === scope.organizationId) points.push(point)
      }
      return { points: sortByName(points), cachedAt: meta.value }
    },

    async replace(rawScope, points, cachedAt) {
      const scope = sessionScopeSchema.parse(rawScope)
      isoDateTimeSchema.parse(cachedAt)
      // Only this scope's own organization's records are ever written.
      const records = points
        .filter((p) => p.organizationId === scope.organizationId)
        .map((p) => ({ ...p, ownerUid: scope.ownerUid, cachedAt }))
      const db = await database
      const tx = db.transaction(['waterPointsCache', 'meta'], 'readwrite')
      const store = tx.objectStore('waterPointsCache')
      let cursor = await store.index('byScope').openCursor(IDBKeyRange.only([scope.organizationId, scope.ownerUid]))
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
      for (const record of records) await store.put(record)
      await tx.objectStore('meta').put({ key: metaKey(scope), value: cachedAt })
      await tx.done
    },
  }
}
