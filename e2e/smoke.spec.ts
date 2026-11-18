import { expect, test } from '@playwright/test'

// Text is duplicated from src/strings/en.ts because the Node test config does
// not import app source.
// The E2E build has no .env.local, so the app shows its configuration error
// inside the shell. Flows that need Firebase run against the emulators later.
test('app shell loads in a browser and reports missing configuration', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('MajiPulse')
  await expect(page.getByRole('banner')).toContainText('MajiPulse')
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('MajiPulse is not configured')
  await expect(page.getByRole('contentinfo')).toContainText('Offline reporting works after MajiPulse has loaded')
})

test('skip link is first in tab order and moves focus to main', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to main content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
})

test('connectivity indicator reflects browser offline state', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByText('Online', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByText('Offline: new reports are saved on this device')).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText('Online', { exact: true })).toBeVisible()
})
