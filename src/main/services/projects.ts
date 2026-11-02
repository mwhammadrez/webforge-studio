import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileNode, Project, ProjectDetection, ProjectStatus, ProjectType } from '@shared/types'
import type { Database } from '../core/db'
import type { Logger } from '../core/logger'
import { AppError } from '../core/errors'
import { assertInside, sanitizeSegment, uniquePath } from '../core/fs-guard'

interface ProjectRow {
  id: string
  name: string
  path: string
  type: ProjectType
  source_url: string | null
  created_at: string
  updated_at: string
  last_opened_at: string | null
  status: ProjectStatus
  entry_file: string | null
  file_count: number
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.webforge', '__pycache__', '.cache', '.next', 'dist', 'build'])

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    type: row.type,
    sourceUrl: row.source_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    status: row.status,
    entryFile: row.entry_file,
    fileCount: row.file_count
  }
}

export class ProjectService {
  private readonly db: Database
  private readonly logger: Logger

  constructor(db: Database, logger: Logger) {
    this.db = db
    this.logger = logger
  }

  list(includeArchived = false): Project[] {
    const rows = this.db.all<ProjectRow>(
      includeArchived
        ? 'SELECT * FROM projects ORDER BY COALESCE(last_opened_at, updated_at) DESC'
        : "SELECT * FROM projects WHERE status != 'archived' ORDER BY COALESCE(last_opened_at, updated_at) DESC"
    )
    return rows.map(toProject)
  }

  get(id: string): Project {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)
    if (!row) throw new AppError('PROJECT_NOT_FOUND', 'پروژه پیدا نشد.', 404)
    return toProject(row)
  }

  createFolder(name: string, parentDir: string): { name: string; dir: string } {
    const safeName = sanitizeSegment(name, 'site')
    fs.mkdirSync(parentDir, { recursive: true })
    const target = uniquePath(path.join(parentDir, safeName))
    fs.mkdirSync(target, { recursive: false })
    return { name: path.basename(target), dir: target }
  }

  register(params: {
    name: string
    dir: string
    sourceUrl?: string | null
    type?: ProjectType
    status?: ProjectStatus
  }): Project {
    const absolute = path.resolve(params.dir)
    const existing = this.db.get<ProjectRow>('SELECT * FROM projects WHERE path = ?', absolute)
    const detection = this.detect(absolute)
    const now = new Date().toISOString()
    if (existing) {
      this.db.run(
        'UPDATE projects SET updated_at = ?, type = ?, entry_file = ?, file_count = ? WHERE id = ?',
        now,
        params.type ?? detection.type,
        detection.entryFile,
        detection.fileCount,
        existing.id
      )
      return this.get(existing.id)
    }
    const id = randomUUID()
    this.db.run(
      `INSERT INTO projects
        (id, name, path, type, source_url, created_at, updated_at, last_opened_at, status, entry_file, file_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      params.name.slice(0, 120),
      absolute,
      params.type ?? detection.type,
      params.sourceUrl ?? null,
      now,
      now,
      now,
      params.status ?? 'ready',
      detection.entryFile,
      detection.fileCount
    )
    this.logger.info('PROJECT_REGISTERED', 'پروژه ثبت شد.', { id, path: absolute })
    return this.get(id)
  }

  detect(dir: string): ProjectDetection {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new AppError('PROJECT_FOLDER_MISSING', 'پوشهٔ پروژه وجود ندارد.', 404)
    }
    const htmlFiles: string[] = []
    let fileCount = 0
    const hints: string[] = []
    const walk = (current: string, depth: number): void => {
      if (depth > 3 || fileCount > 20000) return
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.well-known') continue
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue
          walk(path.join(current, entry.name), depth + 1)
        } else {
          fileCount += 1
          if (/\.html?$/i.test(entry.name)) {
            htmlFiles.push(path.relative(dir, path.join(current, entry.name)).split(path.sep).join('/'))
          }
        }
      }
    }
    walk(dir, 0)
    const packageJsonPath = path.join(dir, 'package.json')
    const packageJson = fs.existsSync(packageJsonPath)
    let framework: string | null = null
    if (packageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
          scripts?: Record<string, string>
        }
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
        if (deps.next) framework = 'Next.js'
        else if (deps.nuxt) framework = 'Nuxt'
        else if (deps['@sveltejs/kit']) framework = 'SvelteKit'
        else if (deps.astro) framework = 'Astro'
        else if (deps.vite) framework = 'Vite'
        else if (deps.react) framework = 'React'
        else if (deps.vue) framework = 'Vue'
        else if (pkg.scripts?.dev) framework = 'Node'
        if (pkg.scripts?.dev) hints.push(`اسکریپت dev: ${pkg.scripts.dev}`)
        if (pkg.scripts?.preview) hints.push(`اسکریپت preview: ${pkg.scripts.preview}`)
      } catch {
        hints.push('package.json قابل خواندن نیست.')
      }
    }
    const preferred = ['index.html', 'index.htm']
    const entryFile =
      htmlFiles.find((file) => preferred.includes(file.toLowerCase())) ??
      htmlFiles
        .slice()
        .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))[0] ??
      null
    const type: ProjectType = packageJson ? 'node' : htmlFiles.length > 0 ? 'static' : 'unknown'
    if (htmlFiles.length > 0) hints.push(`${htmlFiles.length} فایل HTML پیدا شد.`)
    if (packageJson) hints.push('پروژه دارای package.json است.')
    return { type, entryFile, htmlFiles: htmlFiles.slice(0, 500), packageJson, framework, fileCount, hints }
  }

  countFiles(dir: string): number {
    let count = 0
    const walk = (current: string, depth: number): void => {
      if (depth > 6) return
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name === '.webforge') continue
        if (entry.isDirectory()) walk(path.join(current, entry.name), depth + 1)
        else count += 1
        if (count > 50000) return
      }
    }
    walk(dir, 0)
    return count
  }

  touch(id: string): void {
    const project = this.get(id)
    this.db.run(
      'UPDATE projects SET last_opened_at = ?, updated_at = ?, file_count = ? WHERE id = ?',
      new Date().toISOString(),
      new Date().toISOString(),
      this.countFiles(project.path),
      id
    )
  }

  setStatus(id: string, status: ProjectStatus): void {
    this.db.run('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), id)
  }

  rename(id: string, name: string): Project {
    this.get(id)
    this.db.run('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?', name.slice(0, 120), new Date().toISOString(), id)
    return this.get(id)
  }

  async remove(id: string, deleteFiles: boolean): Promise<{ movedTo: string | null }> {
    const project = this.get(id)
    let movedTo: string | null = null
    if (deleteFiles && fs.existsSync(project.path)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const trashRoot = path.join(path.dirname(project.path), '.webforge-trash', stamp)
      await fsp.mkdir(trashRoot, { recursive: true })
      movedTo = path.join(trashRoot, path.basename(project.path))
      await fsp.rename(project.path, movedTo)
      this.logger.warn('PROJECT_MOVED_TO_TRASH', 'پروژه به سبد بازیابی منتقل شد.', { id, movedTo })
    }
    this.db.run('DELETE FROM edit_events WHERE project_id = ?', id)
    this.db.run('DELETE FROM plugin_runs WHERE project_id = ?', id)
    this.db.run('DELETE FROM extraction_runs WHERE project_id = ?', id)
    this.db.run('DELETE FROM projects WHERE id = ?', id)
    return { movedTo }
  }

  tree(id: string, options: { maxEntries?: number; maxDepth?: number } = {}): FileNode[] {
    const project = this.get(id)
    const maxEntries = options.maxEntries ?? 6000
    const maxDepth = options.maxDepth ?? 8
    let entries = 0
    const build = (dir: string, depth: number): FileNode[] => {
      if (depth > maxDepth || entries > maxEntries) return []
      let dirents: fs.Dirent[]
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return []
      }
      const nodes: FileNode[] = []
      for (const dirent of dirents.sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
        return left.name.localeCompare(right.name)
      })) {
        if (entries > maxEntries) break
        if (dirent.name === '.webforge' || dirent.name === 'node_modules' || dirent.name === '.git') continue
        entries += 1
        const full = path.join(dir, dirent.name)
        const node: FileNode = {
          name: dirent.name,
          path: full,
          relativePath: path.relative(project.path, full).split(path.sep).join('/'),
          isDirectory: dirent.isDirectory(),
          size: 0
        }
        if (dirent.isDirectory()) node.children = build(full, depth + 1)
        else {
          try {
            node.size = fs.statSync(full).size
          } catch {
            node.size = 0
          }
        }
        nodes.push(node)
      }
      return nodes
    }
    return build(project.path, 0)
  }

  resolveFile(id: string, relativePath: string): string {
    const project = this.get(id)
    const full = assertInside(project.path, path.join(project.path, relativePath))
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new AppError('FILE_NOT_FOUND', 'فایل پیدا نشد.', 404)
    }
    return full
  }

  readFile(id: string, relativePath: string): { content: string; size: number; language: string } {
    const full = this.resolveFile(id, relativePath)
    const stat = fs.statSync(full)
    if (stat.size > 3 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', 'این فایل برای نمایش خیلی بزرگ است.', 413)
    const buffer = fs.readFileSync(full)
    const content = buffer.toString('utf8')
    return { content, size: stat.size, language: languageOf(relativePath) }
  }

  writeFile(id: string, relativePath: string, content: string): void {
    const full = assertInside(this.get(id).path, path.join(this.get(id).path, relativePath))
    fs.writeFileSync(full, content, 'utf8')
  }
}

function languageOf(file: string): string {
  const ext = path.extname(file).toLowerCase()
  const map: Record<string, string> = {
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.ts': 'typescript',
    '.json': 'json',
    '.md': 'markdown',
    '.svg': 'xml',
    '.xml': 'xml',
    '.txt': 'text'
  }
  return map[ext] ?? 'text'
}
