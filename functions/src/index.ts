/**
 * Deployed Cloud Functions (2nd gen): administrator-only user management and
 * staff pattern analysis. The bootstrap and seed scripts are never exported.
 */
import { initializeApp } from 'firebase-admin/app'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/https'
import * as logger from 'firebase-functions/logger'
import { createAdminPorts } from './adminPorts.js'
import { createAdminAnalysisPort } from './patterns/adminAnalysisPort.js'
import { analyzeIncidentPatterns as analyzeLogic, PatternError } from './patterns/analysis.js'
import { createVertexPatternModel, DEFAULT_PATTERN_MODEL, DEFAULT_PATTERN_MODEL_LOCATION } from './patterns/vertexModel.js'
import { createOrgUser as createOrgUserLogic, setUserRole as setUserRoleLogic, UserAdminError, type Caller } from './userAdmin.js'

initializeApp()
const ports = createAdminPorts()

/** Same region as the Firestore database (africa-south1). */
const callableOptions = { region: 'africa-south1', enforceAppCheck: true } as const

const callerFrom = (request: CallableRequest): Caller | null =>
  request.auth ? { uid: request.auth.uid, token: request.auth.token } : null

async function run<T>(name: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    if (error instanceof UserAdminError || error instanceof PatternError) throw new HttpsError(error.code, error.message)
    // Log the error type only: no request data, tokens, or personal information.
    logger.error(`${name} failed`, { errorName: error instanceof Error ? error.name : typeof error })
    throw new HttpsError('internal', 'Something went wrong. Try again.')
  }
}

export const createOrgUser = onCall(callableOptions, (request) =>
  run('createOrgUser', () => createOrgUserLogic(ports, callerFrom(request), request.data)),
)

export const setUserRole = onCall(callableOptions, (request) =>
  run('setUserRole', () => setUserRoleLogic(ports, callerFrom(request), request.data)),
)

/**
 * Model settings come from the environment (functions/.env), with defaults.
 * The model location is separate from the function region: there is no
 * Gemini endpoint in africa-south1 (docs/ai-logic-notes.md).
 */
const patternPorts = {
  data: createAdminAnalysisPort(),
  model: createVertexPatternModel({
    project: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.PATTERN_MODEL_LOCATION || DEFAULT_PATTERN_MODEL_LOCATION,
    model: process.env.PATTERN_MODEL || DEFAULT_PATTERN_MODEL,
  }),
  now: () => new Date(),
  // Counts only: never descriptions, names, or tokens (S9).
  log: { info: (message: string, counts: Record<string, number>) => logger.info(message, counts) },
}

/** Staff-only cross-incident pattern analysis (T8.3, design 5B). */
export const analyzeIncidentPatterns = onCall({ ...callableOptions, timeoutSeconds: 120 }, (request) =>
  run('analyzeIncidentPatterns', () => analyzeLogic(patternPorts, callerFrom(request), request.data)),
)