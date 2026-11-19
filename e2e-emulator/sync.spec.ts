// T5.6: conflict review and account switching against the emulators (AC6, AC13).
// FICTIONAL demo data from the seed script.
import { expect, test } from '@playwright/test'
import {
  KWALE_REPORTER,
  PWANI_REPORTER,
  countIncidentsWithId,
  fillReport,
  openNewReport,
  readIncident,
  reportIdFrom,
  resetAndSeed,
  signIn,
  signOut,
  triageOnServer,
} from './helpers.js'

test.beforeEach(resetAndSeed)

test('a stale edit after triage becomes a conflict; discard needs confirmation (AC6)', async ({ page }) => {
  await signIn(page, KWALE_REPORTER)
  await openNewReport(page)
  await fillReport(page, 'Original report (fictional e2e).')
  await expect(page.getByText('Received by your organization.')).toBeVisible({ timeout: 30_000 })
  const id = reportIdFrom(page.url())

  // A technician triages it on the server. This device does not know yet.
  await triageOnServer(id)

  await page.getByRole('link', { name: 'Edit report' }).click()
  await page.getByLabel(/^What is the problem\?/).fill('Edited after triage (fictional e2e).')
  await page.getByRole('button', { name: 'Save report' }).click()

  const review = page.getByRole('region', { name: 'Your edit was not sent' })
  await expect(review).toBeVisible({ timeout: 30_000 })
  await expect(review.getByRole('table')).toContainText('Edited after triage (fictional e2e).')
  await expect(review.getByRole('table')).toContainText('Original report (fictional e2e).')
  await expect(review.getByRole('button', { name: 'Send my version' })).toHaveCount(0)
  await expect(review).toContainText('already started handling this report')
  // The edit was not written to the server.
  expect((await readIncident(id))?.description?.stringValue).toBe('Original report (fictional e2e).')

  await review.getByRole('button', { name: 'Discard my edit' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Discard your edit?' })
  await dialog.getByRole('button', { name: 'Keep my edit' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(review).toBeVisible()

  await review.getByRole('button', { name: 'Discard my edit' }).click()
  await page.getByRole('button', { name: 'Yes, discard my edit' }).click()
  await expect(page.getByText('Your edit was discarded. The report now shows the server version.')).toBeVisible()
  await expect(page.getByText('Received by your organization.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit report' })).toHaveCount(0)
  expect(await countIncidentsWithId(id)).toBe(1)
})

test('account switching keeps unsent reports per user and sends them when the owner returns (AC13)', async ({ page, context }) => {
  // User A saves a report offline and signs out without sending it.
  await signIn(page, KWALE_REPORTER)
  await openNewReport(page)
  await context.setOffline(true)
  await fillReport(page, 'Saved by Kwale reporter while offline (fictional e2e).')
  const id = reportIdFrom(page.url())
  await signOut(page)
  await context.setOffline(false)
  expect(await readIncident(id)).toBeNull()

  // User B on the same browser sees none of A's reports, and nothing of A's is sent.
  await signIn(page, PWANI_REPORTER)
  await page.getByRole('navigation').getByRole('link', { name: 'My reports' }).click()
  await expect(page.getByRole('heading', { name: 'No reports yet' })).toBeVisible()
  await expect(page.getByText('Saved by Kwale reporter while offline', { exact: false })).toHaveCount(0)
  await page.goto(`/reports/${id}`)
  // A full reload restores the session from the Auth and Firestore emulators, which can be slow, like sign-in.
  await expect(page.getByRole('heading', { name: 'Report not found' })).toBeVisible({ timeout: 30_000 })
  expect(await readIncident(id)).toBeNull()
  await signOut(page)

  // A signs in again: the report is still there and is sent.
  await signIn(page, KWALE_REPORTER)
  await page.getByRole('navigation').getByRole('link', { name: 'My reports' }).click()
  const item = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Saved by Kwale reporter while offline' })
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('Sent', { timeout: 30_000 })
  expect(await countIncidentsWithId(id)).toBe(1)
  expect((await readIncident(id))?.reporterId?.stringValue).toBe('demo-kwale-reporter')
})
