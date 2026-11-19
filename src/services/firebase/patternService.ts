import { doc, getDocFromServer, getDocsFromServer, type DocumentData, type Firestore } from 'firebase/firestore'
import { httpsCallable, type Functions } from 'firebase/functions'
import { documentIdSchema } from '../../schemas/common'
import { patternAnalysisSchema } from '../../schemas/patternAnalysis'
import { sessionScopeSchema, type SessionScope } from '../../schemas/roles'
import type { PatternAnalysisRecord, PatternService, RunInput } from '../patterns'
import { runResultSchema } from '../patterns'
import { analysisListPlan } from '../queryPlans'
import { StaffDataError, type StaffDataErrorKind } from '../staff'
import { plannedQuery } from './queries'
import { timestampsToIso } from './timestamps'
import { firestoreErrorKind } from './waterPointService'

const COLLECTION = 'patternAnalyses'

/** Callable error codes (functions/<code>) -> plain-language error kinds. */
export function callableErrorKind(error: unknown): StaffDataErrorKind {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
  switch (code.replace(/^functions\//, '')) {
    case 'unauthenticated':
    case 'permission-denied':
      return 'permission'
    case 'invalid-argument':
      return 'invalid'
    case 'not-found':
      return 'notFound'
    case 'unavailable':
    case 'resource-exhausted':
      return 'unavailable'
    case 'deadline-exceeded':
      return 'network'
    default:
      return 'unknown'
  }
}

function scopeOf(scope: SessionScope): SessionScope {
  const parsed = sessionScopeSchema.safeParse(scope)
  if (!parsed.success) throw new StaffDataError('invalid')
  return parsed.data
}

function parse(id: string, data: DocumentData | undefined, organizationId: string): PatternAnalysisRecord | null {
  const parsed = patternAnalysisSchema.safeParse(timestampsToIso(data))
  return parsed.success && parsed.data.organizationId === organizationId ? { id, ...parsed.data } : null
}

async function read<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (error instanceof StaffDataError) throw error
    throw new StaffDataError(firestoreErrorKind(error))
  }
}

export function createFirebasePatternService(db: Firestore, functions: Functions): PatternService {
  // Created on first run, so reading saved analyses never touches Functions.
  let analyze: ReturnType<typeof httpsCallable<RunInput, unknown>> | null = null
  return {
    async list(scope) {
      const { organizationId } = scopeOf(scope)
      const snap = await read(() => getDocsFromServer(plannedQuery(db, organizationId, analysisListPlan())))
      return snap.docs.flatMap((d) => parse(d.id, d.data(), organizationId) ?? [])
    },

    async get(scope, id) {
      const { organizationId } = scopeOf(scope)
      const parsedId = documentIdSchema.safeParse(id)
      if (!parsedId.success) return null
      const snap = await read(() => getDocFromServer(doc(db, COLLECTION, parsedId.data)))
      return snap.exists() ? parse(snap.id, snap.data(), organizationId) : null
    },

    async run(input) {
      let data: unknown
      try {
        // The function may wait up to 120 s for the model.
        analyze ??= httpsCallable<RunInput, unknown>(functions, 'analyzeIncidentPatterns', { timeout: 150_000 })
        data = (await analyze(input)).data
      } catch (error) {
        throw new StaffDataError(callableErrorKind(error))
      }
      const parsed = runResultSchema.safeParse(data)
      if (!parsed.success) throw new StaffDataError('unknown')
      return parsed.data
    },
  }
}
