import { z } from 'zod'

/**
 * Firebase web configuration read from VITE_* environment variables.
 * These values are identifiers, not secrets. This module does not import or
 * initialize the Firebase SDK; it only validates configuration.
 */

const nonEmpty = (name: string) =>
  z.string({ error: `${name} is missing` }).trim().min(1, { error: `${name} is missing` })

const booleanFlag = z
  .enum(['true', 'false'], { error: 'VITE_USE_EMULATORS must be "true" or "false"' })
  .optional()
  .transform((value) => value === 'true')

export const envSchema = z.object({
  VITE_FIREBASE_API_KEY: nonEmpty('VITE_FIREBASE_API_KEY'),
  VITE_FIREBASE_AUTH_DOMAIN: nonEmpty('VITE_FIREBASE_AUTH_DOMAIN'),
  VITE_FIREBASE_PROJECT_ID: nonEmpty('VITE_FIREBASE_PROJECT_ID').regex(/^[a-z0-9-]{4,30}$/, {
    error: 'VITE_FIREBASE_PROJECT_ID must be a Firebase project ID (lowercase letters, digits, dashes)',
  }),
  VITE_FIREBASE_STORAGE_BUCKET: nonEmpty('VITE_FIREBASE_STORAGE_BUCKET'),
  VITE_FIREBASE_MESSAGING_SENDER_ID: nonEmpty('VITE_FIREBASE_MESSAGING_SENDER_ID').regex(/^\d+$/, {
    error: 'VITE_FIREBASE_MESSAGING_SENDER_ID must contain digits only',
  }),
  VITE_FIREBASE_APP_ID: nonEmpty('VITE_FIREBASE_APP_ID').regex(/^\d+:\d+:web:[0-9a-f]+$/, {
    error: 'VITE_FIREBASE_APP_ID must look like 1:123:web:abc123',
  }),
  VITE_APPCHECK_SITE_KEY: nonEmpty('VITE_APPCHECK_SITE_KEY'),
  VITE_USE_EMULATORS: booleanFlag,
})

export interface AppConfig {
  firebase: {
    apiKey: string
    authDomain: string
    projectId: string
    storageBucket: string
    messagingSenderId: string
    appId: string
  }
  appCheckSiteKey: string
  useEmulators: boolean
}

export class ConfigError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n- ${issues.join('\n- ')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

/** Validates raw environment values. Pure, so it can be unit tested. */
export function parseAppConfig(env: Readonly<Record<string, unknown>>): AppConfig {
  const result = envSchema.safeParse(env)
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => issue.message))
  }
  const v = result.data
  return {
    firebase: {
      apiKey: v.VITE_FIREBASE_API_KEY,
      authDomain: v.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: v.VITE_FIREBASE_PROJECT_ID,
      storageBucket: v.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: v.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: v.VITE_FIREBASE_APP_ID,
    },
    appCheckSiteKey: v.VITE_APPCHECK_SITE_KEY,
    useEmulators: v.VITE_USE_EMULATORS,
  }
}

/**
 * Reads the config from Vite's env. Keys are listed explicitly (not the whole
 * import.meta.env object) so unrelated variables, such as the App Check debug
 * token, are never pulled into the production bundle through this module.
 */
export function loadAppConfig(): AppConfig {
  return parseAppConfig({
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
    VITE_APPCHECK_SITE_KEY: import.meta.env.VITE_APPCHECK_SITE_KEY,
    VITE_USE_EMULATORS: import.meta.env.VITE_USE_EMULATORS,
  })
}
