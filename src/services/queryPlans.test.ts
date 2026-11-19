// Every staff query has a composite index (T7.1). The Firestore emulator
// does not enforce indexes, so this test is what keeps firestore.indexes.json
// in step with the queries the services build.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import indexFile from '../../firestore.indexes.json'
import { incidentStatusSchema } from '../schemas/incident'
import { maintenanceStatusSchema } from '../schemas/maintenanceTask'
import {
  incidentCountPlan,
  incidentQueuePlan,
  taskCountPlan,
  taskListPlan,
  tasksForIncidentPlan,
  type IncidentQueueFilter,
  type QueryPlan,
} from './queryPlans'

const indexFileSchema = z.object({
  indexes: z.array(
    z.object({
      collectionGroup: z.string(),
      queryScope: z.literal('COLLECTION'),
      fields: z.array(z.object({ fieldPath: z.string(), order: z.enum(['ASCENDING', 'DESCENDING']) })).min(2),
    }),
  ),
  fieldOverrides: z.array(z.unknown()),
})
const indexes = indexFileSchema.parse(indexFile).indexes

/** Index fields a plan needs: organizationId and the equality fields (ascending, any order), then the sort field. */
function hasIndex(plan: QueryPlan, among: typeof indexes = indexes): boolean {
  const equality = ['organizationId', ...plan.equals.map(([field]) => field)]
  return among.some((index) => {
    if (index.collectionGroup !== plan.collection) return false
    const fields = [...index.fields]
    if (plan.orderBy) {
      const last = fields.pop()
      if (last?.fieldPath !== plan.orderBy[0] || last.order !== (plan.orderBy[1] === 'asc' ? 'ASCENDING' : 'DESCENDING')) return false
    }
    if (fields[0]?.fieldPath !== 'organizationId') return false
    return fields.length === equality.length && fields.every((f) => f.order === 'ASCENDING' && equality.includes(f.fieldPath))
  })
}

const queueFilters: IncidentQueueFilter[] = []
for (const status of [null, ...incidentStatusSchema.options]) {
  for (const waterPointId of [null, 'wp-1']) {
    for (const order of ['newest', 'oldest'] as const) queueFilters.push({ status, waterPointId, order })
  }
}

describe('composite indexes (T7.1)', () => {
  it.each(queueFilters.map((f) => [JSON.stringify(f), f] as const))('incident queue %s', (_label, filter) => {
    expect(hasIndex(incidentQueuePlan(filter))).toBe(true)
  })

  it.each([null, ...maintenanceStatusSchema.options])('task list, status %s', (status) => {
    expect(hasIndex(taskListPlan({ status }))).toBe(true)
  })

  it('tasks linked to an incident', () => {
    expect(hasIndex(tasksForIncidentPlan('3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f'))).toBe(true)
  })

  it.each(incidentStatusSchema.options)('incident count, status %s', (status) => {
    expect(hasIndex(incidentCountPlan(status))).toBe(true)
  })

  it.each(maintenanceStatusSchema.options)('task count, status %s', (status) => {
    expect(hasIndex(taskCountPlan(status))).toBe(true)
  })

  it('has no unused or duplicate indexes', () => {
    const plans: QueryPlan[] = [
      ...queueFilters.map(incidentQueuePlan),
      ...[null, ...maintenanceStatusSchema.options].map((status) => taskListPlan({ status })),
      tasksForIncidentPlan('x'),
      ...incidentStatusSchema.options.map(incidentCountPlan),
      ...maintenanceStatusSchema.options.map(taskCountPlan),
    ]
    const keys = indexes.map((i) => `${i.collectionGroup}:${i.fields.map((f) => `${f.fieldPath}:${f.order}`).join(',')}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const index of indexes) {
      expect(plans.some((plan) => hasIndex(plan, [index])), JSON.stringify(index.fields)).toBe(true)
    }
  })

  it('plans keep the requested filters and limit', () => {
    expect(incidentQueuePlan({ status: 'triaged', waterPointId: 'wp-1', order: 'oldest' })).toEqual({
      collection: 'incidents',
      equals: [
        ['status', 'triaged'],
        ['waterPointId', 'wp-1'],
      ],
      orderBy: ['createdAt', 'asc'],
      limit: 100,
    })
  })
})
