/**
 * Deployed Cloud Functions (2nd gen). Only administrator-only user management
 * lives here in Phase 2. The bootstrap and seed scripts are never exported.
 */
import { initializeApp } from 'firebase-admin/app'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/https'
import * as logger from 'firebase-functions/logger'
import { createAdminPorts } from './adminPorts.js'
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
    if (error instanceof UserAdminError) throw new HttpsError(error.code, error.message)
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
