import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export const DB_NAME = 'majipulse'
/** Bump with an upgrade step when stores change (the incident outbox arrives in Phase 4). */
export const DB_VERSION = 1

export interface CachedWaterPointValue {
  id: string
  organizationId: string
  ownerUid: string
  cachedAt: string
  [field: string]: unknown
}

export interface MajiPulseDB extends DBSchema {
  waterPointsCache: {
    /** [organizationId, ownerUid, waterPointId] */
    key: [string, string, string]
    value: CachedWaterPointValue
    indexes: { byScope: [string, string] }
  }
  meta: {
    key: string
    value: { key: string; value: string }
  }
}

export type MajiPulseDatabase = IDBPDatabase<MajiPulseDB>

export function openMajiPulseDb(name: string = DB_NAME): Promise<MajiPulseDatabase> {
  return openDB<MajiPulseDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const cache = db.createObjectStore('waterPointsCache', { keyPath: ['organizationId', 'ownerUid', 'id'] })
        cache.createIndex('byScope', ['organizationId', 'ownerUid'])
        db.createObjectStore('meta', { keyPath: 'key' })
      }
    },
  })
}
