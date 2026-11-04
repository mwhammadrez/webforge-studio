import { app, dialog, ipcMain, shell, BrowserWindow, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z, type ZodType } from 'zod'
import type { IpcResult } from '@shared/types'
import {
  aiBriefSchema,
  cancelRunSchema,
  extractionOptionsSchema,
  filePathSchema,
  githubRepoSchema,
  githubSearchSchema,
  openPathSchema,
  pluginIdSchema,
  pluginRemoveSchema,
  pathSchema,
  pluginRunSchema,
  pluginToggleSchema,
  previewScriptsSchema,
  projectIdSchema,
  qaRunSchema,
  removeProjectSchema,
  renameProjectSchema,
  replaceImageSchema,
  saveEditSchema,
  settingsPatchSchema
} from '@shared/schemas'
import { aiPlanSchema } from './services/ai'
import type { Database } from './core/db'
import type { Logger } from './core/logger'
import { AppError, toAppError } from './core/errors'
import type { SettingsService } from './services/settings'
import type { ProjectService } from './services/projects'
import type { ExtractionService } from './services/extraction'
import type { PreviewService } from './services/preview'
import type { EditorService } from './services/editor'
import type { PluginService } from './services/plugins'
import type { AiService } from './services/ai'
import type { DiscoveryService } from './services/discovery'
import type { IntegrationService } from './services/integration'
import type { QaService } from './services/qa'
import { IPC } from '@shared/ipc'

export interface MainContext {
  db: Database
  logger: Logger
  settings: SettingsService
  projects: ProjectService
  extraction: ExtractionService
  preview: PreviewService
  editor: EditorService
  plugins: PluginService
  ai: AiService
  discovery: DiscoveryService
  integration: IntegrationService
  qa: QaService
  getWindow: () => BrowserWindow | null
}

const createProjectSchema = z.object({ name: z.string().trim().min(1).max(120) })
const generateSchema = z.object({
  brief: aiBriefSchema,
  plan: aiPlanSchema,
  jobId: z.string().min(1).max(100)
})
const fileKindSchema = z.enum(['manifest', 'image', 'any'])

export function registerIpc(context: MainContext): void {
  const handle = <TInput, TOutput>(
    channel: string,
    schema: ZodType<TInput> | null,
    handler: (input: TInput, event: Electron.IpcMainInvokeEvent) => Promise<TOutput> | TOutput
  ): void => {
    ipcMain.handle(channel, async (event, raw): Promise<IpcResult<TOutput>> => {
      try {
        let parsed = raw as TInput
        if (schema) {
          const result = schema.safeParse(raw)
          if (!result.success) {
            throw new AppError(
              'INVALID_INPUT',
              `ورودی نامعتبر است: ${result.error.issues.map((issue) => `${issue.path.join('.') || 'field'}: ${issue.message}`).join(' | ')}`
            )
          }
          parsed = result.data
        }
        const data = await handler(parsed, event)
        return { ok: true, data }
      } catch (error) {
        const appError = toAppError(error)
        context.logger.error('IPC_ERROR', appError.message, { channel, code: appError.code })
        return { ok: false, error: { code: appError.code, message: appError.message } }
      }
    })
  }

  handle(IPC.appInfo, null, async () => {
    const settings = context.settings.get()
    return {
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
      homeDir: app.getPath('home'),
      defaultProjectsDir: settings.projectsDir,
      hasAiKey: context.settings.hasApiKey()
    }
  })

  handle(IPC.appPickFolder, z.string().max(200).optional(), async (title) => {
    const result = await openDialog(context, {
      title: title ?? 'انتخاب پوشه',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle(IPC.appPickFile, fileKindSchema, async (kind) => {
    const filters =
      kind === 'manifest'
        ? [{ name: 'Plugin manifest', extensions: ['json'] }]
        : kind === 'image'
          ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }]
          : [{ name: 'All files', extensions: ['*'] }]
    const result = await openDialog(context, {
      title: kind === 'manifest' ? 'انتخاب مانیفست ابزار' : 'انتخاب فایل',
      properties: ['openFile'],
      filters
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle(IPC.appOpenExternal, z.string().url().max(2048), async (url) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new AppError('INVALID_URL', 'فقط لینک‌های http و https باز می‌شوند.')
    }
    await shell.openExternal(parsed.toString())
  })

  handle(IPC.appOpenPath, openPathSchema, async (input) => {
    assertRevealablePath(input.path)
    const error = await shell.openPath(input.path)
    if (error) throw new AppError('OPEN_PATH_FAILED', error)
  })

  handle(IPC.settingsGet, null, () => context.settings.get())

  handle(IPC.settingsUpdate, settingsPatchSchema, (patch) => {
    const settings = context.settings.update(patch)
    applyTheme(settings.theme)
    return settings
  })

  handle(IPC.settingsTestAi, null, () => context.ai.testConnection())

  handle(IPC.settingsExport, null, async () => {
    const result = await saveDialog(context, {
      title: 'خروجی گرفتن از داده‌های برنامه',
      defaultPath: path.join(app.getPath('documents'), `webforge-export-${Date.now()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: context.settings.exportAll(),
      projects: context.projects.list(true),
      plugins: context.plugins.list(),
      runs: context.plugins.runs(undefined, 200),
      diagnostics: await diagnostics(context)
    }
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
    return result.filePath
  })

  handle(IPC.settingsReset, null, () => {
    context.settings.clearAll()
    return context.settings.update({})
  })

  handle(IPC.projectsList, null, () => context.projects.list())

  handle(IPC.projectsCreate, createProjectSchema, (input) => {
    const settings = context.settings.get()
    const created = context.projects.createFolder(input.name, settings.projectsDir)
    return context.projects.register({ name: created.name, dir: created.dir, type: 'static' })
  })

  handle(IPC.projectsOpenDialog, null, async () => {
    const result = await openDialog(context, {
      title: 'باز کردن پوشهٔ سایت',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const folder = result.filePaths[0]
    const detection = context.projects.detect(folder)
    if (detection.type === 'unknown') {
      throw new AppError('NO_ENTRY_FILE', 'این پوشه فایل قابل‌اجرایی برای سایت ندارد.')
    }
    return context.projects.register({ name: path.basename(folder), dir: folder, type: detection.type })
  })

  handle(IPC.projectsOpenPath, openPathSchema, (input) => {
    const detection = context.projects.detect(input.path)
    if (detection.type === 'unknown') throw new AppError('NO_ENTRY_FILE', 'این پوشه فایل قابل‌اجرایی برای سایت ندارد.')
    return context.projects.register({ name: path.basename(input.path), dir: input.path, type: detection.type })
  })

  handle(
    IPC.projectsImport,
    z.object({ path: pathSchema, allowUnknown: z.boolean().default(false) }),
    (input) => {
      const detection = context.projects.detect(input.path)
      if (detection.type === 'unknown' && !input.allowUnknown) {
        throw new AppError('NO_ENTRY_FILE', 'این پوشه فایل قابل‌اجرایی برای سایت ندارد.')
      }
      return context.projects.register({
        name: path.basename(input.path),
        dir: input.path,
        type: detection.type,
        status: detection.type === 'unknown' ? 'partial' : 'ready'
      })
    }
  )

  handle(IPC.projectsDetect, openPathSchema, (input) => context.projects.detect(input.path))

  handle(IPC.projectsRemove, removeProjectSchema, (input) => context.projects.remove(input.projectId, input.deleteFiles))

  handle(IPC.projectsRename, renameProjectSchema, (input) => context.projects.rename(input.projectId, input.name))

  handle(IPC.projectsTree, projectIdSchema, (input) => context.projects.tree(input.projectId))

  handle(IPC.projectsReadFile, filePathSchema, (input) => context.projects.readFile(input.projectId, input.relativePath))

  handle(IPC.extractStart, extractionOptionsSchema, async (input, event) => {
    const settings = context.settings.get()
    const report = await context.extraction.extract(
      {
        ...input,
        outputRoot: input.outputRoot ?? settings.projectsDir,
        concurrency: input.concurrency ?? settings.extraction.concurrency
      },
      {
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.extractProgress, progress)
        }
      }
    )
    return report
  })

  handle(IPC.extractCancel, projectIdSchema, (input) => context.extraction.cancel(input.projectId))

  handle(IPC.previewStart, projectIdSchema, (input) => context.preview.start(input.projectId))
  handle(IPC.previewStop, projectIdSchema, (input) => context.preview.stop(input.projectId))
  handle(IPC.previewState, projectIdSchema, (input) => context.preview.state(input.projectId))
  handle(IPC.previewSetScripts, previewScriptsSchema, (input) =>
    context.preview.setScripts(input.projectId, input.blocked)
  )

  handle(IPC.editorSave, saveEditSchema, (input) => context.editor.save(input))
  handle(IPC.editorReplaceImage, replaceImageSchema, (input) =>
    context.editor.replaceImage(input.projectId, input.file, input.selector, input.sourcePath)
  )
  handle(IPC.editorUndo, projectIdSchema, (input) => context.editor.undo(input.projectId))
  handle(IPC.editorRedo, projectIdSchema, (input) => context.editor.redo(input.projectId))
  handle(IPC.editorHistory, projectIdSchema, (input) => context.editor.history(input.projectId))

  handle(IPC.pluginsList, null, () => context.plugins.list())

  handle(IPC.pluginsAddManifest, null, async () => {
    const result = await openDialog(context, {
      title: 'انتخاب مانیفست یا پوشهٔ ابزار',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Manifest', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return context.plugins.addFromPath(result.filePaths[0])
  })

  handle(IPC.pluginsAddPath, openPathSchema, (input) => context.plugins.addFromPath(input.path))

  handle(IPC.pluginsToggle, pluginToggleSchema, (input) => context.plugins.toggle(input.pluginId, input.enabled))

  handle(IPC.pluginsRemove, pluginRemoveSchema, (input) => {
    context.plugins.remove(input.pluginId)
  })

  handle(IPC.pluginsRun, pluginRunSchema, async (input, event) => {
    return context.plugins.run(input.pluginId, input.projectId ?? null, input.inputs, (payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.pluginsEvent, payload)
    })
  })

  handle(IPC.pluginsCancel, cancelRunSchema, (input) => context.plugins.cancel(input.runId))

  handle(IPC.pluginsRuns, z.object({ pluginId: z.string().optional() }).optional(), (input) =>
    context.plugins.runs(input?.pluginId)
  )

  handle(IPC.pluginInstallDeps, pluginIdSchema, (input) => context.plugins.installDependencies(input.pluginId))

  handle(IPC.integrationInspect, githubRepoSchema, (input) => context.integration.inspect(input.fullName))

  handle(
    IPC.integrationConnect,
    z.object({
      fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      force: z.boolean().default(false),
      installDependencies: z.boolean().default(true)
    }),
    (input) => context.integration.connect(input.fullName, input)
  )

  handle(IPC.aiPlan, aiBriefSchema, (brief) => context.ai.plan(brief))

  handle(IPC.aiGenerate, generateSchema, async (input, event) => {
    return context.ai.generate(input.brief, input.plan, input.jobId, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.aiProgress, progress)
    })
  })

  handle(IPC.aiCancel, z.object({ jobId: z.string().min(1) }), (input) => context.ai.cancel(input.jobId))

  handle(IPC.discoverSearch, githubSearchSchema, (input) => context.discovery.search(input.query, input.page, input.sort))

  handle(IPC.discoverRepo, githubRepoSchema, (input) => context.discovery.repo(input.fullName))

  handle(IPC.qaRun, qaRunSchema, (input) => context.qa.run(input.projectId, input.pages, input.checks))

  handle(IPC.qaCancel, projectIdSchema, (input) => context.qa.cancel(input.projectId))

  handle(IPC.diagnosticsGet, null, () => diagnostics(context))

  ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.on('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
}

function openDialog(
  context: MainContext,
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const window = context.getWindow()
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
}

function saveDialog(
  context: MainContext,
  options: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  const window = context.getWindow()
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
}

// shell.openPath runs files with these extensions, and downloaded repos can contain any of them.
const REVEALABLE_BLOCK = /\.(exe|msi|com|scr|pif|cpl|bat|cmd|vbs|vbe|js|jse|wsf|wsh|ps1|ps1xml|lnk|jar|app|sh)$/i

function assertRevealablePath(target: string): void {
  if (REVEALABLE_BLOCK.test(target)) {
    throw new AppError('OPEN_PATH_BLOCKED', 'فایل‌های اجرایی از این مسیر باز نمی‌شوند.')
  }
}

export function applyTheme(theme: 'dark' | 'light' | 'system'): void {
  nativeTheme.themeSource = theme
}

async function diagnostics(context: MainContext): Promise<import('@shared/types').Diagnostics> {
  const count = (table: string): number => {
    const row = context.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)
    return row?.c ?? 0
  }
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    logsDir: context.logger.logsDir,
    dbPath: context.db.file,
    activePreviews: context.preview.active(),
    runningPlugins: context.plugins.active(),
    recentErrors: context.logger.recentErrors(20),
    counts: {
      projects: count('projects'),
      plugins: count('plugins'),
      edits: count('edit_events'),
      runs: count('plugin_runs')
    }
  }
}
