import { z } from 'zod'

/**
 * Shared primitives for MajiPulse schemas.
 *
 * Timestamps are ISO 8601 strings with an explicit offset (for example
 * `2026-03-12T08:30:00Z`). The Firebase service layer converts Firestore
 * Timestamps to and from this form, so every layer shares one representation.
 */

/** Firestore document ID rules: 1 to 128 chars, no `/`, not `.` or `..`, not `__x__`. */
export const documentIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((id) => !id.includes('/'), { error: 'Document IDs cannot contain "/"' })
  .refine((id) => id !== '.' && id !== '..', { error: 'Document IDs cannot be "." or ".."' })
  .refine((id) => !/^__.*__$/.test(id), { error: 'Document IDs cannot match __.*__' })

/** Firebase Auth UID. Same constraints as a document ID (used as `members/{uid}`). */
export const uidSchema = documentIdSchema

/** Organization IDs are chosen at bootstrap: lowercase letters, digits, and dashes. */
export const organizationIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/, {
    error: 'Organization IDs use 3 to 64 lowercase letters, digits, or dashes, starting and ending with a letter or digit',
  })

/** Client-generated UUIDs (incident IDs, mutation IDs). */
export const uuidSchema = z.uuid()

export const isoDateTimeSchema = z.iso.datetime({ offset: true })

/** A trimmed, non-empty string with a maximum length. */
export const requiredText = (max: number) => z.string().trim().min(1).max(max)

/** A trimmed string that may be empty, with a maximum length. */
export const optionalText = (max: number) => z.string().trim().max(max)

/** Non-negative integer revision counter. */
export const revisionSchema = z.int().min(0)

/** Array of unique values. */
export const uniqueArray = <T extends z.ZodType>(item: T) =>
  z.array(item).refine((values) => new Set(values).size === values.length, {
    error: 'Values must be unique',
  })

/** Compare two ISO timestamps. Assumes both already passed `isoDateTimeSchema`. */
export const isNotAfter = (a: string, b: string): boolean => Date.parse(a) <= Date.parse(b)

export const periodSchema = z
  .strictObject({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  })
  .refine((p) => isNotAfter(p.from, p.to), { error: 'Period start must not be after its end', path: ['to'] })

export type Period = z.infer<typeof periodSchema>
