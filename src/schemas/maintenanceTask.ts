import { z } from 'zod'
import {
  documentIdSchema,
  isoDateTimeSchema,
  optionalText,
  organizationIdSchema,
  requiredText,
  uidSchema,
  uuidSchema,
} from './common'

export const maintenanceStatusSchema = z.enum(['open', 'in_progress', 'done'])
export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>

/** Allowed maintenance task transitions (R8.2). */
export const MAINTENANCE_STATUS_TRANSITIONS = {
  open: ['in_progress'],
  in_progress: ['done'],
  done: [],
} as const satisfies Record<MaintenanceStatus, readonly MaintenanceStatus[]>

export const isAllowedMaintenanceTransition = (from: MaintenanceStatus, to: MaintenanceStatus): boolean =>
  (MAINTENANCE_STATUS_TRANSITIONS[from] as readonly MaintenanceStatus[]).includes(to)

/** `maintenanceTasks/{taskId}`. The assignee's organization is checked by rules. */
export const maintenanceTaskSchema = z.strictObject({
  organizationId: organizationIdSchema,
  waterPointId: documentIdSchema,
  incidentId: uuidSchema.nullable(),
  title: requiredText(120),
  notes: optionalText(2000),
  status: maintenanceStatusSchema,
  assigneeId: uidSchema.nullable(),
  createdBy: uidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  demo: z.boolean(),
})
export type MaintenanceTask = z.infer<typeof maintenanceTaskSchema>
