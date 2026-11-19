/** Admin SDK implementation of the pattern analysis data port. */
import type { App } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { z } from 'zod'
import { roleSchema } from '../domain.js'
import type { AnalysisDataPort } from './analysis.js'
import type { AnalyzedIncident } from './prompt.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Only the fields analysis needs. Identity fields are never read into memory here. */
const incidentFieldsSchema = z.object({
  organizationId: z.string(),
  waterPointId: z.string().min(1).max(128),
  incidentType: z.string().min(1).max(64),
  severity: z.string().max(16).nullable(),
  status: z.string().min(1).max(32),
  description: z.string().max(2000),
  createdAt: z.instanceof(Timestamp),
  demo: z.boolean(),
})

const memberSchema = z.object({
  organizationId: z.string(),
  role: roleSchema,
  email: z.string(),
  displayName: z.string(),
  active: z.boolean(),
})

export function createAdminAnalysisPort(app?: App): AnalysisDataPort {
  const db = app ? getFirestore(app) : getFirestore()
  return {
    async getMember(uid) {
      const snap = await db.collection('members').doc(uid).get()
      const parsed = memberSchema.safeParse(snap.data())
      return snap.exists && parsed.success ? parsed.data : null
    },

    async organizationIsDemo(organizationId) {
      const snap = await db.collection('organizations').doc(organizationId).get()
      return snap.get('demo') === true
    },

    async waterPointNames(organizationId) {
      const snap = await db.collection('waterPoints').where('organizationId', '==', organizationId).get()
      const names = new Map<string, string>()
      for (const doc of snap.docs) {
        const name = doc.get('name')
        if (typeof name === 'string') names.set(doc.id, name)
      }
      return names
    },

    async listIncidents(organizationId, period, waterPointId, limit) {
      // Uses the composite indexes (organizationId[, waterPointId], createdAt desc) in firestore.indexes.json.
      let query = db
        .collection('incidents')
        .where('organizationId', '==', organizationId)
      if (waterPointId !== undefined) query = query.where('waterPointId', '==', waterPointId)
      const snap = await query
        .where('createdAt', '>=', Timestamp.fromDate(period.from))
        .where('createdAt', '<=', Timestamp.fromDate(period.to))
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get()
      const incidents: AnalyzedIncident[] = []
      for (const doc of snap.docs) {
        const parsed = incidentFieldsSchema.safeParse(doc.data())
        // Invalid or foreign documents are never analyzed.
        if (!parsed.success || parsed.data.organizationId !== organizationId || !UUID.test(doc.id)) continue
        const { createdAt, ...rest } = parsed.data
        incidents.push({ id: doc.id, ...rest, createdAt: createdAt.toDate() })
      }
      return incidents
    },

    async saveAnalysis(record) {
      const ref = db.collection('patternAnalyses').doc()
      // Dates are stored as Timestamps by the Admin SDK.
      await ref.create({ ...record, createdAt: FieldValue.serverTimestamp() })
      return ref.id
    },
  }
}
