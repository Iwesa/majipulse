import { z } from 'zod'
import { organizationIdSchema, uidSchema } from './common'

export const roleSchema = z.enum(['administrator', 'technician', 'reporter'])
export type Role = z.infer<typeof roleSchema>

/**
 * Custom claims on a verified ID token. Exactly these keys: any extra claim is
 * rejected so it is never silently dropped or trusted (R11.10).
 */
export const sessionClaimsSchema = z.strictObject({
  organizationId: organizationIdSchema,
  role: roleSchema,
})
export type SessionClaims = z.infer<typeof sessionClaimsSchema>

/** Scope for all local and remote data access, derived from verified claims. */
export const sessionScopeSchema = z.strictObject({
  organizationId: organizationIdSchema,
  ownerUid: uidSchema,
})
export type SessionScope = z.infer<typeof sessionScopeSchema>

/** Roles that can triage incidents, manage maintenance, and run pattern analysis. */
export const STAFF_ROLES = ['administrator', 'technician'] as const satisfies readonly Role[]

export const isStaffRole = (role: Role): boolean => (STAFF_ROLES as readonly Role[]).includes(role)
