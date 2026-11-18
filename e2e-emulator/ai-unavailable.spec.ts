// T6.7 / R4.7, AC7, AC21: with AI failing, the reporter sees the privacy
// preview, then "AI suggestions unavailable", and still saves and sends the
// report manually. The blocked model request is captured to check that only
// redacted text left the browser. FICTIONAL demo data.
import { expect, test, type Request } from '@playwright/test'
import { KWALE_REPORTER, openNewReport, readIncident, reportIdFrom, resetAndSeed, signIn } from './helpers.js'

test.beforeAll(resetAndSeed)

test('AI unavailable: preview, unavailable message, manual save still syncs', async ({ page }) => {
  // No on-device model in this run, so PREFER_ON_DEVICE goes to the cloud endpoint, which is blocked.
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, 'LanguageModel')
  })
  const aiRequests: Request[] = []
  await page.route('https://firebasevertexai.googleapis.com/**', async (route) => {
    aiRequests.push(route.request())
    await route.abort('failed')
  })

  await signIn(page, KWALE_REPORTER)
  await openNewReport(page)
  const description = 'Tap 2 is leaking near the trough. Call 0712 345 678 (fictional e2e AI).'
  await page.getByLabel(/^Water point/).selectOption({ label: 'Mwamanga Borehole (fictional) (Demo Ward)' })
  await page.getByLabel(/^What is the problem\?/).fill(description)

  await page.getByRole('button', { name: 'Suggest fields with AI' }).click()
  const preview = page.getByRole('region', { name: 'Text that will be sent for AI suggestions' })
  await expect(preview).toContainText('Call [PHONE]')
  await expect(preview).not.toContainText('0712')
  await expect(preview.getByRole('alert')).toContainText('may not be detected automatically')
  expect(aiRequests).toHaveLength(0)

  await preview.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'AI suggestions unavailable' })).toBeVisible({ timeout: 20_000 })

  // The request that was attempted carried only the redacted description.
  expect(aiRequests.length).toBeGreaterThan(0)
  for (const request of aiRequests) {
    const body = request.postData() ?? ''
    expect(body).toContain('Call [PHONE]')
    expect(body).not.toContain('0712')
    expect(body).not.toContain('345 678')
  }

  // Manual entry continues and the report is sent as normal.
  await page.getByLabel(/^Type of problem/).selectOption('leak')
  await page.getByRole('button', { name: 'Save report' }).click()
  await expect(page.getByText('Report saved on this device.')).toBeVisible()
  await expect(page.getByText('Received by your organization.')).toBeVisible({ timeout: 30_000 })
  // The detail page states that AI was not used.
  await expect(page.getByText('Not used', { exact: true })).toBeVisible()

  const id = reportIdFrom(page.url())
  const server = await readIncident(id)
  expect(server?.description?.stringValue).toBe(description)
  expect(server?.incidentType?.stringValue).toBe('leak')
  expect(server && 'ai' in server).toBe(false)
})
