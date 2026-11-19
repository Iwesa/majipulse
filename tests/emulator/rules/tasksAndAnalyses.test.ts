// maintenanceTasks and patternAnalyses (T2.12).
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { INCIDENT_A, INCIDENT_B, ORG_A, ORG_B, T, UID, WP_A, WP_B, as, createEnv, dbOf, seed, waterPoint } from './setup'

const WP_A2 = 'wp-a-second'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await createEnv()
})
beforeEach(async () => {
  await seed(env)
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(dbOf(ctx), 'maintenanceTasks', 'task-a'), {
      organizationId: ORG_A,
      waterPointId: WP_A,
      incidentId: INCIDENT_A,
      title: 'Inspect handpump',
      notes: '',
      status: 'open',
      assigneeId: null,
      createdBy: UID.adminA,
      createdAt: T,
      updatedAt: T,
      demo: false,
    })
    await setDoc(doc(dbOf(ctx), 'patternAnalyses', 'analysis-a'), { organizationId: ORG_A, insights: [] })
    await setDoc(doc(dbOf(ctx), 'waterPoints', WP_A2), waterPoint(ORG_A, UID.adminA))
  })
})
afterAll(async () => {
  await env.cleanup()
})

const newTask = (createdBy: string, overrides: Record<string, unknown> = {}) => ({
  organizationId: ORG_A,
  waterPointId: WP_A,
  incidentId: INCIDENT_A,
  title: 'Replace seal',
  notes: '',
  status: 'open',
  assigneeId: UID.techA,
  createdBy,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  demo: false,
  ...overrides,
})

describe('maintenanceTasks', () => {
  it('staff create tasks in their organization, assigned to staff in the same organization', async () => {
    await assertSucceeds(setDoc(doc(as(env, UID.adminA), 'maintenanceTasks', 'task-1'), newTask(UID.adminA)))
    await assertSucceeds(setDoc(doc(as(env, UID.techA), 'maintenanceTasks', 'task-2'), newTask(UID.techA, { assigneeId: null, incidentId: null })))
  })
  it('an unlinked task may use any water point of the organization (T7.3)', async () => {
    await assertSucceeds(setDoc(doc(as(env, UID.techA), 'maintenanceTasks', 'task-3'), newTask(UID.techA, { waterPointId: WP_A2, incidentId: null, assigneeId: null })))
  })
  it('reporters cannot read or create tasks', async () => {
    await assertFails(getDoc(doc(as(env, UID.reporterA), 'maintenanceTasks', 'task-a')))
    await assertFails(setDoc(doc(as(env, UID.reporterA), 'maintenanceTasks', 'task-1'), newTask(UID.reporterA)))
  })
  it.each([
    ['an assignee in another organization', { assigneeId: UID.adminB }],
    ['a reporter as assignee', { assigneeId: UID.reporterA }],
    ['an inactive assignee', { assigneeId: UID.inactive }],
    ['an unknown assignee', { assigneeId: 'uid-nobody' }],
    ['an incident in another organization', { incidentId: INCIDENT_B }],
    ['a water point in another organization', { waterPointId: WP_B }],
    ['a linked incident on a different water point (T7.3)', { waterPointId: WP_A2 }],
    ['another organization', { organizationId: ORG_B }],
    ['a non-open status', { status: 'done' }],
    ['a forged creator', { createdBy: UID.techA }],
  ])('denies %s', async (_label, overrides) => {
    await assertFails(setDoc(doc(as(env, UID.adminA), 'maintenanceTasks', 'task-bad'), newTask(UID.adminA, overrides)))
  })
  it('staff list with an organization filter; unscoped and cross-org queries are denied', async () => {
    const tasks = collection(as(env, UID.techA), 'maintenanceTasks')
    await assertSucceeds(getDocs(query(tasks, where('organizationId', '==', ORG_A))))
    await assertFails(getDocs(tasks))
    await assertFails(getDocs(query(collection(as(env, UID.adminB), 'maintenanceTasks'), where('organizationId', '==', ORG_A))))
  })
  it('allows open -> in_progress -> done and denies skips and reversals', async () => {
    const db = as(env, UID.techA)
    const ref = doc(db, 'maintenanceTasks', 'task-a')
    await assertFails(updateDoc(ref, { status: 'done', updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(ref, { status: 'in_progress', assigneeId: UID.techA, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { status: 'open', updatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(ref, { status: 'done', updatedAt: serverTimestamp() }))
  })
  it('denies changing immutable fields', async () => {
    const ref = doc(as(env, UID.adminA), 'maintenanceTasks', 'task-a')
    await assertFails(updateDoc(ref, { organizationId: ORG_B, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { waterPointId: 'wp-other', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { createdBy: UID.techA, updatedAt: serverTimestamp() }))
  })
})

describe('patternAnalyses', () => {
  it('staff read their organization’s analyses; reporters and other organizations cannot', async () => {
    await assertSucceeds(getDoc(doc(as(env, UID.techA), 'patternAnalyses', 'analysis-a')))
    await assertFails(getDoc(doc(as(env, UID.reporterA), 'patternAnalyses', 'analysis-a')))
    await assertFails(getDoc(doc(as(env, UID.adminB), 'patternAnalyses', 'analysis-a')))
  })
  it('clients never write analyses', async () => {
    await assertFails(setDoc(doc(as(env, UID.adminA), 'patternAnalyses', 'analysis-new'), { organizationId: ORG_A, insights: [] }))
    await assertFails(updateDoc(doc(as(env, UID.adminA), 'patternAnalyses', 'analysis-a'), { insights: [] }))
  })
})
