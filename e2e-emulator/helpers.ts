// Shared helpers for emulator E2E tests. FICTIONAL demo data only.
import { execFileSync } from 'node:child_process'
import { expect, type Page } from '@playwright/test'

export const PROJECT = 'demo-majipulse'
export const PASSWORD = 'e2e-demo-password-123'
export const KWALE_REPORTER = 'reporter.kwale@example.org'
export const PWANI_REPORTER = 'reporter.pwani@example.org'
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
/** The Firestore emulator accepts this token as an admin that bypasses rules. */
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

/** Fresh emulator data, then the demo seed (users, claims, members, water points, incidents). */
export async function resetAndSeed(): Promise<void> {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  execFileSync(process.execPath, ['functions/lib/functions/src/scripts/seed-demo.js', '--project', PROJECT, '--confirm-project', PROJECT, '--emulator'], {
    env: { ...process.env, MAJIPULSE_DEMO_PASSWORD: PASSWORD },
    stdio: 'inherit',
  })
  await warmUpRules()
}

/**
 * The first rules-evaluated request against a cold Firestore emulator can take
 * over 10 seconds. The web SDK then treats the backend as unreachable and goes
 * offline, so the app's first read fails. An unauthenticated read (denied by
 * the rules) makes the emulator load and compile the rules before any browser
 * test starts.
 */
async function warmUpRules(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${FIRESTORE}/waterPoints/warm-up`).catch(() => null)
    if (res && (res.status === 403 || res.status === 404)) break
  }
  // A signed-in, organization-scoped query exercises the member lookup in the
  // rules (get() on members/{uid}), which is the slowest part on a cold start.
  const auth = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: KWALE_REPORTER, password: PASSWORD, returnSecureToken: true }),
  }).catch(() => null)
  const idToken = auth ? ((await auth.json()) as { idToken?: string }).idToken : undefined
  if (!idToken) return
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'waterPoints' }],
      where: { fieldFilter: { field: { fieldPath: 'organizationId' }, op: 'EQUAL', value: { stringValue: 'kwale-demo' } } },
    },
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = Date.now()
    const res = await fetch(`${FIRESTORE}:runQuery`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    }).catch(() => null)
    // Warm once a scoped query answers quickly.
    if (res?.ok && Date.now() - started < 2_000) return
  }
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel(/^Email/).fill(email)
  await page.getByLabel(/^Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The first sign-in against a cold Auth emulator can be slow.
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible({ timeout: 30_000 })
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to MajiPulse' })).toBeVisible()
}

/** Opens New report online so the water point list is saved on this device. */
export async function openNewReport(page: Page): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: 'New report' }).click()
  // Like the first sign-in, the first water point read against a cold emulator can be slow.
  await expect(page.getByLabel(/^Water point/).locator('option', { hasText: 'Mwamanga Borehole (fictional)' })).toHaveCount(1, { timeout: 30_000 })
}

export async function fillReport(page: Page, description: string): Promise<void> {
  await page.getByLabel(/^Water point/).selectOption({ label: 'Mwamanga Borehole (fictional) (Demo Ward)' })
  await page.getByLabel(/^What is the problem\?/).fill(description)
  await page.getByLabel(/^Type of problem/).selectOption('low_flow')
  await page.getByRole('button', { name: 'Save report' }).click()
  await expect(page.getByText(/^(Report saved|Changes saved) on this device\.$/)).toBeVisible()
}

export const reportIdFrom = (url: string): string => {
  const match = /\/reports\/([0-9a-f-]{36})/.exec(url)
  if (!match) throw new Error(`no report id in ${url}`)
  return match[1]
}

type FirestoreValue = { stringValue?: string; integerValue?: string; mapValue?: unknown; timestampValue?: string }
export type IncidentFields = Record<string, FirestoreValue>

/** Reads an incident directly from the emulator (admin, bypassing rules). Null if missing. */
export async function readIncident(id: string): Promise<IncidentFields | null> {
  const res = await fetch(`${FIRESTORE}/incidents/${id}`, { headers: OWNER })
  if (res.status === 404) return null
  const body = (await res.json()) as { fields?: IncidentFields }
  return body.fields ?? null
}

/** Counts incident documents with the given ID prefix check (all incidents, admin view). */
export async function countIncidentsWithId(id: string): Promise<number> {
  const res = await fetch(`${FIRESTORE}/incidents?pageSize=300`, { headers: OWNER })
  const body = (await res.json()) as { documents?: Array<{ name: string }> }
  return (body.documents ?? []).filter((d) => d.name.endsWith(`/incidents/${id}`)).length
}

/** A technician triages the incident (server-side status change, keeps mutationId). */
export async function triageOnServer(id: string): Promise<void> {
  const current = await readIncident(id)
  const revision = Number(current?.serverRevision?.integerValue ?? '0')
  const now = new Date().toISOString()
  const mask = ['status', 'serverRevision', 'lastStatusChange', 'updatedAt'].map((f) => `updateMask.fieldPaths=${f}`).join('&')
  const res = await fetch(`${FIRESTORE}/incidents/${id}?${mask}`, {
    method: 'PATCH',
    headers: OWNER,
    body: JSON.stringify({
      fields: {
        status: { stringValue: 'triaged' },
        serverRevision: { integerValue: String(revision + 1) },
        updatedAt: { timestampValue: now },
        lastStatusChange: {
          mapValue: {
            fields: {
              by: { stringValue: 'demo-kwale-technician' },
              at: { timestampValue: now },
              from: { stringValue: 'new' },
              to: { stringValue: 'triaged' },
            },
          },
        },
      },
    }),
  })
  if (!res.ok) throw new Error(`triage failed: ${res.status}`)
}

/** Reads any document from the emulator (admin, bypassing rules). Null if missing. */
export async function readDocument(collectionPath: string, id: string): Promise<IncidentFields | null> {
  const res = await fetch(`${FIRESTORE}/${collectionPath}/${encodeURIComponent(id)}`, { headers: OWNER })
  if (res.status === 404) return null
  const body = (await res.json()) as { fields?: IncidentFields }
  return body.fields ?? null
}