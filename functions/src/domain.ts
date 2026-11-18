import { z } from 'zod'

/**
 * Server-side copies of the client's role and ID rules (src/schemas). A root
 * test asserts they stay identical, because the functions package cannot
 * import client source.
 */
export const ROLES = ['administrator', 'technician', 'reporter'] as const
export const roleSchema = z.enum(ROLES)
export type Role = z.infer<typeof roleSchema>

export const ORGANIZATION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/
export const organizationIdSchema = z.string().regex(ORGANIZATION_ID_PATTERN)

export const uidSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((id) => !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id))

export const emailSchema = z.email().max(254)
export const displayNameSchema = z.string().trim().min(1).max(100)

/** Inputs of the administrator-only callables. Strict: unknown keys are rejected. */
export const createOrgUserInputSchema = z.strictObject({
  email: emailSchema,
  displayName: displayNameSchema,
  // Administrators are created only by the bootstrap or promoted with setUserRole.
  role: z.enum(['technician', 'reporter']),
})
export type CreateOrgUserInput = z.infer<typeof createOrgUserInputSchema>

export const setUserRoleInputSchema = z.strictObject({
  targetUid: uidSchema,
  role: roleSchema,
})
export type SetUserRoleInput = z.infer<typeof setUserRoleInputSchema>

export const CLAIM_KEYS = ['organizationId', 'role'] as const

/** The only custom-claims shape MajiPulse ever sets. */
export function orgClaims(organizationId: string, role: Role): { organizationId: string; role: Role } {
  return { organizationId, role }
}

export function hasNoClaims(claims: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(claims).length === 0
}

/** True when claims are exactly `{ organizationId, role }` with the given values. */
export function claimsEqual(
  claims: Readonly<Record<string, unknown>>,
  expected: { organizationId: string; role: Role },
): boolean {
  const keys = Object.keys(claims).sort()
  return (
    keys.length === 2 &&
    keys[0] === 'organizationId' &&
    keys[1] === 'role' &&
    claims.organizationId === expected.organizationId &&
    claims.role === expected.role
  )
}

/** True when claims contain only MajiPulse keys (no unrelated claims). */
export function hasOnlyOrgClaimKeys(claims: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(claims)
  return keys.length === CLAIM_KEYS.length && CLAIM_KEYS.every((key) => keys.includes(key))
}
