/// <reference path="../../src/preload/api.d.ts" />
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Hits api.github.com and codeload.github.com, so it is opt-in:
//   WEBFORGE_LIVE_NET=1 npx playwright test discover-live
const live = !!process.env.WEBFORGE_LIVE_NET
// Three files, no package.json, an index.html at the root: the only plan the analyzer can pick
// is "import as an editable project", which keeps this spec free of an AI key.
const FIXTURE_REPO = 'octocat/Spoon-Knife'

test.describe('discover against live GitHub', () => {
  test.skip(!live, 'set WEBFORGE_LIVE_NET=1 to run the network-dependent Discover flow')
  test.describe.configure({ mode: 'serial', timeout: 300_000 })

  let app: ElectronApplication
  let win: Page
  let projectsDir = ''

  test.beforeAll(async () => {
    projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webforge-live-projects-'))
    app = await electron.launch({
      args: ['.', '--no-sandbox'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        WEBFORGE_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'webforge-live-user-')),
        WEBFORGE_PROJECTS_DIR: projectsDir,
        WEBFORGE_QUIET: '1'
      }
    })
    win = await app.firstWindow({ timeout: 40_000 })
    await win.waitForLoadState('domcontentloaded')
    await win.locator('.sidebar .nav__item').filter({ hasText: 'کشف ابزار' }).click()
    await expect(win.locator('.page-header__title')).toHaveText('کشف و اتصال ابزار')
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('search → open repo → inspect → connect plan', async () => {
    await win.locator('input[placeholder="مثلاً static site generator"]').fill(`repo:${FIXTURE_REPO}`)
    await win.getByRole('button', { name: 'جستجو' }).click()

    const card = win.locator('.repo-card').filter({ hasText: FIXTURE_REPO }).first()
    await expect(card).toBeVisible({ timeout: 60_000 })
    await card.click()

    const modal = win.locator('.modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.modal__head h3')).toContainText(/Spoon-Knife/i)
    await modal.getByRole('button', { name: 'بازرسی و تصمیم برای اتصال' }).click()

    await expect(modal.locator('.plan-steps li').first()).toBeVisible({ timeout: 240_000 })
    await expect(modal.getByText('تشخیص خودکار')).toBeVisible()
    await expect(modal.getByRole('button', { name: 'افزودن به پروژه‌ها' })).toBeEnabled()
  })

  test('the inspected repository becomes an editable project', async () => {
    await win.locator('.modal').getByRole('button', { name: 'افزودن به پروژه‌ها' }).click()
    await expect(win.locator('.modal').getByText('باز کردن در ویرایشگر بصری')).toBeVisible({ timeout: 120_000 })

    const root = path.join(projectsDir, 'from-github')
    await expect.poll(() => {
      if (!fs.existsSync(root)) return false
      return fs.readdirSync(root).some((dir) => {
        const target = path.join(root, dir)
        return fs.existsSync(path.join(target, 'FROM-GITHUB.md')) && fs.existsSync(path.join(target, 'index.html'))
      })
    }, { timeout: 60_000 }).toBe(true)
  })
})
