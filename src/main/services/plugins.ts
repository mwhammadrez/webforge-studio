import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { z } from 'zod'
import type {
  Plugin,
  PluginManifest,
  PluginRun,
  PluginRunEvent,
  PluginRunResult,
  PluginRunStatus,
  Project
} from '@shared/types'
import { pluginManifestSchema } from '@shared/schemas'
import type { Database } from '../core/db'
import type { Logger } from '../core/logger'
import type { ProjectService } from './projects'
import { AppError } from '../core/errors'
import { findNpmLauncher } from '../core/npm'
import { assertInside, ensureDir } from '../core/fs-guard'

interface PluginRow {
  id: string
  name: string
  display_name: string
  description: string
  version: string
  entry: string
  runtime: PluginManifest['runtime']
  enabled: number
  requires_network: number
  requires_project_write: number
  manifest: string
  created_at: string
  last_run_at: string | null
  last_status: PluginRunStatus | null
}

interface RunRow {
  id: string
  plugin_id: string
  project_id: string | null
  status: PluginRunStatus
  started_at: string
  finished_at: string | null
  exit_code: number | null
  log_path: string
  output_paths: string
  duration_ms: number | null
}

export interface BuiltinContext {
  project: Project | null
  inputs: Record<string, string | number | boolean>
  log: (stream: 'stdout' | 'stderr' | 'system', chunk: string) => void
  signal: AbortSignal
}

export type BuiltinHandler = (context: BuiltinContext) => Promise<string[]>

const BUILTINS: Array<{ manifest: PluginManifest; handler?: BuiltinHandler }> = [
  {
    manifest: {
      name: 'admin-panel',
      displayName: 'سازنده پنل ادمین',
      description: 'یک پنل مدیریت کامل به سایت اضافه می‌کند: ویرایش متن، عکس، ویدیو و استایل بدون دست‌زدن به کد.',
      version: '1.0.0',
      runtime: 'builtin',
      command: 'builtin:admin-panel',
      args: [],
      cwd: '.',
      inputs: [
        {
          key: 'projectId',
          label: 'پروژهٔ مقصد',
          type: 'projectPath',
          required: true,
          help: 'سایت استاتیک استخراج‌شده یا پوشهٔ سایت را انتخاب کن.'
        }
      ],
      outputs: [{ key: 'panel', type: 'file', path: 'admin.html', label: 'پنل مدیریت' }],
      permissions: { network: false, projectWrite: true, environment: [] },
      timeoutSeconds: 120,
      builtin: 'admin-panel',
      icon: 'layout-dashboard'
    }
  },
  {
    manifest: {
      name: 'site-qa',
      displayName: 'تستر جامع سایت',
      description: 'بررسی HTML، لینک‌ها، دسترس‌پذیری، SEO، پرفورمنس، خطاهای کنسول و امنیت پایه.',
      version: '1.0.0',
      runtime: 'builtin',
      command: 'builtin:site-qa',
      args: [],
      cwd: '.',
      inputs: [{ key: 'projectId', label: 'پروژه', type: 'projectPath', required: true }],
      outputs: [{ key: 'report', type: 'json', path: 'reports/qa-report.json', label: 'گزارش تست' }],
      permissions: { network: true, projectWrite: true, environment: [] },
      timeoutSeconds: 600,
      builtin: 'site-qa',
      icon: 'shield-check'
    }
  }
]

export class PluginService {
  private readonly db: Database
  private readonly projects: ProjectService
  private readonly logger: Logger
  private readonly builtinHandlers = new Map<string, BuiltinHandler>()
  private readonly running = new Map<string, { child: ChildProcess | null; startedAt: string; pluginId: string }>()

  constructor(db: Database, projects: ProjectService, logger: Logger) {
    this.db = db
    this.projects = projects
    this.logger = logger
    for (const builtin of BUILTINS) {
      if (builtin.manifest.name === 'admin-panel') this.builtinHandlers.set('admin-panel', this.adminPanel.bind(this))
      if (builtin.handler) this.builtinHandlers.set(builtin.manifest.name, builtin.handler)
    }
    this.ensureBuiltins()
  }

  registerBuiltin(name: string, handler: BuiltinHandler): void {
    this.builtinHandlers.set(name, handler)
  }

  private ensureBuiltins(): void {
    for (const builtin of BUILTINS) {
      const exists = this.db.get<{ id: string }>('SELECT id FROM plugins WHERE name = ?', builtin.manifest.name)
      if (exists) {
        this.db.run(
          'UPDATE plugins SET manifest = ?, display_name = ?, description = ?, version = ? WHERE id = ?',
          JSON.stringify(builtin.manifest),
          builtin.manifest.displayName,
          builtin.manifest.description,
          builtin.manifest.version,
          exists.id
        )
        continue
      }
      this.db.run(
        `INSERT INTO plugins (id, name, display_name, description, version, entry, runtime, enabled, requires_network, requires_project_write, manifest, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        randomUUID(),
        builtin.manifest.name,
        builtin.manifest.displayName,
        builtin.manifest.description,
        builtin.manifest.version,
        `builtin:${builtin.manifest.name}`,
        'builtin',
        builtin.manifest.permissions.network ? 1 : 0,
        builtin.manifest.permissions.projectWrite ? 1 : 0,
        JSON.stringify(builtin.manifest),
        new Date().toISOString()
      )
    }
  }

  list(): Plugin[] {
    const rows = this.db.all<PluginRow>('SELECT * FROM plugins ORDER BY created_at ASC')
    return rows.map((row) => this.toPlugin(row))
  }

  get(pluginId: string): Plugin {
    const row = this.db.get<PluginRow>('SELECT * FROM plugins WHERE id = ?', pluginId)
    if (!row) throw new AppError('PLUGIN_NOT_FOUND', 'ابزار پیدا نشد.', 404)
    return this.toPlugin(row)
  }

  async addFromPath(target: string): Promise<Plugin> {
    const stat = fs.statSync(target)
    let manifestPath: string
    if (stat.isDirectory()) {
      manifestPath = path.join(target, 'plugin.manifest.json')
      if (!fs.existsSync(manifestPath)) {
        const candidates = fs.readdirSync(target).filter((name) => /\.manifest\.json$/i.test(name))
        if (candidates.length === 0) throw new AppError('MANIFEST_NOT_FOUND', 'فایل plugin.manifest.json پیدا نشد.')
        manifestPath = path.join(target, candidates[0])
      }
    } else {
      manifestPath = target
    }
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch {
      throw new AppError('PLUGIN_MANIFEST_INVALID', 'فایل مانیفست JSON معتبر نیست.')
    }
    const parsed = pluginManifestSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError(
        'PLUGIN_MANIFEST_INVALID',
        `مانیفست معتبر نیست: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' | ')}`
      )
    }
    const manifest = parsed.data as PluginManifest
    if (manifest.builtin) {
      throw new AppError('PLUGIN_MANIFEST_INVALID', 'افزودن ابزار داخلی از طریق مانیفست مجاز نیست.')
    }
    const entryDir = path.dirname(manifestPath)
    const duplicate = this.db.get<{ id: string }>('SELECT id FROM plugins WHERE name = ?', manifest.name)
    if (duplicate) throw new AppError('PLUGIN_DUPLICATE', 'ابزاری با این نام قبلاً ثبت شده است.')
    const canonicalEntry = path.resolve(entryDir)
    const duplicateEntry = this.db.get<{ id: string }>('SELECT id FROM plugins WHERE entry = ?', canonicalEntry)
    if (duplicateEntry) throw new AppError('PLUGIN_DUPLICATE', 'این مسیر ابزار قبلاً ثبت شده است.')
    const id = randomUUID()
    this.db.run(
      `INSERT INTO plugins (id, name, display_name, description, version, entry, runtime, enabled, requires_network, requires_project_write, manifest, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      id,
      manifest.name,
      manifest.displayName,
      manifest.description,
      manifest.version,
      canonicalEntry,
      manifest.runtime,
      manifest.permissions.network ? 1 : 0,
      manifest.permissions.projectWrite ? 1 : 0,
      JSON.stringify(manifest),
      new Date().toISOString()
    )
    this.logger.info('PLUGIN_ADDED', 'ابزار جدید ثبت شد.', { id, name: manifest.name })
    return this.get(id)
  }

  toggle(pluginId: string, enabled: boolean): Plugin {
    this.get(pluginId)
    this.db.run('UPDATE plugins SET enabled = ? WHERE id = ?', enabled ? 1 : 0, pluginId)
    return this.get(pluginId)
  }

  remove(pluginId: string): void {
    const plugin = this.get(pluginId)
    if (plugin.runtime === 'builtin') throw new AppError('PLUGIN_BUILTIN', 'ابزارهای داخلی قابل حذف نیستند.')
    this.db.run('DELETE FROM plugin_runs WHERE plugin_id = ?', pluginId)
    this.db.run('DELETE FROM plugins WHERE id = ?', pluginId)
    this.logger.info('PLUGIN_REMOVED', 'ابزار حذف شد.', { pluginId, entry: plugin.entry })
  }

  runs(pluginId?: string, limit = 30): PluginRun[] {
    const rows = pluginId
      ? this.db.all<RunRow>('SELECT * FROM plugin_runs WHERE plugin_id = ? ORDER BY started_at DESC LIMIT ?', pluginId, limit)
      : this.db.all<RunRow>('SELECT * FROM plugin_runs ORDER BY started_at DESC LIMIT ?', limit)
    return rows.map(toRun)
  }

  async run(
    pluginId: string,
    projectId: string | null,
    inputs: Record<string, string | number | boolean>,
    onEvent: (event: PluginRunEvent) => void
  ): Promise<PluginRunResult> {
    const plugin = this.get(pluginId)
    if (!plugin.enabled) throw new AppError('PLUGIN_DISABLED', 'این ابزار غیرفعال است.')
    const project = projectId ? this.projects.get(projectId) : null
    const validated = this.validateInputs(plugin.manifest, inputs)
    const runId = randomUUID()
    const logDir = path.join(app.getPath('userData'), 'logs', 'plugin-runs')
    ensureDir(logDir)
    const logPath = path.join(logDir, `${runId}.log`)
    const startedAt = new Date().toISOString()
    const started = Date.now()
    this.db.run(
      `INSERT INTO plugin_runs (id, plugin_id, project_id, status, started_at, log_path, output_paths)
       VALUES (?, ?, ?, 'running', ?, ?, '[]')`,
      runId,
      pluginId,
      projectId,
      startedAt,
      logPath
    )
    const controller = new AbortController()
    this.running.set(runId, { child: null, startedAt, pluginId })
    const appendLog = (stream: 'stdout' | 'stderr' | 'system', chunk: string): void => {
      try {
        fs.appendFileSync(logPath, `[${stream}] ${chunk}`)
      } catch {
        // Log file failure must not stop the tool.
      }
      onEvent({ runId, stream, chunk, status: 'running' })
    }
    appendLog('system', `شروع ${plugin.displayName} — ${startedAt}\n`)
    let status: PluginRunStatus = 'success'
    let exitCode: number | null = null
    const outputPaths: string[] = []
    try {
      if (plugin.runtime === 'builtin') {
        const handler = this.builtinHandlers.get(plugin.name)
        if (!handler) throw new AppError('BUILTIN_MISSING', 'اجرای این ابزار داخلی در دسترس نیست.')
        // Admin panel expects projectId directly.
        if (plugin.name === 'admin-panel' && project) validated.projectId = project.id
        const outputs = await handler({
          project,
          inputs: validated,
          log: appendLog,
          signal: controller.signal
        })
        outputPaths.push(...outputs)
      } else {
        const execution = this.buildCommand(plugin, project, validated)
        const result = await this.executeProcess(runId, execution, plugin, appendLog, controller)
        exitCode = result.exitCode
        status = result.status
        outputPaths.push(...result.outputPaths)
      }
      if (controller.signal.aborted && status !== 'timeout') status = 'cancelled'
      if (status === 'success') {
        const missing: string[] = []
        for (const output of plugin.manifest.outputs) {
          const candidate = path.resolve(project?.path ?? plugin.entry, output.path)
          if (!fs.existsSync(candidate)) missing.push(output.path)
        }
        if (missing.length > 0 && plugin.runtime !== 'builtin') {
          status = 'failed'
          appendLog('stderr', `\nخروجی‌های اعلام‌شده پیدا نشدند: ${missing.join(', ')}\n`)
        }
      }
    } catch (error) {
      status = controller.signal.aborted ? 'cancelled' : 'failed'
      appendLog('stderr', `\n${error instanceof Error ? error.message : String(error)}\n`)
      this.logger.error('PLUGIN_RUN_FAILED', 'اجرای ابزار ناموفق بود.', { pluginId, runId })
    } finally {
      this.running.delete(runId)
    }
    const finishedAt = new Date().toISOString()
    const duration = Date.now() - started
    this.db.run(
      'UPDATE plugin_runs SET status = ?, finished_at = ?, exit_code = ?, output_paths = ?, duration_ms = ? WHERE id = ?',
      status,
      finishedAt,
      exitCode,
      JSON.stringify(outputPaths),
      duration,
      runId
    )
    this.db.run(
      'UPDATE plugins SET last_run_at = ?, last_status = ? WHERE id = ?',
      finishedAt,
      status,
      pluginId
    )
    appendLog('system', `\nپایان با وضعیت ${status} — ${duration}ms\n`)
    onEvent({ runId, stream: 'system', chunk: '', status })
    const logs = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
    return { run: { ...toRun(this.db.get<RunRow>('SELECT * FROM plugin_runs WHERE id = ?', runId) as RunRow) }, logs, outputPaths }
  }

  cancel(runId: string): boolean {
    const entry = this.running.get(runId)
    if (!entry) return false
    const child = entry.child
    const pid = child?.pid
    if (child && pid) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
      } else {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
        setTimeout(() => {
          if (!child.killed) {
            try {
              process.kill(-pid, 'SIGKILL')
            } catch {
              child.kill('SIGKILL')
            }
          }
        }, 2500)
      }
    }
    return true
  }

  active(): Array<{ runId: string; pluginId: string; startedAt: string }> {
    return [...this.running.entries()].map(([runId, value]) => ({
      runId,
      pluginId: value.pluginId,
      startedAt: value.startedAt
    }))
  }

  hasDependencies(entry: string): boolean {
    if (entry.startsWith('builtin:')) return true
    return fs.existsSync(path.join(entry, 'node_modules'))
  }

  async installDependencies(pluginId: string): Promise<import('@shared/types').InstallDepsResult> {
    const plugin = this.get(pluginId)
    if (plugin.runtime !== 'node') {
      throw new AppError('DEPS_UNSUPPORTED', 'نصب خودکار وابستگی فقط برای ابزارهای Node پشتیبانی می‌شود.')
    }
    if (plugin.entry.startsWith('builtin:')) {
      return { pluginId, ok: true, exitCode: 0, logs: 'ابزار داخلی وابستگی خارجی ندارد.' }
    }
    const packageJson = path.join(plugin.entry, 'package.json')
    if (!fs.existsSync(packageJson)) throw new AppError('DEPS_NO_PACKAGE', 'package.json در پوشهٔ ابزار پیدا نشد.')
    const launcher = findNpmLauncher('npm')
    if (!launcher) {
      throw new AppError('NPM_NOT_FOUND', 'npm روی این سیستم پیدا نشد؛ برای نصب وابستگی‌ها Node را نصب کن یا در PATH قرارش بده.')
    }
    const logs: string[] = []
    const result = await new Promise<{ code: number | null }>((resolve) => {
      const child = spawn(process.execPath, [launcher, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: plugin.entry,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, SystemRoot: process.env.SystemRoot, ELECTRON_RUN_AS_NODE: '1', npm_config_registry: 'https://registry.npmjs.org/', npm_config_ignore_scripts: 'true' },
        windowsHide: true
      })
      const timer = setTimeout(() => {
        logs.push('زمان نصب وابستگی‌ها تمام شد؛ پروسه متوقف شد.')
        if (child.pid) {
          if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
          else child.kill('SIGKILL')
        }
      }, 900_000)
      child.stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString('utf8')))
      child.stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString('utf8')))
      child.on('error', (error) => {
        clearTimeout(timer)
        logs.push(error.message)
        resolve({ code: null })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ code })
      })
    })
    const text = logs.join('').slice(-200_000)
    this.logger.info('PLUGIN_DEPS_INSTALLED', 'نصب وابستگی ابزار انجام شد.', { pluginId, exitCode: result.code })
    return { pluginId, ok: result.code === 0, exitCode: result.code, logs: text }
  }

  private toPlugin(row: PluginRow): Plugin {
    const manifest = JSON.parse(row.manifest) as PluginManifest
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      version: row.version,
      entry: row.entry,
      runtime: row.runtime,
      enabled: Boolean(row.enabled),
      requiresNetwork: Boolean(row.requires_network),
      requiresProjectWrite: Boolean(row.requires_project_write),
      createdAt: row.created_at,
      manifest,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      hasDependencies: this.hasDependencies(row.entry)
    }
  }

  private validateInputs(
    manifest: PluginManifest,
    inputs: Record<string, string | number | boolean>
  ): Record<string, string | number | boolean> {
    const output: Record<string, string | number | boolean> = {}
    for (const input of manifest.inputs) {
      const raw = inputs[input.key]
      const value = raw === undefined || raw === '' ? input.default : raw
      if (input.required && (value === undefined || value === null || value === '')) {
        throw new AppError('PLUGIN_INPUT_INVALID', `فیلد «${input.label}» الزامی است.`)
      }
      if (value === undefined) continue
      if (input.type === 'number') {
        const number = Number(value)
        if (!Number.isFinite(number)) throw new AppError('PLUGIN_INPUT_INVALID', `فیلد «${input.label}» باید عدد باشد.`)
        output[input.key] = number
      } else if (input.type === 'boolean') {
        output[input.key] = value === true || value === 'true'
      } else {
        output[input.key] = String(value)
      }
    }
    return output
  }

  private buildCommand(
    plugin: Plugin,
    project: Project | null,
    inputs: Record<string, string | number | boolean>
  ): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
    const baseCwd = project?.path ?? plugin.entry
    const cwd = assertInside(baseCwd, path.resolve(baseCwd, plugin.manifest.cwd || '.'))
    const substitute = (value: string): string => {
      let output = value
      for (const [key, input] of Object.entries(inputs)) {
        output = output.split(`{{${key}}}`).join(String(input))
      }
      output = output.split('{{projectPath}}').join(project?.path ?? '')
      output = output.split('{{cwd}}').join(cwd)
      return output
    }
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      LANG: process.env.LANG,
      SystemRoot: process.env.SystemRoot
    }
    for (const name of plugin.manifest.permissions.environment) {
      if (process.env[name] !== undefined) env[name] = process.env[name]
    }
    env.WEBFORGE_PROJECT_PATH = project?.path ?? ''
    env.WEBFORGE_INPUTS = JSON.stringify(inputs)
    if (!plugin.manifest.permissions.network) {
      env.HTTP_PROXY = 'http://127.0.0.1:9'
      env.HTTPS_PROXY = 'http://127.0.0.1:9'
    }
    let command = plugin.manifest.command
    const expandArg = (template: string): string[] => {
      const conditional = template.match(/^\?\{\{(\w+)\}\}:(.+)$/)
      if (conditional) {
        const value = inputs[conditional[1]]
        return value === true || value === 'true' ? splitArguments(conditional[2]) : []
      }
      const paired = template.match(/^(-{1,2}[\w-]+)=\{\{(\w+)\}\}$/)
      if (paired && (inputs[paired[2]] === undefined || inputs[paired[2]] === '')) return []
      const match = template.match(/^\{\{(\w+)\}\}$/)
      if (match) {
        const value = inputs[match[1]]
        if (value === undefined || value === '') return []
        if (typeof value === 'boolean') return value ? [substitute(template)] : []
        // Only the free-form field is tokenised; a path must survive as one argv entry.
        if (typeof value === 'string' && match[1] === 'arguments') return splitArguments(value)
        return [substitute(template)]
      }
      return [substitute(template)]
    }
    let args = plugin.manifest.args.flatMap(expandArg)
    if (plugin.runtime === 'node') {
      command = process.execPath
      env.ELECTRON_RUN_AS_NODE = '1'
      args = [path.join(plugin.entry, plugin.manifest.command), ...args]
    } else if (plugin.runtime === 'python') {
      command = process.platform === 'win32' ? 'python' : 'python3'
      args = ['-u', path.join(plugin.entry, plugin.manifest.command), ...args]
    } else if (plugin.runtime === 'executable') {
      const launcher = plugin.manifest.command === 'npm' || plugin.manifest.command === 'npx' ? findNpmLauncher(plugin.manifest.command) : null
      if (launcher) {
        command = process.execPath
        env.ELECTRON_RUN_AS_NODE = '1'
        args = [launcher, ...args]
      }
    } else if (plugin.runtime === 'shell') {
      if (process.platform === 'win32') {
        command = 'cmd.exe'
        args = ['/d', '/s', '/c', [plugin.manifest.command, ...args].join(' ')]
      } else {
        command = '/bin/sh'
        args = ['-c', [plugin.manifest.command, ...args].join(' ')]
      }
    }
    return { command, args, cwd: project ? cwd : plugin.entry, env }
  }

  private executeProcess(
    runId: string,
    execution: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv },
    plugin: Plugin,
    log: (stream: 'stdout' | 'stderr' | 'system', chunk: string) => void,
    controller: AbortController
  ): Promise<{ exitCode: number | null; status: PluginRunStatus; outputPaths: string[] }> {
    return new Promise((resolve) => {
      const child = spawn(execution.command, execution.args, {
        cwd: execution.cwd,
        env: execution.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32'
      })
      this.running.set(runId, { child, startedAt: new Date().toISOString(), pluginId: plugin.id })
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        this.cancel(runId)
      }, Math.min(plugin.manifest.timeoutSeconds, 1800) * 1000)
      const onAbort = (): void => {
        this.cancel(runId)
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      child.stdout?.on('data', (chunk: Buffer) => log('stdout', chunk.toString('utf8')))
      child.stderr?.on('data', (chunk: Buffer) => log('stderr', chunk.toString('utf8')))
      child.on('error', (error) => {
        log('stderr', `خطای اجرا: ${error.message}\n`)
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', onAbort)
        resolve({ exitCode: null, status: 'failed', outputPaths: [] })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', onAbort)
        const outputPaths = this.collectOutputs(plugin, execution.cwd)
        const status: PluginRunStatus = timedOut
          ? 'timeout'
          : controller.signal.aborted
            ? 'cancelled'
            : code === 0
              ? 'success'
              : 'failed'
        resolve({ exitCode: code, status, outputPaths })
      })
    })
  }

  private collectOutputs(plugin: Plugin, cwd: string): string[] {
    const paths: string[] = []
    for (const output of plugin.manifest.outputs) {
      const candidate = path.resolve(cwd, output.path)
      if (fs.existsSync(candidate)) paths.push(candidate)
    }
    return paths
  }

  private async adminPanel(context: BuiltinContext): Promise<string[]> {
    if (!context.project) throw new AppError('PROJECT_REQUIRED', 'برای نصب پنل، یک پروژه انتخاب کن.')
    const project = context.project
    const siteRoot = this.siteRoot(project)
    const kit = this.kitRoot()
    const pages: Array<{ path: string; src: string }> = []
    const htmlFiles: string[] = []
    const walk = (dir: string, depth: number): void => {
      if (depth > 6) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['assets', 'reports', 'node_modules', '.git', '.webforge', '_mirror', 'mirror'].includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, depth + 1)
        else if (/\.html?$/i.test(entry.name) && entry.name !== 'admin.html') htmlFiles.push(full)
      }
    }
    walk(siteRoot, 0)
    for (const file of htmlFiles) {
      const relative = path.relative(siteRoot, file).split(path.sep).join('/')
      const isIndex = relative.endsWith('index.html')
      const pagePath = isIndex ? `/${relative.replace(/index\.html$/, '')}` : `/${relative}`
      const src = isIndex ? pagePath : `/${relative}`
      pages.push({ path: pagePath.replace(/\/$/, '/') || '/', src })
      const html = fs.readFileSync(file, 'utf8')
      if (html.includes('gf-editor')) continue
      const depth = relative.split('/').length - 1
      const tag = `<!-- gf-editor --><script src="${'../'.repeat(depth)}site-editor.js" defer></script>`
      const next = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : html + tag
      fs.writeFileSync(file, next, 'utf8')
      context.log('stdout', `تزریق ویرایشگر به ${relative}\n`)
    }
    for (const name of ['admin.html', 'site-editor.js']) {
      const source = path.join(kit, name)
      if (!fs.existsSync(source)) throw new AppError('KIT_MISSING', `فایل ${name} در بستهٔ پنل پیدا نشد.`)
      fs.copyFileSync(source, path.join(siteRoot, name))
    }
    const contentPath = path.join(siteRoot, 'content.json')
    if (!fs.existsSync(contentPath)) fs.writeFileSync(contentPath, '{"version":1,"pages":{}}', 'utf8')
    const configPath = path.join(siteRoot, 'panel-config.json')
    if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, '{}\n', 'utf8')
    fs.writeFileSync(path.join(siteRoot, 'pages.json'), JSON.stringify({ pages }, null, 1), 'utf8')
    fs.mkdirSync(path.join(siteRoot, 'assets', 'uploads'), { recursive: true })
    context.log('stdout', `پنل نصب شد. ${pages.length} صفحه ایندکس شد.\n`)
    return [path.join(siteRoot, 'admin.html'), path.join(siteRoot, 'pages.json')]
  }

  private siteRoot(project: Project): string {
    const clean = path.join(project.path, 'clean')
    return fs.existsSync(clean) ? clean : project.path
  }

  private kitRoot(): string {
    const candidates = [
      path.join(process.resourcesPath, 'resources', 'kits', 'admin-panel'),
      path.join(app.getAppPath(), 'resources', 'kits', 'admin-panel')
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    throw new AppError('KIT_MISSING', 'بستهٔ پنل مدیریت در نصب برنامه پیدا نشد.')
  }
}

function splitArguments(value: string): string[] {
  const result: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const character of value.trim()) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (current) {
        result.push(current)
        current = ''
      }
      continue
    }
    current += character
  }
  if (current) result.push(current)
  return result
}

function toRun(row: RunRow): PluginRun {
  let outputPaths: string[] = []
  try {
    outputPaths = JSON.parse(row.output_paths) as string[]
  } catch {
    outputPaths = []
  }
  return {
    id: row.id,
    pluginId: row.plugin_id,
    projectId: row.project_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    logPath: row.log_path,
    outputPaths,
    durationMs: row.duration_ms
  }
}

export const schemas = { pluginManifest: pluginManifestSchema as unknown as z.ZodType<PluginManifest> }
