import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { QaFinding, QaReport } from '@shared/types'
import type { Logger } from '../core/logger'
import type { PreviewService } from './preview'
import type { ProjectService } from './projects'
import { AppError } from '../core/errors'
import { ensureDir } from '../core/fs-guard'

interface AxeNode {
  html: string
  target: string[]
  failureSummary?: string
}

interface AxeViolation {
  id: string
  impact: string | null
  help: string
  helpUrl: string
  description: string
  nodes: AxeNode[]
}

interface PageAudit {
  url: string
  findings: QaFinding[]
  metrics: {
    lcpMs: number | null
    domContentLoadedMs: number | null
    loadMs: number | null
    transferKb: number
  }
}

const VIEWPORTS = [
  { width: 375, height: 812, label: 'mobile' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 1440, height: 900, label: 'desktop' }
]

export class QaService {
  private readonly preview: PreviewService
  private readonly projects: ProjectService
  private readonly logger: Logger
  private readonly controllers = new Map<string, AbortController>()

  constructor(preview: PreviewService, projects: ProjectService, logger: Logger) {
    this.preview = preview
    this.projects = projects
    this.logger = logger
  }

  cancel(projectId: string): boolean {
    const controller = this.controllers.get(projectId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async run(projectId: string, pages: string[], checks: string[]): Promise<QaReport> {
    const project = this.projects.get(projectId)
    const controller = new AbortController()
    this.controllers.set(projectId, controller)
    const started = Date.now()
    const startedAt = new Date().toISOString()
    const wasRunning = this.preview.state(projectId).running
    const state = await this.preview.start(projectId)
    if (!state.url) throw new AppError('PREVIEW_FAILED', 'اجرای پیش‌نمایش برای تست ناموفق بود.')
    const findings: QaFinding[] = []
    const auditPages = pages.length > 0 ? pages : await this.discoverPages(project.path)
    const pageMetrics: PageAudit['metrics'][] = []
    try {
      for (const page of auditPages.slice(0, 40)) {
        if (controller.signal.aborted) throw new AppError('QA_CANCELLED', 'تست لغو شد.')
        const url = new URL(page, `${state.url}/`).toString()
        const audit = await this.auditPage(url, checks, controller.signal)
        findings.push(...audit.findings)
        pageMetrics.push(audit.metrics)
      }
      const score = computeScore(findings)
      const report: QaReport = {
        projectId,
        startedAt,
        durationMs: Date.now() - started,
        score,
        findings,
        metrics: {
          pages: auditPages.length,
          lcpMs: median(pageMetrics.map((metric) => metric.lcpMs).filter((value): value is number => value !== null)),
          domContentLoadedMs: median(
            pageMetrics.map((metric) => metric.domContentLoadedMs).filter((value): value is number => value !== null)
          ),
          loadMs: median(pageMetrics.map((metric) => metric.loadMs).filter((value): value is number => value !== null)),
          transferKb: pageMetrics.reduce((sum, metric) => sum + metric.transferKb, 0),
          consoleErrors: findings.filter((finding) => finding.category === 'console').length,
          failedRequests: findings.filter((finding) => finding.category === 'links' && finding.severity === 'major').length,
          imagesWithoutAlt: findings.filter((finding) => finding.message.includes('بدون متن جایگزین')).length
        }
      }
      ensureDir(path.join(project.path, 'reports'))
      await fsp.writeFile(path.join(project.path, 'reports', 'qa-report.json'), JSON.stringify(report, null, 2), 'utf8')
      this.logger.info('QA_DONE', 'تست سایت کامل شد.', { projectId, score, findings: findings.length })
      return report
    } finally {
      this.controllers.delete(projectId)
      if (!wasRunning) await this.preview.stop(projectId)
    }
  }

  private async discoverPages(root: string): Promise<string[]> {
    const siteRoot = fs.existsSync(path.join(root, 'clean')) ? path.join(root, 'clean') : root
    const pages: string[] = []
    const walk = (dir: string, depth: number): void => {
      if (depth > 5 || pages.length >= 40) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['assets', 'reports', 'node_modules', '.webforge', 'mirror'].includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, depth + 1)
        else if (/\.html?$/i.test(entry.name) && entry.name !== 'admin.html')
          pages.push(path.relative(siteRoot, full).split(path.sep).join('/'))
      }
    }
    walk(siteRoot, 0)
    pages.sort((left, right) => {
      if (left === 'index.html') return -1
      if (right === 'index.html') return 1
      return left.localeCompare(right)
    })
    return pages.length > 0 ? pages : ['index.html']
  }

  private async auditPage(url: string, checks: string[], signal: AbortSignal): Promise<PageAudit> {
    const window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: `webforge-qa-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        images: true
      }
    })
    const findings: QaFinding[] = []
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const responseHeaders: Record<string, string> = {}
    const session = window.webContents.session
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.on('will-download', (event) => event.preventDefault())
    session.webRequest.onHeadersReceived((details, callback) => {
      if (!Object.keys(responseHeaders).length) {
        for (const [name, values] of Object.entries(details.responseHeaders ?? {})) {
          responseHeaders[name.toLowerCase()] = (values ?? []).join(', ')
        }
      }
      callback({ responseHeaders: details.responseHeaders })
    })
    session.webRequest.onCompleted((details) => {
      if (details.statusCode >= 400) failedRequests.push(`${details.statusCode} ${details.url}`)
    })
    session.webRequest.onErrorOccurred((details) => {
      if (!details.url.startsWith('devtools://')) failedRequests.push(`FAILED ${details.url}`)
    })
    window.webContents.on('console-message', (...args: unknown[]) => {
      const last = args[args.length - 1] as { level?: string; message?: string } | string
      const level = typeof last === 'object' ? last.level : args[1]
      const message = typeof last === 'object' ? last.message : args[2]
      if (level === 'error' || level === 3) consoleErrors.push(String(message ?? ''))
    })

    try {
      await window.loadURL(url)
      await new Promise((resolve) => setTimeout(resolve, 900))
      if (signal.aborted) throw new AppError('QA_CANCELLED', 'تست لغو شد.')
      const pageInfo = (await window.webContents.executeJavaScript(PAGE_AUDIT_SCRIPT, true)) as {
        title: string
        lang: string
        description: string
        canonical: string
        h1Count: number
        h1Text: string
        imagesWithoutAlt: number
        emptyLinks: number
        duplicateIds: string[]
        hasDoctype: boolean
        viewport: string
        internalLinks: string[]
        overflow: Record<string, number>
        performance: { lcpMs: number | null; domContentLoadedMs: number | null; loadMs: number | null; transferKb: number }
      }
      if (checks.includes('seo')) {
        if (!pageInfo.title || pageInfo.title.trim().length < 8)
          findings.push(finding('seo', 'major', 'عنوان صفحه وجود ندارد یا خیلی کوتاه است.', url))
        if (!pageInfo.description)
          findings.push(finding('seo', 'minor', 'توضیح متا (meta description) وجود ندارد.', url))
        if (!pageInfo.canonical) findings.push(finding('seo', 'info', 'لینک canonical تعریف نشده است.', url))
        if (!pageInfo.lang) findings.push(finding('seo', 'major', 'زبان سند (lang) تعیین نشده است.', url))
        if (pageInfo.h1Count === 0) findings.push(finding('seo', 'major', 'صفحه h1 ندارد.', url))
        if (pageInfo.h1Count > 1) findings.push(finding('seo', 'major', `صفحه ${pageInfo.h1Count} عدد h1 دارد.`, url))
        if (!pageInfo.viewport) findings.push(finding('seo', 'major', 'تگ viewport وجود ندارد.', url))
      }
      if (checks.includes('html')) {
        if (!pageInfo.hasDoctype) findings.push(finding('html', 'minor', 'doctype در ابتدای سند نیست.', url))
        if (pageInfo.duplicateIds.length > 0)
          findings.push(finding('html', 'major', `شناسهٔ تکراری: ${pageInfo.duplicateIds.slice(0, 6).join('، ')}`, url))
        if (pageInfo.imagesWithoutAlt > 0)
          findings.push(finding('html', 'major', `${pageInfo.imagesWithoutAlt} تصویر بدون متن جایگزین (alt).`, url))
        if (pageInfo.emptyLinks > 0)
          findings.push(finding('html', 'minor', `${pageInfo.emptyLinks} لینک بدون متن یا aria-label.`, url))
      }
      if (checks.includes('console')) {
        for (const message of [...new Set(consoleErrors)].slice(0, 8)) {
          findings.push(finding('console', 'major', `خطای کنسول: ${message.slice(0, 220)}`, url))
        }
      }
      if (checks.includes('links')) {
        for (const failure of [...new Set(failedRequests)].slice(0, 12)) {
          findings.push(finding('links', 'major', `درخواست ناموفق: ${failure.slice(0, 260)}`, url))
        }
        const broken = await this.checkLinks(pageInfo.internalLinks, url)
        for (const item of broken.slice(0, 15)) {
          findings.push(finding('links', 'major', `لینک خراب (${item.status}): ${item.url}`, url))
        }
      }
      if (checks.includes('security')) {
        const required: Array<[string, string]> = [
          ['content-security-policy', 'سیاست امنیتی محتوا (CSP) تنظیم نشده است.'],
          ['x-content-type-options', 'هدر X-Content-Type-Options تنظیم نشده است.'],
          ['referrer-policy', 'هدر Referrer-Policy تنظیم نشده است.'],
          ['x-frame-options', 'هدر X-Frame-Options تنظیم نشده است.']
        ]
        for (const [header, message] of required) {
          if (!responseHeaders[header]) findings.push(finding('security', 'info', message, url))
        }
      }
      if (checks.includes('responsive')) {
        for (const viewport of VIEWPORTS) {
          window.setContentSize(viewport.width, viewport.height)
          await new Promise((resolve) => setTimeout(resolve, 250))
          const overflow = (await window.webContents.executeJavaScript(
            `Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`,
            true
          )) as number
          if (overflow > 2) {
            findings.push(
              finding('responsive', 'major', `سرریز افقی در عرض ${viewport.width}px حدود ${overflow}px است.`, url)
            )
          }
        }
      }
      if (checks.includes('a11y')) {
        const axeSource = readAxe()
        await window.webContents.executeJavaScript(axeSource, true)
        const results = (await window.webContents.executeJavaScript(
          `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] }, resultTypes: ['violations'] }).then(r => r.violations)`,
          true
        )) as AxeViolation[]
        for (const violation of results) {
          findings.push({
            tool: 'axe-core',
            category: 'a11y',
            severity: violation.impact === 'critical' ? 'critical' : violation.impact === 'serious' ? 'major' : 'minor',
            message: `${violation.help} (${violation.id}) — ${violation.nodes.length} مورد`,
            url,
            selector: violation.nodes[0]?.target?.join(' '),
            help: violation.helpUrl
          })
        }
      }
      return {
        url,
        findings,
        metrics: {
          ...pageInfo.performance,
          transferKb: pageInfo.performance.transferKb
        }
      }
    } finally {
      window.destroy()
    }
  }

  private async checkLinks(links: string[], baseUrl: string): Promise<Array<{ url: string; status: number }>> {
    const unique = [...new Set(links)].slice(0, 40)
    const broken: Array<{ url: string; status: number }> = []
    const base = new URL(baseUrl)
    for (const link of unique) {
      let target: URL
      try {
        target = new URL(link, base)
      } catch {
        continue
      }
      if (target.hostname !== base.hostname) continue
      try {
        const response = await fetch(target, { method: 'GET', signal: AbortSignal.timeout(8000) })
        if (response.status >= 400) broken.push({ url: target.toString(), status: response.status })
      } catch {
        broken.push({ url: target.toString(), status: 0 })
      }
    }
    return broken
  }
}

const PAGE_AUDIT_SCRIPT = `(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource');
  const transfer = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
  const ids = new Map();
  document.querySelectorAll('[id]').forEach(el => { ids.set(el.id, (ids.get(el.id) || 0) + 1); });
  const duplicateIds = [...ids.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && !h.startsWith('#') && !h.startsWith('mailto:') && !h.startsWith('tel:'));
  const h1 = document.querySelectorAll('h1');
  const overflow = {};
  return {
    title: document.title,
    lang: document.documentElement.lang,
    description: (document.querySelector('meta[name="description"]') || {}).content || '',
    canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '',
    h1Count: h1.length,
    h1Text: h1[0] ? h1[0].textContent.trim().slice(0, 160) : '',
    imagesWithoutAlt: [...document.images].filter(img => !img.hasAttribute('alt')).length,
    emptyLinks: [...document.querySelectorAll('a[href]')].filter(a => !a.textContent.trim() && !a.getAttribute('aria-label')).length,
    duplicateIds,
    hasDoctype: /^<!doctype/i.test(document.documentElement.outerHTML.slice(0, 100)) || document.compatMode === 'CSS1Compat',
    viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
    internalLinks: links,
    overflow,
    performance: {
      lcpMs: (() => { const e = performance.getEntriesByType('largest-contentful-paint'); return e.length ? Math.round(e[e.length - 1].startTime) : null; })(),
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
      transferKb: Math.round(transfer / 1024)
    }
  };
})()`

function readAxe(): string {
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'axe-core', 'axe.min.js'),
    path.join(process.resourcesPath, 'axe.min.js'),
    path.join(process.resourcesPath, 'node_modules', 'axe-core', 'axe.min.js')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8')
  }
  throw new AppError('AXE_MISSING', 'موتور بررسی دسترس‌پذیری (axe-core) پیدا نشد.')
}

function finding(
  category: QaFinding['category'],
  severity: QaFinding['severity'],
  message: string,
  url?: string
): QaFinding {
  return { tool: 'webforge-qa', category, severity, message, url }
}

function computeScore(findings: QaFinding[]): number {
  const weights: Record<QaFinding['severity'], number> = { critical: 12, major: 5, minor: 2, info: 0 }
  const penalty = findings.reduce((sum, item) => sum + weights[item.severity], 0)
  return Math.max(0, Math.min(100, 100 - penalty))
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle]
}
