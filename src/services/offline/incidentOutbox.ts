import { localIncidentRecordSchema, type LocalIncidentRecord } from '../../schemas/localIncident'
import { sessionScopeSchema, type SessionScope } from '../../schemas/roles'
import { IncidentOutboxError, type IncidentOutbox, type IncidentRepository } from '../incidents'
import type { MajiPulseDatabase } from './db'

const newestFirst = (a: LocalIncidentRecord, b: LocalIncidentRecord) => Date.parse(b.clientCreatedAt) - Date.parse(a.clientCreatedAt)

/** IndexedDB outbox. Opened per signed-in scope (organization and user). */
export function createIdbIncidentOutbox(database: Promise<MajiPulseDatabase>): IncidentOutbox {
  return {
    forScope(rawScope) {
      const scope: SessionScope = sessionScopeSchema.parse(rawScope)
      const range = () => IDBKeyRange.only([scope.organizationId, scope.ownerUid])
      const key = (id: string): [string, string, string] => [scope.organizationId, scope.ownerUid, id]
      const lastSyncKey = JSON.stringify(['incidentsLastSync', scope.organizationId, scope.ownerUid])

      const parse = (value: unknown): LocalIncidentRecord | null => {
        const parsed = localIncidentRecordSchema.safeParse(value)
        if (!parsed.success) return null
        const r = parsed.data
        return r.organizationId === scope.organizationId && r.ownerUid === scope.ownerUid ? r : null
      }

      /** Validates a record before writing and checks it belongs to this scope. */
      const checked = (record: LocalIncidentRecord): LocalIncidentRecord => {
        const parsed = localIncidentRecordSchema.safeParse(record)
        if (!parsed.success) throw new IncidentOutboxError('invalid')
        const r = parsed.data
        if (r.organizationId !== scope.organizationId || r.ownerUid !== scope.ownerUid) throw new IncidentOutboxError('invalid')
        return r
      }

      const repository: IncidentRepository = {
        scope,

        async list() {
          const db = await database
          const values = await db.getAllFromIndex('incidents', 'byScope', range())
          return values.map(parse).filter((r): r is LocalIncidentRecord => r !== null).sort(newestFirst)
        },

        async get(id) {
          const db = await database
          return parse(await db.get('incidents', key(id)))
        },

        async create(record) {
          const value = checked(record)
          const db = await database
          const tx = db.transaction('incidents', 'readwrite')
          if (await tx.store.get(key(value.id))) {
            tx.abort()
            await tx.done.catch(() => undefined)
            throw new IncidentOutboxError('alreadyExists')
          }
          await tx.store.add(value)
          await tx.done
        },

        async update(record) {
          const value = checked(record)
          const db = await database
          const tx = db.transaction('incidents', 'readwrite')
          if (!(await tx.store.get(key(value.id)))) {
            tx.abort()
            await tx.done.catch(() => undefined)
            throw new IncidentOutboxError('notFound')
          }
          await tx.store.put(value)
          await tx.done
        },

        async updateWith(id, change) {
          const db = await database
          const tx = db.transaction('incidents', 'readwrite')
          const current = parse(await tx.store.get(key(id)))
          let next: LocalIncidentRecord | null
          try {
            next = current ? change(current) : null
            if (next) await tx.store.put(checked(next))
          } catch (error) {
            tx.abort()
            await tx.done.catch(() => undefined)
            throw error
          }
          await tx.done
          return next
        },

        async getLastSyncAt() {
          const db = await database
          return (await db.get('meta', lastSyncKey))?.value ?? null
        },

        async setLastSyncAt(iso) {
          const db = await database
          await db.put('meta', { key: lastSyncKey, value: iso })
        },

        async resetInterruptedSyncs() {
          const db = await database
          const tx = db.transaction('incidents', 'readwrite')
          let count = 0
          let cursor = await tx.store.index('byScope').openCursor(range())
          while (cursor) {
            const record = parse(cursor.value)
            if (record?.syncStatus === 'syncing') {
              await cursor.update({ ...record, syncStatus: 'pending' })
              count += 1
            }
            cursor = await cursor.continue()
          }
          await tx.done
          return count
        },
      }
      return repository
    },
  }
}
