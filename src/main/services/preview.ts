import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import chokidar, { type FSWatcher } from 'chokidar'
import mime from 'mime-types'
import type { PreviewState, Project } from '@shared/types'
import type { Logger } from '../core/logger'
import type { ProjectService } from './projects'
import { AppError } from '../core/errors'
import { assertInside, ensureDir, sanitizeSegment } from '../core/fs-guard'
import { EDITOR_SCRIPT } from './editor-client'

interface RunningPreview {
  projectId: string
  server: http.Server
  port: number
  url: string
  root: string
  startedAt: string
  watcher: FSWatcher
  clients: Set<http.ServerResponse>
}

const UPLOAD_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
  ['image/gif', '.gif'],
  ['video/webm', '.webm'],
  ['video/mp4', '.mp4']
])

export class PreviewService {
  private readonly projects: ProjectService
  private readonly logger: Logger
  private readonly portStart: () => number
  private readonly portEnd: () => number
  private readonly running = new Map<string, RunningPreview>()

  constructor(projects: ProjectService, logger: Logger, portRange: () => { start: number; end: number }) {
    this.projects = projects
    this.logger = logger
    this.portStart = () => portRange().start
    this.portEnd = () => portRange().end
  }

  async start(projectId: string): Promise<PreviewState> {
    const existing = this.running.get(projectId)
    if (existing) return this.state(projectId)
    const project = this.projects.get(projectId)
    const root = this.resolveRoot(project)
    if (!fs.existsSync(root)) throw new AppError('PROJECT_FOLDER_MISSING', 'پوشهٔ پروژه وجود ندارد.', 404)
    const port = await this.findPort(this.portStart(), this.portEnd())
    const preview: RunningPreview = {
      projectId,
      server: http.createServer((request, response) => {
        void this.handle(preview, project, request, response)
      }),
      port,
      url: `http://127.0.0.1:${port}`,
      root,
      startedAt: new Date().toISOString(),
      clients: new Set(),
      watcher: chokidar.watch(root, {
        ignoreInitial: true,
        ignored: /(^|[/\\])(\.webforge|node_modules|\.git)([/\\]|$)/,
        depth: 8
      })
    }
    preview.watcher.on('all', () => {
      this.broadcast(preview)
    })
    await new Promise<void>((resolve, reject) => {
      preview.server.once('error', reject)
      preview.server.listen(port, '127.0.0.1', () => resolve())
    })
    this.running.set(projectId, preview)
    this.logger.info('PREVIEW_STARTED', 'پیش‌نمایش اجرا شد.', { projectId, port, root })
    return this.state(projectId)
  }

  async stop(projectId: string): Promise<PreviewState> {
    const preview = this.running.get(projectId)
    if (!preview) return this.state(projectId)
    for (const client of preview.clients) {
      try {
        client.end()
      } catch {
        // Client already disconnected.
      }
    }
    preview.clients.clear()
    await preview.watcher.close()
    await new Promise<void>((resolve) => {
      preview.server.close(() => resolve())
      preview.server.closeAllConnections()
      setTimeout(resolve, 1500)
    })
    this.running.delete(projectId)
    this.logger.info('PREVIEW_STOPPED', 'پیش‌نمایش متوقف شد.', { projectId })
    return this.state(projectId)
  }

  async stopAll(): Promise<void> {
    for (const projectId of [...this.running.keys()]) await this.stop(projectId)
  }

  state(projectId: string): PreviewState {
    const preview = this.running.get(projectId)
    return {
      projectId,
      running: Boolean(preview),
      url: preview?.url ?? null,
      port: preview?.port ?? null,
      pid: preview ? process.pid : null,
      startedAt: preview?.startedAt ?? null,
      error: null
    }
  }

  active(): Array<{ projectId: string; url: string; pid: number }> {
    return [...this.running.values()].map((preview) => ({
      projectId: preview.projectId,
      url: preview.url,
      pid: process.pid
    }))
  }

  private resolveRoot(project: Project): string {
    const clean = path.join(project.path, 'clean')
    return fs.existsSync(clean) ? clean : project.path
  }

  private async findPort(start: number, end: number): Promise<number> {
    for (let port = start; port <= end; port += 1) {
      if (await portFree(port)) return port
    }
    throw new AppError('NO_FREE_PORT', 'هیچ پورت آزادی در بازهٔ تنظیم‌شده پیدا نشد.', 409)
  }

  private broadcast(preview: RunningPreview): void {
    for (const client of preview.clients) {
      try {
        client.write('event: reload\ndata: {}\n\n')
      } catch {
        preview.clients.delete(client)
      }
    }
  }

  private async handle(
    preview: RunningPreview,
    project: Project,
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', preview.url)
      if (url.pathname === '/__webforge/editor.js') {
        response.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store'
        })
        response.end(EDITOR_SCRIPT)
        return
      }
      if (url.pathname === '/__webforge/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        })
        response.write('retry: 1500\n\n')
        preview.clients.add(response)
        request.on('close', () => preview.clients.delete(response))
        return
      }
      if (url.pathname === '/api/content') {
        await this.handleContentApi(project, request, response)
        return
      }
      if (url.pathname === '/api/upload') {
        await this.handleUpload(project, url, request, response)
        return
      }
      await this.serveStatic(preview, request, response, url)
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500
      this.logger.warn('PREVIEW_REQUEST_FAILED', 'درخواست پیش‌نمایش ناموفق بود.', {
        path: request.url,
        error: error instanceof Error ? error.message : String(error)
      })
      if (!response.headersSent) {
        response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
      }
      response.end(status === 404 ? 'Not found' : 'Preview error')
    }
  }

  private async serveStatic(
    preview: RunningPreview,
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL
  ): Promise<void> {
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'
    const target = assertInside(preview.root, path.join(preview.root, pathname))
    let stat: fs.Stats
    try {
      stat = await fsp.stat(target)
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(
        `<!doctype html><html dir="rtl"><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;background:#0f172a;color:#e2e8f0"><h1>۴۰۴</h1><p>فایل پیدا نشد: ${escapeHtml(pathname)}</p></body></html>`
      )
      return
    }
    const file = stat.isDirectory() ? path.join(target, 'index.html') : target
    const type = mime.lookup(file) || 'application/octet-stream'
    if (type === 'text/html') {
      let html = await fsp.readFile(file, 'utf8')
      html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
      const isAdmin = url.searchParams.get('edit') === '1' || /(^|\/)admin\.html$/i.test(pathname)
      if (!isAdmin) {
        const injection = `<script src="/__webforge/editor.js"></script>`
        html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${injection}</body>`) : html + injection
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      })
      response.end(html)
      return
    }
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    fs.createReadStream(file).pipe(response)
  }

  private async readBody(request: http.IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = chunk as Buffer
      size += buffer.length
      if (size > limit) throw new AppError('BODY_TOO_LARGE', 'حجم دادهٔ ارسالی بیش از حد مجاز است.', 413)
      chunks.push(buffer)
    }
    return Buffer.concat(chunks)
  }

  private async handleContentApi(
    project: Project,
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    const siteRoot = this.resolveRoot(project)
    const contentPath = path.join(siteRoot, 'content.json')
    const json = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    if (request.method === 'GET') {
      if (!fs.existsSync(contentPath)) {
        response.writeHead(200, json)
        response.end(JSON.stringify({ version: 1, pages: {} }))
        return
      }
      response.writeHead(200, json)
      response.end(await fsp.readFile(contentPath, 'utf8'))
      return
    }
    if (request.method === 'POST') {
      const body = await this.readBody(request, 8 * 1024 * 1024)
      let parsed: unknown
      try {
        parsed = JSON.parse(body.toString('utf8'))
      } catch {
        throw new AppError('INVALID_JSON', 'دادهٔ ارسالی JSON معتبر نیست.')
      }
      if (!parsed || typeof parsed !== 'object') throw new AppError('INVALID_JSON', 'ساختار داده معتبر نیست.')
      await fsp.writeFile(contentPath, JSON.stringify(parsed, null, 2), 'utf8')
      response.writeHead(200, json)
      response.end(JSON.stringify({ ok: true }))
      return
    }
    response.writeHead(405, json)
    response.end(JSON.stringify({ error: 'method_not_allowed' }))
  }

  private async handleUpload(
    project: Project,
    url: URL,
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    if (request.method !== 'POST') {
      response.writeHead(405, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }
    const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const ext = UPLOAD_TYPES.get(type)
    if (!ext) throw new AppError('UNSUPPORTED_MEDIA', 'فقط تصویر یا ویدیو مجاز است.', 415)
    const requested = sanitizeSegment(url.searchParams.get('name') ?? `upload-${randomUUID()}${ext}`)
    const name = /\.[a-z0-9]+$/i.test(requested) ? requested : `${requested}${ext}`
    const siteRoot = this.resolveRoot(project)
    const uploadsDir = path.join(siteRoot, 'assets', 'uploads')
    ensureDir(uploadsDir)
    const target = assertInside(uploadsDir, path.join(uploadsDir, name))
    const body = await this.readBody(request, 60 * 1024 * 1024)
    await fsp.writeFile(target, body)
    const relative = path.relative(siteRoot, target).split(path.sep).join('/')
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: true, path: relative, url: `/${relative}` }))
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return map[character] ?? character
  })
}
