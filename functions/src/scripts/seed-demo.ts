/**
 * Loads the FICTIONAL demo dataset (T2.13). Operator-run only.
 *
 *   MAJIPULSE_DEMO_PASSWORD=<12+ chars> npm --prefix functions run seed-demo -- \
 *     --project <id> --confirm-project <id> [--emulator]
 *
 * The password is read from the environment and never printed. The script
 * refuses to run if any demo organization or demo user already exists.
 */
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { orgClaims } from '../domain.js'
import { buildDemoData } from '../seed/demoData.js'
import { initAdminApp } from './cli.js'

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      'confirm-project': { type: 'string' },
      emulator: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (!values.project || values.project !== values['confirm-project']) {
    console.error('--project and --confirm-project are required and must match. Nothing was changed.')
    return 2
  }
  const password = process.env.MAJIPULSE_DEMO_PASSWORD ?? ''
  if (password.length < 12) {
    console.error('Set MAJIPULSE_DEMO_PASSWORD (at least 12 characters) for the demo accounts. Nothing was changed.')
    return 2
  }

  const app = initAdminApp(values.project, values.emulator)
  const auth = getAuth(app)
  const db = getFirestore(app)
  const data = buildDemoData(new Date(), randomUUID)

  // Refuse instead of overwriting anything.
  for (const org of data.organizations) {
    if ((await db.doc(`organizations/${org.id}`).get()).exists) {
      console.error(`Demo organization "${org.id}" already exists. Nothing was changed.`)
      return 1
    }
    for (const u of org.users) {
      const existing = await auth.getUser(u.uid).catch(() => null)
      if (existing) {
        console.error(`Demo user ${u.uid} already exists. Nothing was changed.`)
        return 1
      }
    }
  }

  for (const org of data.organizations) {
    const admin = org.users.find((u) => u.role === 'administrator')
    for (const u of org.users) {
      await auth.createUser({ uid: u.uid, email: u.email, displayName: u.displayName, password, emailVerified: true })
      await auth.setCustomUserClaims(u.uid, orgClaims(org.id, u.role))
    }
    const batch = db.batch()
    const now = new Date()
    batch.create(db.doc(`organizations/${org.id}`), {
      name: org.name,
      county: org.county,
      demo: true,
      createdAt: now,
      createdBy: 'seed-script',
      bootstrap: { status: 'complete', adminUid: admin?.uid, userCreatedByBootstrap: true, startedAt: now, completedAt: now },
    })
    for (const u of org.users) {
      batch.create(db.doc(`members/${u.uid}`), {
        organizationId: org.id,
        role: u.role,
        email: u.email,
        displayName: u.displayName,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
    }
    await batch.commit()
  }

  const batch = db.batch()
  for (const wp of data.waterPoints) batch.create(db.doc(`waterPoints/${wp.id}`), wp.data)
  for (const incident of data.incidents) batch.create(db.doc(`incidents/${incident.id}`), incident.data)
  await batch.commit()

  const users = data.organizations.reduce((n, o) => n + o.users.length, 0)
  console.log(
    `Seeded FICTIONAL demo data: ${data.organizations.length} organizations, ${users} users, ` +
      `${data.waterPoints.length} water points, ${data.incidents.length} incidents.`,
  )
  return 0
}

process.exitCode = await main()
