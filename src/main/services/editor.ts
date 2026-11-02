import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import type {
  EditAction,
  EditEventRecord,
  EditSummary,
  Project,
  SaveEditRequest
} from '@shared/types'
import type { Database } from '../core/db'
import type { Logger } from '../core/logger'
import type { ProjectService } from './projects'
import { AppError } from '../core/errors'
import { assertInside, atomicWrite, backupFile, ensureDir, sanitizeSegment, uniquePath } from '../core/fs-guard'

interface Location {
  startOffset: number
  endOffset: number
  startTag?: { startOffset: number; endOffset: number; attrs?: Record<string, Location> }
  endTag?: { startOffset: number; endOffset: number }
}

interface EditRow {
  id: string
  project_id: string
  file_path: string
  kind: string
  before: string
  after: string
  created_at: string
  reverted: number
}

export class EditorService {
  private readonly db: Database
  private readonly projects: ProjectService
  private readonly logger: Logger
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(db: Database, projects: ProjectService, logger: Logger) {
    this.db = db
    this.projects = projects
    this.logger = logger
  }

  async save(request: SaveEditRequest, correlationId?: string): Promise<EditSummary> {
    return this.withLock(request.projectId, async () => {
      const project = this.projects.get(request.projectId)
      const file = this.resolveHtml(project, request.file)
      const html = fs.readFileSync(file, 'utf8')
      const $ = cheerio.load(html, { sourceCodeLocationInfo: true })
      const element = this.findElement($, request.selector, request.fallbackText)
      if (!element) {
        throw new AppError(
          'ELEMENT_NOT_MAPPED',
          'نتوانستم فایل منبع این بخش را تشخیص دهم. صفحه را تازه کن و دوباره انتخاب کن.'
        )
      }
      const node = element[0] as Element
      const location = (node as unknown as { sourceCodeLocation?: Location }).sourceCodeLocation
      if (!location || !location.startTag) {
        throw new AppError('ELEMENT_NOT_MAPPED', 'این عنصر به‌صورت خودکار ساخته شده و فایل منبع ندارد.')
      }
      const before = this.readValue(node, request.action)
      const after = this.readValueAfter(request.action)
      const patched = this.applyAction(html, location, request.action, element)
      if (patched === html) {
        throw new AppError('NO_CHANGE', 'تغییری برای ذخیره وجود ندارد.')
      }
      const backupPath = backupFile(project.path, file)
      atomicWrite(file, patched)
      const eventId = randomUUID()
      this.db.run(
        `INSERT INTO edit_events (id, project_id, file_path, kind, before, after, created_at, reverted)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        eventId,
        project.id,
        path.relative(project.path, file).split(path.sep).join('/'),
        request.action.type,
        html,
        patched,
        new Date().toISOString()
      )
      this.logger.info(
        'EDIT_SAVED',
        'تغییر در فایل ذخیره شد.',
        { projectId: project.id, file: request.file, kind: request.action.type },
        correlationId
      )
      return {
        file: request.file,
        kind: request.action.type,
        before,
        after,
        backupPath,
        eventId,
        canUndo: true,
        canRedo: false
      }
    })
  }

  async replaceImage(
    projectId: string,
    file: string,
    selector: string,
    sourcePath: string,
    correlationId?: string
  ): Promise<EditSummary> {
    const project = this.projects.get(projectId)
    const stat = fs.statSync(sourcePath)
    if (!stat.isFile()) throw new AppError('INVALID_IMAGE', 'فایل انتخاب‌شده معتبر نیست.')
    if (stat.size > 10 * 1024 * 1024) throw new AppError('IMAGE_TOO_LARGE', 'حجم تصویر بیش از ۱۰ مگابایت است.')
    const buffer = fs.readFileSync(sourcePath)
    const detected = detectImage(buffer)
    if (!detected) throw new AppError('INVALID_IMAGE', 'فرمت تصویر پشتیبانی نمی‌شود (PNG، JPG، WebP، GIF، SVG).')
    const siteRoot = fs.existsSync(path.join(project.path, 'clean')) ? path.join(project.path, 'clean') : project.path
    const uploads = path.join(siteRoot, 'assets', 'uploads')
    ensureDir(uploads)
    const base = sanitizeSegment(path.basename(sourcePath, path.extname(sourcePath)), 'image')
    const target = uniquePath(path.join(uploads, `${base}${detected}`))
    fs.writeFileSync(target, buffer)
    const relative = path.relative(siteRoot, target).split(path.sep).join('/')
    return this.save(
      {
        projectId,
        file,
        selector,
        action: { type: 'image', src: `/${relative}` }
      },
      correlationId
    )
  }

  undo(projectId: string): { restoredFile: string; eventId: string } {
    const project = this.projects.get(projectId)
    const row = this.db.get<EditRow>(
      'SELECT * FROM edit_events WHERE project_id = ? AND reverted = 0 ORDER BY created_at DESC, rowid DESC LIMIT 1',
      projectId
    )
    if (!row) throw new AppError('NOTHING_TO_UNDO', 'تغییری برای بازگردانی وجود ندارد.')
    const file = assertInside(project.path, path.join(project.path, row.file_path))
    backupFile(project.path, file)
    atomicWrite(file, row.before)
    this.db.run('UPDATE edit_events SET reverted = 1 WHERE id = ?', row.id)
    return { restoredFile: row.file_path, eventId: row.id }
  }

  redo(projectId: string): { restoredFile: string; eventId: string } {
    const project = this.projects.get(projectId)
    const row = this.db.get<EditRow>(
      'SELECT * FROM edit_events WHERE project_id = ? AND reverted = 1 ORDER BY created_at DESC, rowid DESC LIMIT 1',
      projectId
    )
    if (!row) throw new AppError('NOTHING_TO_REDO', 'تغییری برای اجرای دوباره وجود ندارد.')
    const file = assertInside(project.path, path.join(project.path, row.file_path))
    backupFile(project.path, file)
    atomicWrite(file, row.after)
    this.db.run('UPDATE edit_events SET reverted = 0 WHERE id = ?', row.id)
    return { restoredFile: row.file_path, eventId: row.id }
  }

  history(projectId: string, limit = 50): EditEventRecord[] {
    const rows = this.db.all<EditRow>(
      'SELECT * FROM edit_events WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      projectId,
      limit
    )
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      filePath: row.file_path,
      kind: row.kind,
      before: row.before.slice(0, 500),
      after: row.after.slice(0, 500),
      createdAt: row.created_at,
      reverted: Boolean(row.reverted)
    }))
  }

  private resolveHtml(project: Project, relative: string): string {
    let full = assertInside(project.path, path.join(project.path, relative))
    if (!fs.existsSync(full)) {
      const clean = path.join(project.path, 'clean')
      if (fs.existsSync(clean)) full = assertInside(clean, path.join(clean, relative))
    }
    if (!fs.existsSync(full)) throw new AppError('FILE_NOT_FOUND', 'فایل صفحه پیدا نشد.', 404)
    if (!/\.html?$/i.test(full)) throw new AppError('UNSUPPORTED_FILE', 'ویرایش بصری فقط برای فایل‌های HTML است.')
    return full
  }

  private findElement(
    $: cheerio.CheerioAPI,
    selector: string,
    fallbackText?: string
  ): cheerio.Cheerio<Element> | null {
    try {
      const found = $(selector)
      if (found.length > 0) return found.first() as cheerio.Cheerio<Element>
    } catch {
      // Invalid selector falls through to the text anchor.
    }
    if (fallbackText) {
      const normalized = normalizeText(fallbackText)
      if (normalized.length > 2) {
        let match: cheerio.Cheerio<Element> | null = null
        $('body *').each((_index, node) => {
          const element = $(node as unknown as Element)
          const text = normalizeText(element.clone().children().remove().end().text())
          if (text === normalized && element[0] !== $('body')[0]) {
            match = element
            return false
          }
          return undefined
        })
        if (match) return match
      }
    }
    return null
  }

  private applyAction(
    html: string,
    location: Location,
    action: EditAction,
    element: cheerio.Cheerio<Element>
  ): string {
    const startTag = location.startTag
    if (!startTag) throw new AppError('ELEMENT_NOT_MAPPED', 'این عنصر تگ شروع قابل‌ویرایش ندارد.')
    if (action.type === 'text') {
      if (!location.endTag) throw new AppError('ELEMENT_NOT_MAPPED', 'این عنصر محتوای متنی قابل‌ویرایش ندارد.')
      const innerStart = startTag.endOffset
      const innerEnd = location.endTag.startOffset
      return `${html.slice(0, innerStart)}${escapeText(action.text)}${html.slice(innerEnd)}`
    }
    if (action.type === 'attr') {
      return this.setAttribute(html, startTag, action.name, action.value)
    }
    if (action.type === 'style') {
      const current = element.attr('style') ?? ''
      const property = toKebab(action.name)
      const declarations = parseStyle(current)
      declarations.set(property, action.value)
      const next = [...declarations.entries()].map(([key, value]) => `${key}: ${value}`).join('; ')
      return this.setAttribute(html, startTag, 'style', next)
    }
    if (action.type === 'image') {
      const attrs: Record<string, string> = { src: action.src }
      if (action.alt !== undefined) attrs.alt = action.alt
      return this.setAttributes(html, startTag, attrs)
    }
    if (action.type === 'link') {
      const attrs: Record<string, string> = { href: action.href }
      if (action.target !== undefined) attrs.target = action.target
      return this.setAttributes(html, startTag, attrs)
    }
    return html
  }

  private setAttribute(
    html: string,
    startTag: NonNullable<Location['startTag']>,
    name: string,
    value: string
  ): string {
    return this.setAttributes(html, startTag, { [name]: value })
  }

  private setAttributes(
    html: string,
    startTag: NonNullable<Location['startTag']>,
    values: Record<string, string>
  ): string {
    const attrs = startTag.attrs ?? {}
    const patches: Array<{ start: number; end: number; text: string }> = []
    const additions: string[] = []
    for (const [name, value] of Object.entries(values)) {
      const existing = attrs[name]
      if (existing) {
        const raw = html.slice(existing.startOffset, existing.endOffset)
        const eq = raw.indexOf('=')
        if (eq === -1) {
          patches.push({ start: existing.startOffset, end: existing.endOffset, text: `${name}="${escapeAttr(value)}"` })
        } else {
          const quote = raw[eq + 1] === '"' ? '"' : raw[eq + 1] === "'" ? "'" : '"'
          patches.push({
            start: existing.startOffset,
            end: existing.endOffset,
            text: `${name}=${quote}${escapeAttr(value)}${quote}`
          })
        }
      } else {
        additions.push(`${name}="${escapeAttr(value)}"`)
      }
    }
    if (additions.length > 0) {
      let insertAt = startTag.endOffset - 1
      if (html[insertAt - 1] === '/') insertAt -= 1
      patches.push({ start: insertAt, end: insertAt, text: ` ${additions.join(' ')}` })
    }
    let output = html
    for (const patch of patches.sort((left, right) => right.start - left.start)) {
      output = `${output.slice(0, patch.start)}${patch.text}${output.slice(patch.end)}`
    }
    return output
  }

  private readValue(node: Element, action: EditAction): string {
    const attribs = node.attribs ?? {}
    switch (action.type) {
      case 'text':
        return node.children
          .map((child) => ('data' in child && typeof child.data === 'string' ? child.data : ''))
          .join('')
          .trim()
      case 'attr':
        return attribs[action.name] ?? ''
      case 'style':
        return attribs.style ?? ''
      case 'image':
        return attribs.src ?? ''
      case 'link':
        return attribs.href ?? ''
      default:
        return ''
    }
  }

  private readValueAfter(action: EditAction): string {
    switch (action.type) {
      case 'text':
        return action.text
      case 'attr':
        return action.value
      case 'style':
        return action.value
      case 'image':
        return action.src
      case 'link':
        return action.href
      default:
        return ''
    }
  }

  private withLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    this.locks.set(
      projectId,
      next.catch(() => undefined)
    )
    return next
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\u200c/g, '').trim()
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function toKebab(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
}

function parseStyle(value: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of value.split(';')) {
    const index = part.indexOf(':')
    if (index === -1) continue
    const key = part.slice(0, index).trim()
    const val = part.slice(index + 1).trim()
    if (key) map.set(key, val)
  }
  return map
}

function detectImage(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return '.webp'
  if (buffer.length >= 6 && buffer.subarray(0, 3).toString() === 'GIF') return '.gif'
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString().toLowerCase().includes('<svg')) return '.svg'
  return null
}
