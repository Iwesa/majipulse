import { z } from 'zod'
import { isoDateTimeSchema, organizationIdSchema, requiredText, uidSchema } from './common'

export const waterPointTypeSchema = z.enum(['borehole', 'handpump', 'kiosk', 'tap', 'other'])
export const waterPointStatusSchema = z.enum(['working', 'needs_repair', 'not_working', 'unknown'])

/** `waterPoints/{waterPointId}`. No coordinates in the MVP. */
export const waterPointSchema = z.strictObject({
  organizationId: organizationIdSchema,
  name: requiredText(120),
  type: waterPointTypeSchema,
  locationDescription: requiredText(500),
  ward: requiredText(80).optional(),
  status: waterPointStatusSchema,
  demo: z.boolean(),
  createdBy: uidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})
export type WaterPoint = z.infer<typeof waterPointSchema>

/** Fields a staff member enters. Everything else is set by the service. */
export const waterPointInputSchema = waterPointSchema.pick({
  name: true,
  type: true,
  locationDescription: true,
  ward: true,
  status: true,
})
export type WaterPointInput = z.infer<typeof waterPointInputSchema>

/** A water point with its Firestore document ID. */
export type WaterPointRecord = WaterPoint & { id: string }
