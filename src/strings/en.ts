/**
 * All user-facing English text. Components must import text from here, never
 * hardcode it, so the app can be localized later (R12.1).
 *
 * Add keys as features need them. Values must be non-empty strings.
 */

/** A nested object whose leaves are strings. */
export type StringTree = { readonly [key: string]: string | StringTree }

export const en = {
  app: {
    name: 'MajiPulse',
    tagline: 'Water infrastructure monitoring',
    setupNotice: 'MajiPulse is being set up. Features will appear here soon.',
  },
} as const satisfies StringTree

export type Strings = typeof en
