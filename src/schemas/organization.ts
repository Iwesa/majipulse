import { z } from 'zod'
import { isoDateTimeSchema, organizationIdSchema, requiredText, uidSchema } from './common'
import { roleSchema } from './roles'

export const bootstrapStatusSchema = z.enum(['in_progress', 'complete'])

export const bootstrapStateSchema = z
  .strictObject({
    status: bootstrapStatusSchema,
    adminUid: uidSchema.optional(),
    userCreatedByBootstrap: z.boolean().optional(),
    startedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.status === 'complete') {
      if (!b.adminUid) ctx.addIssue({ code: 'custom', message: 'A complete bootstrap needs adminUid', path: ['adminUid'] })
      if (!b.completedAt) ctx.addIssue({ code: 'custom', message: 'A complete bootstrap needs completedAt', path: ['completedAt'] })
    }
    if (b.status === 'in_progress' && b.completedAt) {
      ctx.addIssue({ code: 'custom', message: 'An in-progress bootstrap cannot have completedAt', path: ['completedAt'] })
    }
    if (b.completedAt && Date.parse(b.completedAt) < Date.parse(b.startedAt)) {
      ctx.addIssue({ code: 'custom', message: 'completedAt must not be before startedAt', path: ['completedAt'] })
    }
  })

/** `organizations/{organizationId}`. Written only by Admin SDK code. */
export const organizationSchema = z.strictObject({
  name: requiredText(120),
  county: requiredText(80),
  demo: z.boolean(),
  createdAt: isoDateTimeSchema,
  createdBy: uidSchema,
  bootstrap: bootstrapStateSchema,
})
export type Organization = z.infer<typeof organizationSchema>

/** `members/{uid}`. Written only by Admin SDK code. Mirrors the custom claims. */
export const memberSchema = z.strictObject({
  organizationId: organizationIdSchema,
  role: roleSchema,
  email: z.email().max(254),
  displayName: requiredText(100),
  active: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})
export type Member = z.infer<typeof memberSchema>
