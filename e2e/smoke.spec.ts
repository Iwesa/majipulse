import { expect, test } from '@playwright/test'

test('app shell loads in a browser', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('MajiPulse')
  await expect(page.getByRole('heading', { level: 1, name: 'MajiPulse' })).toBeVisible()
})
