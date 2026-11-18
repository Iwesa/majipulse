/** Shared setup for operator-run scripts. Never deployed. */
import { readFileSync } from 'node:fs'
import { initializeApp, type App } from 'firebase-admin/app'

export const EMULATOR_HOSTS = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
} as const

/**
 * Uses Application Default Credentials (`gcloud auth application-default login`)
 * or the emulators. Refuses service-account key files, which the project does
 * not use (security steering).
 */
export function initAdminApp(projectId: string, useEmulator: boolean): App {
  if (useEmulator) {
    for (const [key, value] of Object.entries(EMULATOR_HOSTS)) process.env[key] ??= value
  } else if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Emulator host variables are set. Pass --emulator to target the emulators, or unset them.')
  }

  const credentialsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!useEmulator && credentialsFile) {
    let type: unknown
    try {
      type = (JSON.parse(readFileSync(credentialsFile, 'utf8')) as { type?: unknown }).type
    } catch {
      type = undefined
    }
    if (type === 'service_account') {
      throw new Error(
        'GOOGLE_APPLICATION_CREDENTIALS points to a service-account key file. Unset it and run ' +
          '"gcloud auth application-default login" instead.',
      )
    }
  }
  return initializeApp({ projectId })
}

export const consoleOutput = {
  info: (message: string) => console.log(message),
  secret: (label: string, value: string) => console.log(`\n${label}:\n${value}\n`),
}
