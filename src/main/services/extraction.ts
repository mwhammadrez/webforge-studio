import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { load, type CheerioAPI } from 'cheerio'
import postcss from 'postcss'
import type {
  ExtractionOptions,
  ExtractionProgress,
  ExtractionReport,
  ExtractionWarning,
  Project
} from '@shared/types'
import type { Logger } from '../core/logger'
import type { Database } from '../core/db'
import type { ProjectService } from './projects'
import { AppError } from '../core/errors'
import { assertPublicUrl } from '../core/url-guard'
import { ensureDir, sanitizeSegment } from '../core/fs-guard'

const USER_AGENT = 'WebForgeStudio/1.0 (+local desktop website extractor)'
const MAX_REDIRECTS = 8
const PER_REQUEST_TIMEOUT_MS = 30_000
const PER_RESOURCE_LIMIT = 30 * 1024 * 1024
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

type ResourceKind = 'html' | 'css' | 'js' | 'image' | 'font' | 'media' | 'json' | 'other'

interface ResourceRecord {
  url: string
  file: string
  kind: ResourceKind
  bytes: number
  status: 'ok' | 'failed' | 'skipped'
  reason?: string
  contentType?: string
}

interface PageTask {
  url: string
  depth: number
  file: string
}

interface FetchResult {
  buffer: Buffer
  contentType: string
  finalUrl: string
  status: number
}

export interface ExtractionHooks {
  onProgress: (progress: ExtractionProgress) => void
}

export class ExtractionService {
  private readonly db: Database
  private readonly projectsRoot: () => string
  private readonly projects: ProjectService
  private readonly logger: Logger
  private readonly controllers = new Map<string, AbortController>()
  private readonly renderedResources = new Map<string, string[]>()

  constructor(db: Database, projects: ProjectService, logger: Logger, projectsRoot: () => string) {
    this.db = db
    this.projects = projects
    this.logger = logger
    this.projectsRoot = projectsRoot
  }

  cancel(projectId: string): boolean {
    const controller = this.controllers.get(projectId)
    if (!controller) return false
    controller.abort()
    return true
  }

  isRunning(projectId: string): boolean {
    return this.controllers.has(projectId)
  }

  async extract(
    options: ExtractionOptions,
    hooks: ExtractionHooks,
    existingProjectId?: string
  ): Promise<ExtractionReport> {
    const started = Date.now()
    const safe = await assertPublicUrl(options.url)
    const sourceUrl = normalizeUrl(safe.url)
    const controller = new AbortController()
    let project: Project
    if (existingProjectId) {
      project = this.projects.get(existingProjectId)
      this.controllers.set(project.id, controller)
    } else {
      const created = this.projects.createFolder(options.name, options.outputRoot ?? this.projectsRoot())
      project = this.projects.register({
        name: created.name,
        dir: created.dir,
        sourceUrl,
        type: 'static',
        status: 'extracting'
      })
      this.controllers.set(project.id, controller)
    }
    this.projects.setStatus(project.id, 'extracting')
    const mirrorRoot = path.join(project.path, 'mirror')
    const cleanRoot = path.join(project.path, 'clean')
    ensureDir(mirrorRoot)
    ensureDir(cleanRoot)
    ensureDir(path.join(project.path, 'reports'))

    const warnings: ExtractionWarning[] = []
    const resources = new Map<string, ResourceRecord>()
    const pages: PageTask[] = [{ url: sourceUrl, depth: 0, file: 'index.html' }]
    const queuedPages = new Set([sourceUrl])
    const bytesLimit = options.maxBytesMb * 1024 * 1024
    let totalBytes = 0
    let failures = 0
    let skipped = 0
    let pagesDone = 0
    const cleanPageMap = new Map<string, string>()

    const progress = (
      phase: ExtractionProgress['phase'],
      currentUrl: string,
      completed: number,
      total: number,
      message: string
    ): void => {
      hooks.onProgress({
        projectId: project.id,
        phase,
        currentUrl,
        completed,
        total,
        bytes: totalBytes,
        warnings: warnings.length,
        message,
        elapsedMs: Date.now() - started
      })
    }

    try {
      progress('validating', sourceUrl, 0, 1, 'در حال بررسی آدرس و robots.txt…')
      const robots = options.respectRobots ? await this.fetchRobots(safe.url, controller.signal) : null
      const deadline = started + options.timeoutSeconds * 1000

      const pageQueue: PageTask[] = [...pages]
      while (pageQueue.length > 0) {
        if (controller.signal.aborted) throw new AppError('EXTRACTION_CANCELLED', 'استخراج لغو شد.')
        if (Date.now() > deadline) throw new AppError('EXTRACTION_TIMEOUT', 'زمان مجاز استخراج تمام شد.')
        if (resources.size >= options.maxFiles) {
          warnings.push({ url: pageQueue[0].url, reason: 'سقف تعداد فایل‌ها پر شد.' })
          break
        }
        const page = pageQueue.shift() as PageTask
        if (robots && !robots.allowed(page.url)) {
          warnings.push({ url: page.url, reason: 'robots.txt اجازهٔ خزش این مسیر را نمی‌دهد.' })
          skipped += 1
          continue
        }
        progress('downloading', page.url, pagesDone, pageQueue.length + pagesDone + 1, 'در حال دانلود صفحه…')
        try {
          const result = options.rendered
            ? await this.fetchRendered(page.url, controller.signal)
            : await this.fetchResource(page.url, controller.signal)
          if (result.buffer.length > PER_RESOURCE_LIMIT) throw new Error('حجم صفحه بیش از حد مجاز است.')
          totalBytes += result.buffer.length
          if (totalBytes > bytesLimit) {
            warnings.push({ url: page.url, reason: 'سقف حجم کل پر شد.' })
            break
          }
          const rawFile = path.join(mirrorRoot, page.file)
          ensureDir(path.dirname(rawFile))
          await fsp.writeFile(rawFile, result.buffer)
          const html = result.buffer.toString('utf8')
          const $ = load(html)
          const instrumented = this.instrumentPage($)
          const cleanHtml = instrumented.html()
          const cleanFile = path.join(cleanRoot, page.file)
          ensureDir(path.dirname(cleanFile))
          await fsp.writeFile(cleanFile, cleanHtml, 'utf8')
          cleanPageMap.set(page.url, page.file)
          pagesDone += 1
          resources.set(page.url, { url: page.url, file: page.file, kind: 'html', bytes: result.buffer.length, status: 'ok' })

          const discovered = this.discover($, new URL(result.finalUrl), sourceUrl)
          for (const asset of discovered.assets) {
            if (resources.size >= options.maxFiles) {
              warnings.push({ url: asset.url, reason: 'سقف تعداد فایل‌ها پر شد.' })
              break
            }
            if (resources.has(asset.url)) continue
            if (!asset.isInternal && !options.includeExternalAssets) {
              skipped += 1
              continue
            }
            if (asset.url.startsWith('data:') || asset.url.startsWith('blob:')) continue
            resources.set(asset.url, {
              url: asset.url,
              file: asset.file,
              kind: asset.kind,
              bytes: 0,
              status: 'ok'
            })
          }

          if (page.depth < options.maxDepth) {
            for (const link of discovered.links) {
              if (queuedPages.has(link)) continue
              if (!this.sameHost(link, sourceUrl)) continue
              if (robots && !robots.allowed(link)) {
                skipped += 1
                continue
              }
              if (queuedPages.size >= options.maxFiles) break
              queuedPages.add(link)
              const file = this.pageFileFor(link)
              pageQueue.push({ url: link, depth: page.depth + 1, file })
              resources.set(link, { url: link, file, kind: 'html', bytes: 0, status: 'ok' })
            }
          }
        } catch (error) {
          if (controller.signal.aborted) throw error
          failures += 1
          warnings.push({ url: page.url, reason: errorMessage(error) })
          this.logger.warn('PAGE_FETCH_FAILED', 'دریافت صفحه ناموفق بود.', { url: page.url, error: errorMessage(error) })
        }
      }

      const assets = [...resources.values()].filter((resource) => resource.kind !== 'html')
      progress('downloading', '', 0, assets.length, 'در حال دانلود دارایی‌ها…')
      const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4))
      let completed = 0
      let totalAssets = assets.length
      const queue = [...assets]
      const worker = async (): Promise<void> => {
        while (queue.length > 0) {
          if (controller.signal.aborted) return
          if (Date.now() > deadline) {
            warnings.push({ url: 'deadline', reason: 'زمان مجاز استخراج تمام شد.' })
            return
          }
          if (totalBytes > bytesLimit) {
            warnings.push({ url: 'limit', reason: 'سقف حجم کل پر شد.' })
            return
          }
          const resource = queue.shift()
          if (!resource) return
          if (resource.kind === 'html') continue
          try {
            await assertPublicUrl(resource.url)
            const result = await this.fetchResource(resource.url, controller.signal)
            if (result.buffer.length > PER_RESOURCE_LIMIT) {
              throw new Error('حجم فایل بیش از ۳۰ مگابایت است.')
            }
            resource.bytes = result.buffer.length
            resource.contentType = result.contentType
            totalBytes += result.buffer.length
            const target = path.join(cleanRoot, resource.file)
            ensureDir(path.dirname(target))
            let content = result.buffer
            if (resource.kind === 'css') {
              const cssText = result.buffer.toString('utf8')
              for (const childUrl of extractCssUrls(cssText, result.finalUrl)) {
                if (resources.has(childUrl) || resources.size >= options.maxFiles) continue
                if (!options.includeExternalAssets && !this.sameHost(childUrl, sourceUrl)) continue
                const childKind = kindForUrl(childUrl)
                if (childKind === 'html') continue
                const child = {
                  url: childUrl,
                  file: this.assetFileFor(childUrl, childKind),
                  kind: childKind,
                  bytes: 0,
                  status: 'ok' as const
                }
                resources.set(childUrl, child)
                queue.push(child)
                totalAssets += 1
              }
              content = Buffer.from(await this.rewriteCss(cssText, result.finalUrl, resources, target, cleanRoot))
            }
            await fsp.writeFile(target, content)
            resource.status = 'ok'
          } catch (error) {
            if (controller.signal.aborted) return
            resource.status = 'failed'
            resource.reason = errorMessage(error)
            warnings.push({ url: resource.url, reason: resource.reason })
            failures += 1
          } finally {
            completed += 1
            progress(
              'downloading',
              resource.url,
              completed,
              totalAssets,
              `دانلود ${completed} از ${totalAssets}`
            )
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()))

      progress('rewriting', '', completed, totalAssets, 'در حال بازنویسی مسیر فایل‌ها…')
      for (const [pageUrl, relativeFile] of cleanPageMap) {
        const file = path.join(cleanRoot, relativeFile)
        if (!fs.existsSync(file)) continue
        const html = await fsp.readFile(file, 'utf8')
        const rewritten = this.rewriteHtml(html, pageUrl, relativeFile, resources, cleanPageMap)
        await fsp.writeFile(file, rewritten, 'utf8')
      }

      progress('finishing', '', completed, totalAssets, 'در حال نوشتن مانیفست…')
      const manifest = {
        schema: 'webforge.extraction/1',
        projectId: project.id,
        sourceUrl,
        mode: options.rendered ? 'rendered' : 'http',
        extractedAt: new Date().toISOString(),
        options,
        pages: pagesDone,
        assets: [...resources.values()].filter((resource) => resource.kind !== 'html' && resource.status === 'ok').length,
        totalBytes,
        files: [...resources.values()].map((resource) => ({
          url: resource.url,
          file: resource.file.split(path.sep).join('/'),
          kind: resource.kind,
          bytes: resource.bytes,
          status: resource.status,
          reason: resource.reason,
          sha256:
            resource.status === 'ok' && fs.existsSync(path.join(cleanRoot, resource.file))
              ? sha256File(path.join(cleanRoot, resource.file))
              : null
        })),
        warnings,
        skipped
      }
      await fsp.writeFile(path.join(project.path, 'webforge.manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
      const partial = failures > 0 || warnings.length > 0 || skipped > 0
      const report: ExtractionReport = {
        projectId: project.id,
        projectPath: project.path,
        sourceUrl,
        mode: options.rendered ? 'rendered' : 'http',
        pages: pagesDone,
        assets: manifest.assets,
        bytes: totalBytes,
        skipped,
        warnings,
        durationMs: Date.now() - started,
        partial,
        manifestPath: path.join(project.path, 'webforge.manifest.json')
      }
      await fsp.writeFile(
        path.join(project.path, 'reports', 'extraction-report.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      )
      await fsp.writeFile(
        path.join(project.path, 'README-WEBFORGE.md'),
        [
          `# ${project.name}`,
          '',
          `این پوشه با WebForge Studio از ${sourceUrl} استخراج شد.`,
          '',
          `- صفحات: ${report.pages}`,
          `- دارایی‌ها: ${report.assets}`,
          `- حجم: ${(report.bytes / 1024 / 1024).toFixed(2)} مگابایت`,
          `- وضعیت: ${partial ? 'با هشدار' : 'کامل'}`,
          '',
          'پوشهٔ `mirror/` نسخهٔ خام و پوشهٔ `clean/` نسخهٔ قابل‌اجرا و قابل‌ویرایش است.',
          'برای پیش‌نمایش، فایل `clean/index.html` را باز کن.'
        ].join('\n'),
        'utf8'
      )
      this.projects.setStatus(project.id, partial ? 'partial' : 'ready')
      this.dbRunExtraction(project.id, sourceUrl, options.rendered ? 'rendered' : 'http', 'success', report)
      this.logger.info('EXTRACTION_DONE', 'استخراج کامل شد.', {
        projectId: project.id,
        pages: report.pages,
        assets: report.assets,
        bytes: report.bytes
      })
      return report
    } catch (error) {
      const message = errorMessage(error)
      const cancelled = controller.signal.aborted || (error instanceof AppError && error.code === 'EXTRACTION_CANCELLED')
      this.projects.setStatus(project.id, cancelled ? 'partial' : 'error')
      this.dbRunExtraction(
        project.id,
        sourceUrl,
        options.rendered ? 'rendered' : 'http',
        cancelled ? 'cancelled' : 'failed',
        {
          projectId: project.id,
          projectPath: project.path,
          sourceUrl,
          mode: options.rendered ? 'rendered' : 'http',
          pages: pagesDone,
          assets: 0,
          bytes: totalBytes,
          skipped,
          warnings,
          durationMs: Date.now() - started,
          partial: true,
          manifestPath: path.join(project.path, 'webforge.manifest.json')
        },
        message
      )
      this.logger.error('EXTRACTION_FAILED', 'استخراج ناموفق بود.', { projectId: project.id, error: message })
      if (cancelled) {
        throw new AppError('EXTRACTION_CANCELLED', 'استخراج لغو شد؛ فایل‌های دانلودشده حفظ شدند.')
      }
      throw error
    } finally {
      this.controllers.delete(project.id)
    }
  }

  private dbRunExtraction(
    projectId: string,
    sourceUrl: string,
    mode: string,
    status: string,
    report: ExtractionReport,
    error?: string
  ): void {
    try {
      this.db.run(
        `INSERT INTO extraction_runs (id, project_id, source_url, mode, status, started_at, finished_at, pages, assets, bytes, skipped, warnings, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        projectId,
        sourceUrl,
        mode,
        status,
        new Date(Date.now() - report.durationMs).toISOString(),
        new Date().toISOString(),
        report.pages,
        report.assets,
        report.bytes,
        report.skipped,
        JSON.stringify(report.warnings.slice(0, 200)),
        error ?? null
      )
    } catch {
      // History is best effort; the extraction report is the source of truth.
    }
  }

  private async fetchRobots(url: URL, signal: AbortSignal): Promise<{ allowed: (target: string) => boolean } | null> {
    try {
      const robotsUrl = new URL('/robots.txt', url.origin).toString()
      const response = await this.fetchResource(robotsUrl, signal)
      const lines = response.buffer.toString('utf8').split(/\r?\n/)
      const disallow: string[] = []
      let applies = false
      for (const line of lines) {
        const clean = line.split('#')[0].trim()
        if (!clean) continue
        const [rawKey, ...rest] = clean.split(':')
        const key = rawKey.trim().toLowerCase()
        const value = rest.join(':').trim()
        if (key === 'user-agent') applies = value === '*' || value.toLowerCase().includes('webforge')
        else if (key === 'disallow' && applies && value) disallow.push(value)
      }
      return {
        allowed: (target: string) => {
          try {
            const pathname = new URL(target).pathname
            return !disallow.some((rule) => rule !== '/' && pathname.startsWith(rule))
          } catch {
            return false
          }
        }
      }
    } catch {
      return null
    }
  }

  private async fetchResource(rawUrl: string, signal: AbortSignal): Promise<FetchResult> {
    let current = new URL(rawUrl)
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await assertPublicUrl(current.toString())
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS)
      const onAbort = (): void => controller.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const response = await fetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8'
          }
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location')
          if (!location) throw new AppError('BAD_REDIRECT', 'تغییر مسیر بدون مقصد.')
          current = new URL(location, current)
          continue
        }
        if (RETRYABLE.has(response.status)) {
          throw new AppError('HTTP_' + response.status, `سرور با کد ${response.status} پاسخ داد.`, 502)
        }
        if (!response.ok) {
          throw new AppError('HTTP_' + response.status, `سرور با کد ${response.status} پاسخ داد.`, 404)
        }
        const contentLength = Number(response.headers.get('content-length') ?? 0)
        if (contentLength > PER_RESOURCE_LIMIT) {
          throw new AppError('RESOURCE_TOO_LARGE', 'حجم فایل بیش از حد مجاز است.', 413)
        }
        const arrayBuffer = await response.arrayBuffer()
        return {
          buffer: Buffer.from(arrayBuffer),
          contentType: response.headers.get('content-type') ?? '',
          finalUrl: current.toString(),
          status: response.status
        }
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
    }
    throw new AppError('TOO_MANY_REDIRECTS', 'تعداد تغییر مسیرها بیش از حد مجاز است.', 502)
  }

  private async fetchRendered(url: string, signal: AbortSignal): Promise<FetchResult> {
    const { BrowserWindow } = await import('electron')
    if (signal.aborted) throw new AppError('EXTRACTION_CANCELLED', 'استخراج لغو شد.')
    const window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: `webforge-scrape-${Date.now()}`,
        images: true,
        javascript: true
      }
    })
    const session = window.webContents.session
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.on('will-download', (event) => event.preventDefault())
    try {
      const loaded = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('زمان بارگذاری صفحهٔ رندرشده تمام شد.')), 45_000)
        window.webContents.once('did-finish-load', () => {
          clearTimeout(timer)
          resolve()
        })
        window.webContents.once('did-fail-load', (_event, code, description) => {
          clearTimeout(timer)
          reject(new Error(`بارگذاری صفحه ناموفق بود (${code}: ${description}).`))
        })
      })
      await window.loadURL(url)
      await loaded
      await new Promise((resolve) => setTimeout(resolve, 1200))
      if (signal.aborted) throw new AppError('EXTRACTION_CANCELLED', 'استخراج لغو شد.')
      const payload = (await window.webContents.executeJavaScript(
        `(() => {
          const html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
          const resources = performance.getEntriesByType('resource').map(r => r.name);
          return { html, resources };
        })()`,
        true
      )) as { html: string; resources: string[] }
      this.renderedResources.set(url, payload.resources)
      return {
        buffer: Buffer.from(payload.html, 'utf8'),
        contentType: 'text/html; rendered=true',
        finalUrl: window.webContents.getURL() || url,
        status: 200
      }
    } finally {
      window.destroy()
    }
  }

  private discover(
    $: CheerioAPI,
    base: URL,
    sourceUrl: string
  ): { assets: Array<{ url: string; file: string; kind: ResourceKind; isInternal: boolean }>; links: string[] } {
    const assets = new Map<string, { url: string; file: string; kind: ResourceKind; isInternal: boolean }>()
    const links = new Set<string>()
    const addAsset = (raw: string | undefined, kindHint?: ResourceKind): void => {
      if (!raw) return
      const trimmed = raw.trim()
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:'))
        return
      let absolute: URL
      try {
        absolute = new URL(trimmed, base)
      } catch {
        return
      }
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return
      absolute.hash = ''
      const url = normalizeUrl(absolute)
      if (assets.has(url)) return
      const kind = kindHint ?? kindForUrl(url)
      assets.set(url, {
        url,
        file: this.assetFileFor(url, kind),
        kind,
        isInternal: this.sameHost(url, sourceUrl)
      })
    }
    const addSrcset = (value: string | undefined): void => {
      if (!value) return
      for (const part of value.split(',')) {
        const url = part.trim().split(/\s+/)[0]
        addAsset(url, 'image')
      }
    }

    $('img').each((_index, element) => {
      const node = $(element)
      addAsset(node.attr('src'), 'image')
      addSrcset(node.attr('srcset'))
      addAsset(node.attr('data-src'), 'image')
      addAsset(node.attr('data-lazy-src'), 'image')
    })
    $('picture source').each((_index, element) => addSrcset($(element).attr('srcset')))
    $('script[src]').each((_index, element) => addAsset($(element).attr('src'), 'js'))
    $('link[href]').each((_index, element) => {
      const rel = ($(element).attr('rel') ?? '').toLowerCase()
      if (rel.includes('stylesheet')) addAsset($(element).attr('href'), 'css')
      else if (rel.includes('icon') || rel.includes('apple-touch')) addAsset($(element).attr('href'), 'image')
      else if (rel.includes('preload') || rel.includes('modulepreload')) {
        const as = ($(element).attr('as') ?? '').toLowerCase()
        addAsset($(element).attr('href'), as === 'style' ? 'css' : as === 'script' ? 'js' : as === 'font' ? 'font' : undefined)
      }
    })
    $('video, audio').each((_index, element) => {
      const node = $(element)
      addAsset(node.attr('src'), 'media')
      addAsset(node.attr('poster'), 'image')
      node.find('source[src]').each((_i, source) => addAsset($(source).attr('src'), 'media'))
    })
    $('iframe[src]').each((_index, element) => addAsset($(element).attr('src'), 'html'))
    $('object[data]').each((_index, element) => addAsset($(element).attr('data')))
    $('embed[src]').each((_index, element) => addAsset($(element).attr('src')))
    $('[style]').each((_index, element) => {
      const style = $(element).attr('style') ?? ''
      for (const match of style.matchAll(/url\((['"]?)(.*?)\1\)/gi)) addAsset(match[2], 'image')
    })

    $('a[href]').each((_index, element) => {
      const href = $(element).attr('href')
      if (!href) return
      const trimmed = href.trim()
      if (trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return
      try {
        const absolute = new URL(trimmed, base)
        if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return
        absolute.hash = ''
        links.add(normalizeUrl(absolute))
      } catch {
        return
      }
    })

    const rendered = this.renderedResources.get(base.toString())
    if (rendered) {
      for (const resource of rendered) addAsset(resource)
    }
    return { assets: [...assets.values()], links: [...links] }
  }

  private instrumentPage($: CheerioAPI): CheerioAPI {
    $('base').remove()
    return $
  }

  private rewriteHtml(
    html: string,
    pageUrl: string,
    pageFile: string,
    resources: Map<string, ResourceRecord>,
    pages: Map<string, string>
  ): string {
    const $ = load(html)
    const rewrite = (raw: string | undefined, kind?: ResourceKind): string | undefined => {
      if (!raw) return raw
      const trimmed = raw.trim()
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:'))
        return raw
      if (trimmed.startsWith('javascript:')) return raw
      let absolute: URL
      try {
        absolute = new URL(trimmed, pageUrl)
      } catch {
        return raw
      }
      absolute.hash = ''
      const key = normalizeUrl(absolute)
      const record = kind ? resources.get(key) : resources.get(key)
      const pageTarget = pages.get(key)
      const target = pageTarget ? path.join('clean', pageTarget) : record && record.status === 'ok' ? path.join('clean', record.file) : null
      if (!target) return raw
      const currentDir = path.dirname(path.join('clean', pageFile))
      const relative = path.relative(currentDir, target).split(path.sep).join('/')
      return relative.length === 0 ? './' : relative
    }

    $('img').each((_index, element) => {
      const node = $(element)
      const src = node.attr('src')
      if (src) node.attr('src', rewrite(src, 'image') ?? src)
      const srcset = node.attr('srcset')
      if (srcset) node.attr('srcset', rewriteSrcset(srcset, rewrite))
      const dataSrc = node.attr('data-src')
      if (dataSrc) node.attr('data-src', rewrite(dataSrc, 'image') ?? dataSrc)
    })
    $('source').each((_index, element) => {
      const node = $(element)
      const srcset = node.attr('srcset')
      if (srcset) node.attr('srcset', rewriteSrcset(srcset, rewrite))
      const src = node.attr('src')
      if (src) node.attr('src', rewrite(src) ?? src)
    })
    $('script[src]').each((_index, element) => {
      const node = $(element)
      node.attr('src', rewrite(node.attr('src'), 'js') ?? node.attr('src') ?? '')
      node.removeAttr('integrity')
    })
    $('link[href]').each((_index, element) => {
      const node = $(element)
      const before = node.attr('href')
      node.attr('href', rewrite(before) ?? before ?? '')
      node.removeAttr('integrity')
    })
    $('video, audio, iframe, embed, object').each((_index, element) => {
      const node = $(element)
      for (const attribute of ['src', 'poster', 'data']) {
        const value = node.attr(attribute)
        if (value) node.attr(attribute, rewrite(value) ?? value)
      }
      node.find('source[src]').each((_i, source) => {
        const sourceNode = $(source)
        sourceNode.attr('src', rewrite(sourceNode.attr('src')) ?? sourceNode.attr('src') ?? '')
      })
    })
    $('[style]').each((_index, element) => {
      const node = $(element)
      const style = node.attr('style')
      if (!style) return
      node.attr(
        'style',
        style.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote: string, url: string) => {
          const next = rewrite(url)
          return next ? `url(${quote}${next}${quote})` : match
        })
      )
    })
    $('a[href]').each((_index, element) => {
      const node = $(element)
      const href = node.attr('href')
      if (!href) return
      const next = rewrite(href)
      if (next) node.attr('href', next)
    })
    return $.html()
  }

  private async rewriteCss(
    css: string,
    cssUrl: string,
    resources: Map<string, ResourceRecord>,
    cssFile: string,
    cleanRoot: string
  ): Promise<string> {
    const root = postcss.parse(css, { from: cssFile })
    const rewriteUrl = (raw: string): string => {
      const trimmed = raw.trim()
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return raw
      let absolute: URL
      try {
        absolute = new URL(trimmed, cssUrl)
      } catch {
        return raw
      }
      absolute.hash = ''
      const key = normalizeUrl(absolute)
      const record = resources.get(key)
      if (!record || record.status !== 'ok') return raw
      const cssDir = path.dirname(path.relative(cleanRoot, cssFile))
      const relative = path.relative(cssDir, record.file).split(path.sep).join('/')
      return relative
    }
    root.walkDecls((decl) => {
      if (decl.value.includes('url(')) {
        decl.value = decl.value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, quote: string, url: string) => {
          const next = rewriteUrl(url)
          return next === url ? match : `url(${quote}${next}${quote})`
        })
      }
    })
    root.walkAtRules('import', (rule) => {
      const match = rule.params.match(/url\(\s*(['"]?)(.*?)\1\s*\)|(['"])(.*?)\3/i)
      if (match) {
        const raw = match[2] ?? match[4]
        const next = rewriteUrl(raw)
        if (next !== raw) rule.params = rule.params.replace(raw, next)
      }
    })
    return root.toString()
  }

  private sameHost(candidate: string, base: string): boolean {
    try {
      const left = new URL(candidate)
      const right = new URL(base)
      return left.hostname === right.hostname
    } catch {
      return false
    }
  }

  private pageFileFor(url: string): string {
    try {
      const parsed = new URL(url)
      let pathname = decodeURIComponent(parsed.pathname)
      if (pathname.endsWith('/')) pathname += 'index.html'
      if (!path.extname(pathname)) pathname += '/index.html'
      const segments = pathname.split('/').filter(Boolean).map((segment) => sanitizeSegment(segment))
      if (segments.length === 0) return 'index.html'
      return segments.join('/')
    } catch {
      return 'index.html'
    }
  }

  private assetFileFor(url: string, kind: ResourceKind): string {
    try {
      const parsed = new URL(url)
      let pathname = decodeURIComponent(parsed.pathname)
      if (pathname.endsWith('/') || !pathname) pathname += 'index.html'
      if (!path.extname(pathname)) {
        const ext = defaultExtension(kind)
        pathname += ext
      }
      const segments = pathname.split('/').filter(Boolean).map((segment) => sanitizeSegment(segment))
      const last = segments.pop() ?? `asset${defaultExtension(kind)}`
      const parsedLast = path.parse(last)
      const queryHash = parsed.search ? `-${sha256(parsed.search).slice(0, 8)}` : ''
      segments.push(`${parsedLast.name}${queryHash}${parsedLast.ext}`)
      return segments.join('/')
    } catch {
      return `asset-${Date.now()}${defaultExtension(kind)}`
    }
  }
}

function extractCssUrls(css: string, base: string): string[] {
  const urls = new Set<string>()
  const add = (raw: string): void => {
    const value = raw.trim().replace(/^['"]|['"]$/g, '')
    if (!value || value.startsWith('data:') || value.startsWith('#') || value.startsWith('blob:')) return
    try {
      const url = new URL(value, base)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return
      url.hash = ''
      urls.add(url.toString())
    } catch {
      // Invalid url is ignored; the CSS is left unchanged.
    }
  }
  for (const match of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) add(match[2])
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?(['"])(.*?)\1/gi)) add(match[2])
  return [...urls]
}

function normalizeUrl(value: URL | string): string {
  const url = typeof value === 'string' ? new URL(value) : new URL(value.toString())
  url.hash = ''
  return url.toString()
}

function kindForUrl(url: string): ResourceKind {
  const pathname = url.split('?')[0].toLowerCase()
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/.test(pathname)) return 'image'
  if (/\.css$/.test(pathname)) return 'css'
  if (/\.(m?js|jsx|ts|tsx)$/.test(pathname)) return 'js'
  if (/\.(woff2?|ttf|otf|eot)$/.test(pathname)) return 'font'
  if (/\.(mp4|webm|ogg|mp3|wav|m4a|mov)$/.test(pathname)) return 'media'
  if (/\.json$/.test(pathname)) return 'json'
  if (/\.html?$/.test(pathname)) return 'html'
  return 'other'
}

function defaultExtension(kind: ResourceKind): string {
  switch (kind) {
    case 'css':
      return '.css'
    case 'js':
      return '.js'
    case 'image':
      return '.bin'
    case 'font':
      return '.woff2'
    case 'html':
      return '.html'
    case 'json':
      return '.json'
    case 'media':
      return '.mp4'
    default:
      return '.bin'
  }
}

function rewriteSrcset(
  value: string,
  rewrite: (raw: string | undefined, kind?: ResourceKind) => string | undefined
): string {
  return value
    .split(',')
    .map((part) => {
      const pieces = part.trim().split(/\s+/)
      const url = pieces.shift()
      if (!url) return ''
      const next = rewrite(url, 'image') ?? url
      return [next, ...pieces].join(' ')
    })
    .filter(Boolean)
    .join(', ')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'درخواست لغو شد.'
    return error.message
  }
  return 'خطای ناشناخته'
}
