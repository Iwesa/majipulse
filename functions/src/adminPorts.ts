/** Admin SDK implementations of the provisioning ports. */
import type { App } from 'firebase-admin/app'
import { getAuth, type UserRecord } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import type { Role } from './domain.js'
import {
  AlreadyExistsError,
  type AuthPort,
  type AuthUser,
  type BootstrapState,
  type MemberRecord,
  type OrganizationRecord,
  type Ports,
  type StorePort,
} from './ports.js'

const errorCode = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined

const isUserNotFound = (error: unknown) => errorCode(error) === 'auth/user-not-found'

// Firestore ALREADY_EXISTS is gRPC status 6.
const isAlreadyExists = (error: unknown) => errorCode(error) === 6

const toAuthUser = (user: UserRecord): AuthUser => ({
  uid: user.uid,
  email: user.email,
  customClaims: user.customClaims ?? {},
})

export function createAdminPorts(app?: App): Ports {
  const auth = getAuth(app)
  const db = app ? getFirestore(app) : getFirestore()
  const members = db.collection('members')
  const organizations = db.collection('organizations')

  const authPort: AuthPort = {
    async findUserByEmail(email) {
      try {
        return toAuthUser(await auth.getUserByEmail(email))
      } catch (error) {
        if (isUserNotFound(error)) return null
        throw error
      }
    },
    async getUser(uid) {
      try {
        return toAuthUser(await auth.getUser(uid))
      } catch (error) {
        if (isUserNotFound(error)) return null
        throw error
      }
    },
    async createUser({ email, displayName }) {
      return toAuthUser(await auth.createUser({ email, displayName, emailVerified: false, disabled: false }))
    },
    async setClaims(uid, claims) {
      await auth.setCustomUserClaims(uid, claims === null ? null : { ...claims })
    },
    async deleteUser(uid) {
      await auth.deleteUser(uid)
    },
    async passwordResetLink(email) {
      return auth.generatePasswordResetLink(email)
    },
  }

  const storePort: StorePort = {
    async getMember(uid) {
      const snap = await members.doc(uid).get()
      if (!snap.exists) return null
      const d = snap.data() ?? {}
      return {
        organizationId: String(d.organizationId),
        role: d.role as Role,
        email: String(d.email),
        displayName: String(d.displayName),
        active: d.active === true,
      }
    },
    async createMember(uid, member: MemberRecord) {
      try {
        await members.doc(uid).create({
          ...member,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      } catch (error) {
        if (isAlreadyExists(error)) throw new AlreadyExistsError(`members/${uid}`)
        throw error
      }
    },
    async setMemberRole(uid, role) {
      await members.doc(uid).update({ role, updatedAt: FieldValue.serverTimestamp() })
    },
    async deleteMember(uid) {
      await members.doc(uid).delete()
    },
    async listMemberUids(organizationId) {
      const snap = await members.where('organizationId', '==', organizationId).select().get()
      return snap.docs.map((doc) => doc.id)
    },
    async getOrganization(organizationId) {
      const snap = await organizations.doc(organizationId).get()
      if (!snap.exists) return null
      const d = snap.data() ?? {}
      const b = (d.bootstrap ?? {}) as Record<string, unknown>
      const bootstrap: BootstrapState = { status: b.status === 'complete' ? 'complete' : 'in_progress' }
      if (typeof b.adminUid === 'string') bootstrap.adminUid = b.adminUid
      if (typeof b.userCreatedByBootstrap === 'boolean') bootstrap.userCreatedByBootstrap = b.userCreatedByBootstrap
      return { name: String(d.name), county: String(d.county), demo: d.demo === true, bootstrap }
    },
    async createOrganization(organizationId, organization: OrganizationRecord) {
      try {
        await organizations.doc(organizationId).create({
          name: organization.name,
          county: organization.county,
          demo: organization.demo,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'bootstrap-script',
          bootstrap: { ...organization.bootstrap, startedAt: FieldValue.serverTimestamp() },
        })
      } catch (error) {
        if (isAlreadyExists(error)) throw new AlreadyExistsError(`organizations/${organizationId}`)
        throw error
      }
    },
    async updateBootstrap(organizationId, patch) {
      const update: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(patch)) update[`bootstrap.${key}`] = value
      if (patch.status === 'complete') update['bootstrap.completedAt'] = FieldValue.serverTimestamp()
      await organizations.doc(organizationId).update(update)
    },
    async deleteOrganization(organizationId) {
      await organizations.doc(organizationId).delete()
    },
  }

  return { auth: authPort, store: storePort }
}
