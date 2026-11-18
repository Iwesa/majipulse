// T4.5 / AC3: in a loaded app with the network off, a reporter creates a
// report. It shows as waiting to send, and is still there after the app
// reconnects and reloads. FICTIONAL demo data from the seed script.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const PROJECT = 'demo-majipulse'
const PASSWORD = 'e2e-demo-password-123'
const REPORTER = 'reporter.kwale@example.org'

test.beforeAll(async () => {
  // Fresh emulator data, then the demo seed (users, claims, members, water points).
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  execFileSync(
    process.execPath,
    ['functions/lib/scripts/seed-demo.js', '--project', PROJECT, '--confirm-project', PROJECT, '--emulator'],
    { env: { ...process.env, MAJIPULSE_DEMO_PASSWORD: PASSWORD }, stdio: 'inherit' },
  )
})

test('offline report capture survives reconnect and reload', async ({ page, context }) => {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') console.log(`[browser ${message.type()}] ${message.text()}`)
  })
  await page.goto('/sign-in')
  await page.getByLabel(/^Email/).fill(REPORTER)
  await page.getByLabel(/^Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The first sign-in against a cold Auth emulator can be slow.
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Demo data (fictional).', { exact: false })).toBeVisible()

  // Load the new report screen online, so water points are on this device.
  await page.getByRole('navigation').getByRole('link', { name: 'New report' }).click()
  const waterPoint = page.getByLabel(/^Water point/)
  await expect(waterPoint.locator('option', { hasText: 'Mwamanga Borehole (fictional)' })).toHaveCount(1)

  await context.setOffline(true)
  await expect(page.getByText('Offline: new reports are saved on this device')).toBeVisible()

  await waterPoint.selectOption({ label: 'Mwamanga Borehole (fictional) (Demo Ward)' })
  await page.getByLabel(/^What is the problem\?/).fill('Handpump gives very little water since this morning (fictional e2e).')
  await page.getByLabel(/^Type of problem/).selectOption('low_flow')
  await page.getByRole('button', { name: 'Save report' }).click()

  await expect(page.getByText('Report saved on this device.')).toBeVisible()
  await expect(page.getByText('Waiting to send').first()).toBeVisible()
  const reportUrl = page.url()

  // Reconnect and reload: the report is still there, still waiting to send.
  await context.setOffline(false)
  await page.reload()
  await page.getByRole('navigation').getByRole('link', { name: 'My reports' }).click()
  const item = page.getByRole('main').getByRole('listitem').filter({ hasText: 'fictional e2e' })
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('Low flow: Mwamanga Borehole (fictional)')
  await expect(item).toContainText('Waiting to send')

  await page.goto(reportUrl)
  await expect(page.getByText('Saved on this device. It will be sent when sending is available.')).toBeVisible()
})
