import { app, BrowserWindow, Menu, session, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Database } from './core/db'
import { Logger } from './core/logger'
import { SettingsService } from './services/settings'
import { ProjectService } from './services/projects'
import { ExtractionService } from './services/extraction'
import { PreviewService } from './services/preview'
import { EditorService } from './services/editor'
import { PluginService } from './services/plugins'
import { AiService } from './services/ai'
import { DiscoveryService } from './services/discovery'
import { IntegrationService } from './services/integration'
import { QaService } from './services/qa'
import { registerIpc, applyTheme, type MainContext } from './ipc'
import { AppError } from './core/errors'

const mainDir = path.dirname(fileURLToPath(import.meta.url))
if (process.env.WEBFORGE_USER_DATA) app.setPath('userData', path.resolve(process.env.WEBFORGE_USER_DATA))

let mainWindow: BrowserWindow | null = null
let context: MainContext | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

function windowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath(), 'utf8')) as WindowState
  } catch {
    return { width: 1440, height: 900 }
  }
}

function saveWindowState(window: BrowserWindow): void {
  if (!window) return
  const bounds = window.getNormalBounds()
  const state: WindowState = { ...bounds, maximized: window.isMaximized() }
  try {
    fs.writeFileSync(windowStatePath(), JSON.stringify(state), 'utf8')
  } catch {
    // Window state is a convenience; failure is not fatal.
  }
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  const db = new Database(path.join(userData, 'webforge.db'))
  const logger = new Logger(userData)
  const settings = new SettingsService(db, logger)
  const projects = new ProjectService(db, logger)
  const extraction = new ExtractionService(db, projects, logger, () => settings.get().projectsDir)
  const preview = new PreviewService(projects, logger, () => {
    const current = settings.get()
    return { start: current.portStart, end: current.portEnd }
  })
  const editor = new EditorService(db, projects, logger)
  const plugins = new PluginService(db, projects, logger)
  const ai = new AiService(settings, projects, logger)
  const discovery = new DiscoveryService(logger)
  const qa = new QaService(preview, projects, logger)
  const integration = new IntegrationService(discovery, ai, plugins, settings, logger, () => ({
    tempDir: app.getPath('temp'),
    pluginsDir: settings.get().pluginDir
  }))

  plugins.registerBuiltin('site-qa', async (builtin) => {
    if (!builtin.project) throw new AppError('PROJECT_REQUIRED', 'برای اجرای تست، یک پروژه انتخاب کن.')
    builtin.log('stdout', 'شروع تست جامع…\n')
    const report = await qa.run(builtin.project.id, [], [
      'html',
      'links',
      'a11y',
      'seo',
      'performance',
      'console',
      'responsive',
      'security'
    ])
    builtin.log('stdout', `امتیاز: ${report.score}\nیافته‌ها: ${report.findings.length}\n`)
    return [path.join(builtin.project.path, 'reports', 'qa-report.json')]
  })

  context = {
    db,
    logger,
    settings,
    projects,
    extraction,
    preview,
    editor,
    plugins,
    ai,
    discovery,
    integration,
    qa,
    getWindow: () => mainWindow
  }
  applyTheme(settings.get().theme)
  registerIpc(context)
  logger.info('APP_READY', 'WebForge Studio آماده شد.', { version: app.getVersion() })
  createWindow()
}

function createWindow(): void {
  const state = loadWindowState()
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#14181f',
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(mainDir, '../../resources/icons/icon.png'),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(mainDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  if (state.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('resize', () => mainWindow && saveWindowState(mainWindow))
  mainWindow.on('move', () => mainWindow && saveWindowState(mainWindow))
  mainWindow.on('close', () => mainWindow && saveWindowState(mainWindow))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const winSession = mainWindow.webContents.session
  winSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  winSession.setPermissionCheckHandler(() => false)
  winSession.on('will-download', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? ''
    if (current && new URL(url).origin !== new URL(current).origin) {
      event.preventDefault()
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(mainDir, '../renderer/index.html'))
  }
}

Menu.setApplicationMenu(null)

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  await bootstrap()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown || !context) return
  event.preventDefault()
  shuttingDown = true
  const ctx = context
  void (async () => {
    try {
      await ctx.preview.stopAll()
    } catch {
      // Preview shutdown is best effort.
    }
    try {
      ctx.db.close()
    } catch {
      // Database may already be closed.
    }
    app.quit()
  })()
})
