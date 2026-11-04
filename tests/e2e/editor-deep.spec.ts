/// <reference lib="dom" />
/// <reference path="../../src/preload/api.d.ts" />
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

let app: ElectronApplication
let win: Page
let server: http.Server
let siteUrl = ''
let userData = ''
let projectsDir = ''
let pageFile = ''
let frame: ReturnType<Page['frameLocator']>

const PAGE = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>ویرایش عمیق</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
<div id="card" class="card" data-note="keep" style="color:#123456">
  <h2 id="cta">عنوان کارت</h2>
  <p id="lead">متن لید</p>
  <a id="btn" href="/old" target="_self">دکمه</a>
  <span id="tag">برچسب</span>
</div>
</body></html>`

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'webforge-deep-user-'))
  projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webforge-deep-projects-'))
  pageFile = path.join(projectsDir, 'deep-site', 'clean', 'index.html')

  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(PAGE)
      return
    }
    if (url.pathname === '/style.css') {
      response.writeHead(200, { 'Content-Type': 'text/css' })
      response.end('body{font-family:sans-serif}.card{padding:8px}')
      return
    }
    if (url.pathname === '/old') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>صفحهٔ دیگر</title></head><body><h1 id="other">صفحهٔ دیگر</h1></body></html>')
      return
    }
    if (url.pathname === '/robots.txt') {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('User-agent: *\nAllow: /\n')
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  siteUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

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

  await win.locator('.sidebar .nav__item').filter({ hasText: 'استخراج سایت' }).click()
  await win.locator('input[placeholder="https://example.com"]').fill(siteUrl)
  await win.locator('input[placeholder="نام سایت"]').fill('deep-site')
  await win.getByRole('button', { name: 'شروع استخراج' }).click()
  await expect(win.getByRole('button', { name: 'باز کردن در ویرایشگر' })).toBeVisible({ timeout: 90_000 })
  await win.getByRole('button', { name: 'باز کردن در ویرایشگر' }).click()
  await expect(win.locator('.page-header__title')).toHaveText('deep-site')

  frame = win.frameLocator('iframe.preview-frame')
  await expect(frame.locator('h2#cta')).toBeVisible({ timeout: 40_000 })
  await win.getByRole('button', { name: 'حالت انتخاب' }).click()
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
})

const pick = async (target: string): Promise<void> => {
  await frame.locator(target).click()
  await expect(win.locator('.selector-pill')).toBeVisible({ timeout: 15_000 })
}

const tab = async (name: 'محتوا' | 'استایل' | 'ساختار'): Promise<void> => {
  await win.locator('.inspector').getByRole('button', { name, exact: true }).click()
}

const html = (): string => fs.readFileSync(pageFile, 'utf8')

test('styles are written to the file and applied in the live preview', async () => {
  await pick('#cta')
  await tab('استایل')
  await win.locator('.inspector .color-row').first().locator('input').nth(1).fill('#ff0000')
  await win.locator('.inspector input[placeholder="16px"]').fill('40px')
  await win.locator('.inspector').getByRole('button', { name: 'اعمال استایل‌ها' }).click()

  await expect(win.locator('.toast__msg').filter({ hasText: 'تغییر' }).first()).toBeVisible()
  await expect.poll(html, { timeout: 20_000 }).toContain('color: #ff0000')
  expect(html()).toContain('font-size: 40px')
  await expect(frame.locator('h2#cta')).toHaveCSS('font-size', '40px')
})

test('selection mode survives the reload that follows a saved edit', async () => {
  // The preview reloads after every write; the reloaded page must stay clickable.
  await pick('#lead')
  await expect(win.locator('.selector-pill')).toContainText('#lead')
})

test('text of the selected element is replaced in place', async () => {
  await win.locator('.inspector').getByRole('button', { name: 'محتوا', exact: true }).click()
  await win.locator('.inspector textarea').first().fill('لیدِ ویرایش‌شده')
  await win.locator('.inspector').getByRole('button', { name: 'ذخیرهٔ متن' }).click()
  await expect.poll(html, { timeout: 20_000 }).toContain('لیدِ ویرایش‌شده')
  await expect(frame.locator('p#lead')).toHaveText('لیدِ ویرایش‌شده')
})

test('a class is added and an attribute is saved, then deleted without leaving a stray space', async () => {
  await tab('ساختار')
  await win.locator('.inspector input[placeholder="new-class"]').fill('highlight')
  await win.locator('.inspector').getByRole('button', { name: 'افزودن', exact: true }).click()
  await expect.poll(html, { timeout: 20_000 }).toContain('class="highlight"')

  await pick('#card')
  await tab('ساختار')
  const saveButton = win.getByLabel('ذخیره data-note')
  await expect(saveButton).toBeVisible()
  const valueInput = saveButton.locator('xpath=preceding-sibling::input[1]')
  await valueInput.fill('changed')
  await saveButton.click()
  await expect.poll(html, { timeout: 20_000 }).toContain('data-note="changed"')

  await win.getByLabel('حذف data-note').click()
  await expect.poll(html, { timeout: 20_000 }).not.toContain('data-note')
  expect(html()).not.toMatch(/"\s>/)
})

test('markup can be inserted after an element and an element can be deleted', async () => {
  await pick('#lead')
  await tab('ساختار')
  await win.locator('.inspector').getByRole('button', { name: 'ویرایش HTML این بخش' }).click()
  await win.locator('.inspector textarea').last().fill('<p id="added">افزوده شد</p>')
  await win.locator('.inspector').getByRole('button', { name: 'افزودن بعد از' }).click()
  await expect.poll(html, { timeout: 20_000 }).toContain('<p id="added">افزوده شد</p>')

  await pick('#tag')
  await tab('استایل')
  await win.locator('.inspector').getByRole('button', { name: 'مخفی کردن' }).click()
  await expect.poll(html, { timeout: 20_000 }).toContain('display: none')

  await tab('ساختار')
  await win.locator('.inspector').getByRole('button', { name: 'حذف عنصر' }).click()
  await expect.poll(html, { timeout: 20_000 }).not.toContain('id="tag"')
})

test('undo restores the previous file state', async () => {
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(html, { timeout: 20_000 }).toContain('id="tag"')
})
