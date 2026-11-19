// T9.2 / AC16: accessibility checks in a real browser at 360 px and 1280 px,
// against the emulators with the demo seed. Runs the shared audit
// (src/test/a11yAudit.ts) with layout and CSS checks: text contrast, target
// size, and no horizontal scrolling. Also checks keyboard behavior: visible
// focus, the mobile menu, and focus and title after navigation.
// FICTIONAL demo data.
import { expect, test, type Page } from '@playwright/test'
import { auditDocument, type AuditViolation } from '../src/test/a11yAudit.js'
import { KWALE_REPORTER, PASSWORD, resetAndSeed, signIn, signOut } from './helpers.js'

test.beforeAll(resetAndSeed)

const ADMIN = 'administrator.kwale@example.org'
const WIDTHS = [360, 1280] as const

async function audit(page: Page): Promise<AuditViolation[]> {
  await expect(page.locator('main h1')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0, { timeout: 30_000 })
  return page.evaluate(auditDocument, { browser: true })
}

async function go(page: Page, link: string) {
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  if (!(await nav.isVisible())) await page.getByRole('button', { name: 'Open menu' }).click()
  await nav.getByRole('link', { name: link, exact: true }).click()
}

for (const width of WIDTHS) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test(`sign-in and reporter screens pass the audit (${width}px)`, async ({ page }) => {
      await page.goto('/sign-in')
      expect(await audit(page), 'sign in').toEqual([])
      await page.getByLabel(/^Email/).fill(KWALE_REPORTER)
      await page.getByLabel(/^Password/).fill(PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible({ timeout: 30_000 })
      expect(await audit(page), 'reporter home').toEqual([])

      for (const link of ['My reports', 'Water points', 'Sync status']) {
        await go(page, link)
        expect(await audit(page), link).toEqual([])
      }

      await go(page, 'New report')
      await expect(page.getByLabel(/^Water point/).locator('option', { hasText: 'Mwamanga Borehole (fictional)' })).toHaveCount(1, { timeout: 30_000 })
      expect(await audit(page), 'new report').toEqual([])
      // Validation errors and the AI privacy preview.
      await page.getByRole('button', { name: 'Save report' }).click()
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible()
      expect(await audit(page), 'new report errors').toEqual([])
      await page.getByLabel(/^What is the problem\?/).fill('Low flow, call 0712 345 678 (fictional e2e).')
      await page.getByRole('button', { name: 'Suggest fields with AI' }).click()
      await expect(page.getByRole('region', { name: 'Text that will be sent for AI suggestions' })).toBeVisible()
      expect(await audit(page), 'AI preview').toEqual([])
      await signOut(page)
    })

    test(`staff screens pass the audit (${width}px)`, async ({ page }) => {
      await signIn(page, ADMIN)
      await expect(page.getByRole('region', { name: 'Open incidents' }).getByRole('link').first()).toBeVisible({ timeout: 30_000 })
      expect(await audit(page), 'staff home').toEqual([])

      await go(page, 'Incidents')
      await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible({ timeout: 30_000 })
      expect(await audit(page), 'incidents').toEqual([])
      await page.getByRole('main').getByRole('listitem').first().getByRole('link').first().click()
      await expect(page.getByRole('region', { name: 'Status' })).toBeVisible({ timeout: 30_000 })
      expect(await audit(page), 'incident detail').toEqual([])
      await page.getByRole('link', { name: 'Create maintenance task' }).click()
      await expect(page.getByRole('button', { name: 'Create task' })).toBeVisible({ timeout: 30_000 })
      expect(await audit(page), 'new task').toEqual([])

      for (const link of ['Maintenance', 'Pattern analysis', 'Users', 'Water points']) {
        await go(page, link)
        expect(await audit(page), link).toEqual([])
      }
      await page.getByRole('link', { name: 'Register water point' }).click()
      expect(await audit(page), 'register water point').toEqual([])
    })
  })
}

test('the browser audit detects low contrast, small targets, and overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/sign-in')
  await expect(page.locator('main h1')).toBeVisible()
  await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement
    main.insertAdjacentHTML(
      'beforeend',
      '<p style="color:#ccc;background:#fff">Pale text</p><button style="width:16px;height:16px;padding:0">x</button><div style="width:600px">Wide</div>',
    )
  })
  const rules = (await page.evaluate(auditDocument, { browser: true })).map((v) => v.rule)
  expect(rules).toEqual(expect.arrayContaining(['contrast', 'target-size', 'horizontal-overflow']))
})

test.describe('keyboard', () => {
  test('visible focus on every tab stop, focus and title follow navigation, Escape closes the mobile menu', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await signIn(page, KWALE_REPORTER)
    await expect(page).toHaveTitle('Home – MajiPulse')

    // The first tab stop is the skip link; every stop shows a focus indicator.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
    // Walk the tab order until it leaves the page; check the focus style of each stop.
    const stops: string[] = []
    for (let i = 0; i < 40; i += 1) {
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const s = getComputedStyle(el)
        const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'
        return `${visible ? 'ok' : 'NO FOCUS STYLE'}: ${el.tagName} ${el.textContent?.trim().slice(0, 30) ?? ''}`
      })
      if (stop === null || (i > 0 && stop.includes('Skip to main content'))) break
      stops.push(stop)
      await page.keyboard.press('Tab')
    }
    expect(stops.length).toBeGreaterThanOrEqual(5)
    expect(stops.filter((s) => !s.startsWith('ok'))).toEqual([])

    // Mobile menu: opens with Enter, Escape closes it and returns focus to the button.
    const menu = page.getByRole('button', { name: 'Open menu' })
    await menu.focus()
    await page.keyboard.press('Enter')
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    await expect(nav).toBeVisible()
    await nav.getByRole('link', { name: 'Sync status' }).focus()
    await page.keyboard.press('Escape')
    await expect(nav).toBeHidden()
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused()

    // Navigating moves focus to the main content and updates the title.
    await page.keyboard.press('Enter')
    await nav.getByRole('link', { name: 'Sync status' }).click()
    await expect(page.getByRole('main')).toBeFocused()
    await expect(page).toHaveTitle('Sync status – MajiPulse')
  })
})
