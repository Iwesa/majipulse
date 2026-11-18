import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { ORG_A, ORG_B, UID, WP_A, anonymous, as, createEnv, seed, withClaims } from './setup'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await createEnv()
})
beforeEach(async () => {
  await seed(env)
})
afterAll(async () => {
  await env.cleanup()
})

describe('organizations', () => {
  it('members read their own organization', async () => {
    for (const uid of [UID.adminA, UID.techA, UID.reporterA]) {
      await assertSucceeds(getDoc(doc(as(env, uid), 'organizations', ORG_A)))
    }
  })
  it('denies another organization, anonymous users, list, and every client write', async () => {
    await assertFails(getDoc(doc(as(env, UID.adminA), 'organizations', ORG_B)))
    await assertFails(getDoc(doc(anonymous(env), 'organizations', ORG_A)))
    await assertFails(getDocs(collection(as(env, UID.adminA), 'organizations')))
    await assertFails(setDoc(doc(as(env, UID.adminA), 'organizations', 'new-org'), { name: 'x' }))
    await assertFails(updateDoc(doc(as(env, UID.adminA), 'organizations', ORG_A), { name: 'changed' }))
    await assertFails(deleteDoc(doc(as(env, UID.adminA), 'organizations', ORG_A)))
  })
})

describe('isMember: claims and an active, matching member document are both required (R11.8)', () => {
  const read = (db: ReturnType<typeof as>) => getDoc(doc(db, 'waterPoints', WP_A))

  it('allows an active member with matching claims', async () => {
    await assertSucceeds(read(as(env, UID.reporterA)))
  })
  it('denies claims without a member document', async () => {
    await assertFails(read(as(env, UID.claimsOnly)))
  })
  it('denies an inactive member', async () => {
    await assertFails(read(as(env, UID.inactive)))
  })
  it('denies claims whose role does not match the member document', async () => {
    await assertFails(read(as(env, UID.mismatch)))
  })
  it('denies a member document without claims', async () => {
    await assertFails(read(withClaims(env, UID.reporterA, {})))
  })
  it('denies claims for an organization the member document does not belong to', async () => {
    await assertFails(read(withClaims(env, UID.reporterA, { organizationId: ORG_B, role: 'reporter' })))
  })
  it('denies an unknown role claim', async () => {
    await assertFails(read(withClaims(env, UID.adminA, { organizationId: ORG_A, role: 'owner' })))
  })
  it('denies anonymous users', async () => {
    await assertFails(read(anonymous(env)))
  })
})

describe('members', () => {
  it('any signed-in user can read their own member document, even if inactive', async () => {
    await assertSucceeds(getDoc(doc(as(env, UID.reporterA), 'members', UID.reporterA)))
    await assertSucceeds(getDoc(doc(as(env, UID.inactive), 'members', UID.inactive)))
  })
  it('reporters and technicians cannot read other members', async () => {
    await assertFails(getDoc(doc(as(env, UID.reporterA), 'members', UID.adminA)))
    await assertFails(getDoc(doc(as(env, UID.techA), 'members', UID.reporterA)))
  })
  it('administrators read and list their own organization’s members only', async () => {
    const db = as(env, UID.adminA)
    await assertSucceeds(getDoc(doc(db, 'members', UID.reporterA)))
    await assertSucceeds(getDocs(query(collection(db, 'members'), where('organizationId', '==', ORG_A))))
    await assertFails(getDoc(doc(db, 'members', UID.reporterB)))
    await assertFails(getDocs(query(collection(db, 'members'), where('organizationId', '==', ORG_B))))
  })
  it('denies an unscoped members query (rules are not filters)', async () => {
    await assertFails(getDocs(collection(as(env, UID.adminA), 'members')))
  })
  it('denies every client write, including to the caller’s own document', async () => {
    const db = as(env, UID.adminA)
    await assertFails(updateDoc(doc(db, 'members', UID.adminA), { active: true }))
    await assertFails(updateDoc(doc(as(env, UID.reporterA), 'members', UID.reporterA), { role: 'administrator' }))
    await assertFails(setDoc(doc(db, 'members', 'uid-new'), { organizationId: ORG_A, role: 'reporter' }))
    await assertFails(deleteDoc(doc(db, 'members', UID.reporterA)))
  })
})

describe('default deny', () => {
  it('denies unknown collections', async () => {
    await assertFails(getDoc(doc(as(env, UID.adminA), 'secrets', 'x')))
    await assertFails(setDoc(doc(as(env, UID.adminA), 'anything', 'x'), { a: 1 }))
  })
})
