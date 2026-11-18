// T4.5 / AC3 and T5.6 / AC4: in a loaded app with the network off, a reporter
// creates a report. It waits to send while offline, then is sent exactly once
// after reconnecting, and stays sent after a reload. FICTIONAL demo data.
import { expect, test } from '@playwright/test'
import { KWALE_REPORTER, countIncidentsWithId, fillReport, openNewReport, readIncident, reportIdFrom, resetAndSeed, signIn } from './helpers.js'

test.beforeAll(resetAndSeed)

test('offline report capture is saved locally, then sent once after reconnect', async ({ page, context }) => {
  await signIn(page, KWALE_REPORTER)
  await expect(page.getByText('Demo data (fictional).', { exact: false })).toBeVisible()
  await openNewReport(page)

  await context.setOffline(true)
  await expect(page.getByText('Offline: new reports are saved on this device')).toBeVisible()
  await fillReport(page, 'Handpump gives very little water since this morning (fictional e2e).')
  await expect(page.getByText('Waiting to send').first()).toBeVisible()
  const id = reportIdFrom(page.url())
  expect(await readIncident(id)).toBeNull()

  // Reconnect: the `online` event starts a sync.
  await context.setOffline(false)
  await expect(page.getByText('Received by your organization.')).toBeVisible({ timeout: 30_000 })
  expect(await countIncidentsWithId(id)).toBe(1)
  expect((await readIncident(id))?.description?.stringValue).toBe('Handpump gives very little water since this morning (fictional e2e).')

  // Reload: still on this device, still sent, still one document.
  await page.reload()
  await page.getByRole('navigation').getByRole('link', { name: 'My reports' }).click()
  const item = page.getByRole('main').getByRole('listitem').filter({ hasText: 'fictional e2e' })
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('Low flow: Mwamanga Borehole (fictional)')
  await expect(item).toContainText('Sent')
  expect(await countIncidentsWithId(id)).toBe(1)
})
