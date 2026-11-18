import {
  collection,
  deleteField,
  doc,
  getDocsFromServer,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore'
import { sessionScopeSchema } from '../../schemas/roles'
import { waterPointInputSchema, waterPointSchema, type WaterPointInput, type WaterPointRecord } from '../../schemas/waterPoint'
import { sortByName, WaterPointServiceError, type WaterPointErrorKind, type WaterPointService } from '../waterPoints'
import { orgScopedQuery } from './queries'
import { timestampsToIso } from './timestamps'

const COLLECTION = 'waterPoints'

export function firestoreErrorKind(error: unknown): WaterPointErrorKind {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
  switch (code) {
    case 'permission-denied':
    case 'unauthenticated':
      return 'permission'
    case 'unavailable':
    case 'deadline-exceeded':
      return 'network'
    case 'not-found':
      return 'notFound'
    case 'invalid-argument':
      return 'invalid'
    default:
      return 'unknown'
  }
}

async function run<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (error instanceof WaterPointServiceError) throw error
    throw new WaterPointServiceError(firestoreErrorKind(error))
  }
}

function parseScope(scope: unknown) {
  const parsed = sessionScopeSchema.safeParse(scope)
  if (!parsed.success) throw new WaterPointServiceError('invalid')
  return parsed.data
}

function parseInput(input: WaterPointInput): WaterPointInput {
  const parsed = waterPointInputSchema.safeParse(input)
  if (!parsed.success) throw new WaterPointServiceError('invalid')
  return parsed.data
}

/** Firestore rejects undefined values, so the optional ward is only written when set. */
const inputFields = (input: WaterPointInput) => ({
  name: input.name,
  type: input.type,
  locationDescription: input.locationDescription,
  status: input.status,
  ...(input.ward !== undefined ? { ward: input.ward } : {}),
})

export function createFirebaseWaterPointService(db: Firestore): WaterPointService {
  return {
    async list(scope) {
      const { organizationId } = parseScope(scope)
      // From the server only: when offline this fails instead of returning a
      // possibly empty memory cache, so the store can fall back to IndexedDB.
      const snap = await run(() => getDocsFromServer(orgScopedQuery(db, COLLECTION, organizationId)))
      const points: WaterPointRecord[] = []
      for (const docSnap of snap.docs) {
        const parsed = waterPointSchema.safeParse(timestampsToIso(docSnap.data()))
        // Invalid or foreign records are skipped, never shown.
        if (parsed.success && parsed.data.organizationId === organizationId) points.push({ id: docSnap.id, ...parsed.data })
      }
      return sortByName(points)
    },

    async create(scope, input) {
      const { organizationId, ownerUid } = parseScope(scope)
      const fields = inputFields(parseInput(input))
      const ref = doc(collection(db, COLLECTION))
      // A transaction fails when offline instead of queuing the write.
      await run(() =>
        runTransaction(db, async (tx) => {
          tx.set(ref, {
            organizationId,
            ...fields,
            demo: false,
            createdBy: ownerUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        }),
      )
      return ref.id
    },

    async update(scope, id, input) {
      const { organizationId } = parseScope(scope)
      const data = parseInput(input)
      const ref = doc(db, COLLECTION, id)
      await run(() =>
        runTransaction(db, async (tx) => {
          const snap = await tx.get(ref)
          if (!snap.exists() || snap.data().organizationId !== organizationId) throw new WaterPointServiceError('notFound')
          tx.update(ref, {
            name: data.name,
            type: data.type,
            locationDescription: data.locationDescription,
            status: data.status,
            ward: data.ward ?? deleteField(),
            updatedAt: serverTimestamp(),
          })
        }),
      )
    },
  }
}
