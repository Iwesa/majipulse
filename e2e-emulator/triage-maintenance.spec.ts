// T7.2 to T7.4 / AC10, AC19: an administrator sees the dashboard counts,
// triages a demo incident, creates a linked maintenance task assigned to the
// technician, and moves the task to done. Checked against the emulator.
// FICTIONAL demo data.
import { expect, test } from '@playwright/test'
import { readDocument, resetAndSeed, signIn } from './helpers.js'

test.beforeAll(resetAndSeed)

/** Each step below waits for a Firestore transaction, which can be slow on a loaded emulator. */
const SERVER_WRITE = { timeout: 30_000 }

test('administrator triages an incident, creates a linked task, and moves it to done (AC10)', async ({ page }) => {
  await signIn(page, 'administrator.kwale@example.org')

  // Dashboard: open incidents per status from the server (4 new in the Kwale demo seed).
  const incidentsCard = page.getByRole('region', { name: 'Open incidents' })
  await expect(incidentsCard.getByRole('link', { name: 'View incidents with status New: 4' })).toBeVisible({ timeout: 30_000 })

  await page.getByRole('navigation').getByRole('link', { name: 'Incidents' }).click()
  await page.getByLabel(/^Status/).selectOption('new')
  await page.getByRole('link', { name: 'Leak: Soko Water Kiosk (fictional)' }).click()

  const incidentId = /\/incidents\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? ''
  expect(incidentId).not.toBe('')
  await expect(page.getByRole('region', { name: 'AI suggestions (unverified)' })).toContainText('did not use AI suggestions')

  await page.getByRole('button', { name: 'Mark as Triaged' }).click()
  await expect(page.getByText('Status changed to Triaged.')).toBeVisible(SERVER_WRITE)
  const incident = await readDocument('incidents', incidentId)
  expect(incident?.status?.stringValue).toBe('triaged')
  expect(incident?.serverRevision?.integerValue).toBe('2')

  await page.getByRole('link', { name: 'Create maintenance task' }).click()
  await page.getByLabel(/^Task title/).fill('Fix the kiosk pipe joint (fictional e2e)')
  await page.getByLabel(/^Assigned to/).selectOption({ label: 'Demo Technician (Kwale)' })
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByText('Task created.')).toBeVisible(SERVER_WRITE)

  const taskId = decodeURIComponent(/\/maintenance\/([^/?#]+)/.exec(page.url())?.[1] ?? '')
  let task = await readDocument('maintenanceTasks', taskId)
  expect(task?.incidentId?.stringValue).toBe(incidentId)
  expect(task?.waterPointId?.stringValue).toBe('wp-soko-kiosk')
  expect(task?.status?.stringValue).toBe('open')
  expect(task?.assigneeId?.stringValue).toBe('demo-kwale-technician')

  await page.getByRole('button', { name: 'Mark as In progress' }).click()
  await expect(page.getByText('Task status changed to In progress.')).toBeVisible(SERVER_WRITE)
  await page.getByRole('button', { name: 'Mark as Done' }).click()
  await expect(page.getByText('Task status changed to Done.')).toBeVisible(SERVER_WRITE)
  await expect(page.getByText('This task is done.')).toBeVisible()
  task = await readDocument('maintenanceTasks', taskId)
  expect(task?.status?.stringValue).toBe('done')

  // The incident shows the linked task.
  await page.getByRole('link', { name: 'View incident' }).click()
  await expect(page.getByRole('region', { name: 'Maintenance tasks' }).getByRole('link', { name: 'Fix the kiosk pipe joint (fictional e2e)' })).toBeVisible()
})
