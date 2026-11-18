import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export const DB_NAME = 'majipulse'
/**
 * Version history (each step is applied in order on upgrade):
 *   1  waterPointsCache, meta            (Phase 3)
 *   2  incidents (local outbox)          (Phase 4)
 */
export const DB_VERSION = 2

export interface CachedWaterPointValue {
  id: string
  organizationId: string
  ownerUid: string
  cachedAt: string
  [field: string]: unknown
}

/** Stored shape; validated with localIncidentRecordSchema on every read. */
export interface StoredIncidentValue {
  id: string
  organizationId: string
  ownerUid: string
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
  incidents: {
    /** [organizationId, ownerUid, incidentId] */
    key: [string, string, string]
    value: StoredIncidentValue
    indexes: { byScope: [string, string] }
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
      if (oldVersion < 2) {
        // Additive only: existing water point cache and meta are kept.
        const incidents = db.createObjectStore('incidents', { keyPath: ['organizationId', 'ownerUid', 'id'] })
        incidents.createIndex('byScope', ['organizationId', 'ownerUid'])
      }
    },
  })
}
