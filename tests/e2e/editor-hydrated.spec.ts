/// <reference path="../../src/preload/api.d.ts" />
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let app: ElectronApplication
let win: Page
let siteDir = ''
let projectsDir = ''
let userData = ''
let pageFile = ''
let frame: ReturnType<Page['frameLocator']>

/**
 * A page as builders such as Framer ship it: the file already holds the real markup, and a
 * script bundle re-renders the page from its own snapshot, so the live DOM stops matching
 * the file the editor writes.
 */
const PAGE = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>هیدریت</title></head>
<body>
<div id="hero">
  <div class="wrap" style="will-change:transform;opacity:0;transform:translateY(50px)"><h1 id="title">عنوانِ فایل</h1></div>
  <p id="lead">زیرنویسِ فایل</p>
</div>
<script src="/bundle.js"></script>
</body></html>`

const BUNDLE = `document.getElementById('hero').innerHTML = '<h1>عنوانِ باندل</h1><p>زیرنویسِ باندل</p>'\n`

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'webforge-hydrate-user-'))
  projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webforge-hydrate-projects-'))
  siteDir = path.join(projectsDir, 'hydrate-site')
  fs.mkdirSync(siteDir, { recursive: true })
  fs.writeFileSync(path.join(siteDir, 'index.html'), PAGE, 'utf8')
  fs.writeFileSync(path.join(siteDir, 'bundle.js'), BUNDLE, 'utf8')
  pageFile = path.join(siteDir, 'index.html')

  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      WEBFORGE_USER_DATA: userData,
      WEBFORGE_PROJECTS_DIR: projectsDir,
      WEBFORGE_ALLOW_PRIVATE: '1',
      WEBFORGE_QUIET: '1'
    }
  })
  win = await app.firstWindow({ timeout: 40_000 })
  await win.waitForLoadState('domcontentloaded')

  const imported = await win.evaluate((dir) => window.webforge.projects.import(dir, false), siteDir)
  expect(imported.ok).toBe(true)
  await win.reload()
  await win.waitForTimeout(1200)
  await win.locator('.sidebar .nav__item').filter({ hasText: 'پروژه‌ها' }).click()
  await win.locator('.card').filter({ hasText: 'hydrate-site' }).first().getByRole('button', { name: 'باز کردن', exact: true }).click()
  await expect(win.locator('.page-header__title')).toHaveText('hydrate-site')

  frame = win.frameLocator('iframe.preview-frame')
})

test.afterAll(async () => {
  await app?.close()
})

test('edit mode shows the file, not the bundle, and reveals pre-animation content', async () => {
  await expect(frame.locator('#title')).toBeVisible({ timeout: 40_000 })
  await expect(frame.locator('#title')).toHaveText('عنوانِ فایل')
  await expect(frame.locator('#lead')).toHaveText('زیرنویسِ فایل')
})

test('a click on a hydrated page saves into the file', async () => {
  await win.getByRole('button', { name: 'حالت انتخاب' }).click()
  await frame.locator('#title').click()
  await expect(win.locator('.selector-pill')).toContainText('#title')
  await win.locator('.inspector').getByRole('button', { name: 'محتوا', exact: true }).click()
  await win.locator('.inspector textarea').first().fill('عنوانِ تازه')
  await win.locator('.inspector').getByRole('button', { name: 'ذخیرهٔ متن' }).click()

  await expect.poll(() => fs.readFileSync(pageFile, 'utf8'), { timeout: 20_000 }).toContain('عنوانِ تازه')
  await expect(frame.locator('#title')).toHaveText('عنوانِ تازه')
})

test('live mode runs the bundle and the editor says the text is not in the file', async () => {
  await win.getByRole('button', { name: 'اسکریپت‌های سایت: خاموش' }).click()
  await expect(frame.locator('#hero')).toContainText('عنوانِ باندل', { timeout: 30_000 })

  await frame.locator('#hero h1').click()
  await win.locator('.inspector').getByRole('button', { name: 'محتوا', exact: true }).click()
  await win.locator('.inspector textarea').first().fill('هر چه باشد')
  await win.locator('.inspector').getByRole('button', { name: 'ذخیرهٔ متن' }).click()

  const error = win.locator('.toast').filter({ hasText: 'ناموفق' }).first()
  await expect(error).toBeVisible({ timeout: 15_000 })
  await expect(error).toContainText('اسکریپت‌های خود سایت')
  expect(fs.readFileSync(pageFile, 'utf8')).toContain('عنوانِ تازه')
})
