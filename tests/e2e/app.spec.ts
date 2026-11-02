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
let pluginDir = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'webforge-e2e-user-'))
  projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webforge-e2e-projects-'))
  pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webforge-e2e-plugin-'))
  fs.writeFileSync(
    path.join(pluginDir, 'index.js'),
    "const fs = require('fs'); fs.writeFileSync('report.json', JSON.stringify({ ok: true })); console.log('PLUGIN_OK');\n",
    'utf8'
  )
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.manifest.json'),
    JSON.stringify({
      name: 'e2e-echo',
      displayName: 'E2E Echo',
      description: 'plugin execution test',
      version: '1.0.0',
      runtime: 'node',
      command: 'index.js',
      args: [],
      cwd: '.',
      inputs: [],
      outputs: [{ key: 'report', type: 'file', path: 'report.json' }],
      permissions: { network: false, projectWrite: false, environment: [] },
      timeoutSeconds: 30
    }),
    'utf8'
  )
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html lang="fa" dir="rtl"><head><title>سایت آزمایشی</title>
        <meta name="description" content="توضیح آزمایشی برای تست">
        <link rel="stylesheet" href="/style.css"></head>
        <body><h1 id="title">سایت آزمایشی</h1><p>متن اولیه</p><img src="/img/a.png" alt="تصویر"></body></html>`)
      return
    }
    if (url.pathname === '/style.css') {
      response.writeHead(200, { 'Content-Type': 'text/css' })
      response.end('body{font-family:sans-serif;background:url(/img/bg.png)}')
      return
    }
    if (url.pathname === '/robots.txt') {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('User-agent: *\nAllow: /\n')
      return
    }
    if (url.pathname.endsWith('.png')) {
      response.writeHead(200, { 'Content-Type': 'image/png' })
      response.end(png)
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
  await expect(win.locator('body')).toContainText('فضای کاری تو', { timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
})

test('dashboard and navigation render in Persian RTL', async () => {
  await expect(win.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(win.locator('.page-header__title')).toHaveText('فضای کاری تو')
  await win.locator('.sidebar .nav__item').filter({ hasText: 'استخراج سایت' }).click()
  await expect(win.locator('.page-header__title')).toHaveText('استخراج سایت')
})

test('extracts a real site through the UI', async () => {
  await win.locator('input[placeholder="https://example.com"]').fill(siteUrl)
  await win.locator('input[placeholder="نام سایت"]').fill('e2e-site')
  await win.getByRole('button', { name: 'شروع استخراج' }).click()
  await expect(win.getByText('استخراج کامل شد.', { exact: true })).toBeVisible({ timeout: 90_000 })
  const projectDir = path.join(projectsDir, 'e2e-site')
  expect(fs.existsSync(path.join(projectDir, 'clean', 'index.html'))).toBe(true)
  expect(fs.existsSync(path.join(projectDir, 'clean', 'style.css'))).toBe(true)
  expect(fs.existsSync(path.join(projectDir, 'clean', 'img', 'bg.png'))).toBe(true)
  await expect(win.getByRole('button', { name: 'باز کردن در ویرایشگر' })).toBeVisible()
})

test('preview loads and supports click-to-edit with persistence', async () => {
  await win.getByRole('button', { name: 'باز کردن در ویرایشگر' }).click()
  await expect(win.locator('.page-header__title')).toHaveText('e2e-site')
  const frame = win.frameLocator('iframe.preview-frame')
  await expect(frame.locator('h1#title')).toBeVisible({ timeout: 40_000 })
  await win.getByRole('button', { name: 'حالت انتخاب' }).click()
  await frame.locator('h1#title').click()
  await expect(win.locator('.selector-pill')).toContainText('#title', { timeout: 15_000 })
  const textarea = win.locator('.inspector textarea').first()
  await textarea.fill('عنوان ویرایش‌شده')
  await win.getByRole('button', { name: 'ذخیرهٔ متن' }).click()
  await expect(win.locator('.toast__title').filter({ hasText: 'تغییرات ذخیره شد' })).toBeVisible()
  const html = fs.readFileSync(path.join(projectsDir, 'e2e-site', 'clean', 'index.html'), 'utf8')
  expect(html).toContain('عنوان ویرایش‌شده')
  expect(fs.existsSync(path.join(projectsDir, 'e2e-site', '.webforge', 'backups'))).toBe(true)
})

test('admin panel plugin installs into the site', async () => {
  await win.locator('.sidebar .nav__item').filter({ hasText: 'ابزارها' }).click()
  await expect(win.locator('.page-header__title')).toHaveText('ابزارها')
  const card = win.locator('.card').filter({ hasText: 'سازنده پنل ادمین' }).first()
  await card.getByRole('button', { name: 'اجرا' }).click()
  const modal = win.locator('.modal')
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'اجرا' }).click()
  await expect(modal.locator('.alert--success')).toContainText('پنل نصب شد', { timeout: 30_000 })
  expect(fs.existsSync(path.join(projectsDir, 'e2e-site', 'clean', 'admin.html'))).toBe(true)
  expect(fs.existsSync(path.join(projectsDir, 'e2e-site', 'clean', 'pages.json'))).toBe(true)
  await modal.locator('.modal__foot').getByRole('button', { name: 'بستن' }).click()
})

test('external Node plugin runs with logs and output contract', async () => {
  const added = await win.evaluate((dir) => window.webforge.plugins.addPath(dir), pluginDir)
  expect(added.ok).toBe(true)
  if (!added.ok) return
  const result = await win.evaluate(
    (pluginId) => window.webforge.plugins.run(pluginId, null, {}),
    added.data.id
  )
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.data.run.status).toBe('success')
  expect(result.data.logs).toContain('PLUGIN_OK')
  expect(result.data.outputPaths.some((output: string) => output.endsWith('report.json'))).toBe(true)
  expect(fs.existsSync(path.join(pluginDir, 'report.json'))).toBe(true)
})

test('QA tester runs and produces a report', async () => {
  await win.locator('.sidebar .nav__item').filter({ hasText: 'تستر سایت' }).click()
  await expect(win.locator('.page-header__title')).toHaveText('تستر جامع سایت')
  await win.getByRole('button', { name: 'اجرای تست' }).click()
  await expect(win.getByText('امتیاز کلی کیفیت')).toBeVisible({ timeout: 150_000 })
  const reportPath = path.join(projectsDir, 'e2e-site', 'reports', 'qa-report.json')
  expect(fs.existsSync(reportPath)).toBe(true)
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as { score: number; findings: unknown[] }
  expect(report.score).toBeGreaterThan(0)
  expect(Array.isArray(report.findings)).toBe(true)
})

test('theme toggle persists', async () => {
  await win.locator('.sidebar .nav__item').filter({ hasText: 'تنظیمات' }).click()
  await expect(win.locator('.page-header__title')).toHaveText('تنظیمات')
  const before = await win.locator('html').getAttribute('data-theme')
  await win.locator('.titlebar .win-btn').first().click()
  await win.waitForTimeout(500)
  const after = await win.locator('html').getAttribute('data-theme')
  expect(after).not.toBe(before)
  await win.screenshot({ path: 'tests/e2e/final.png', fullPage: false })
})
