import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResult } from '@shared/types'
import type { Unsubscribe, WebForgeApi } from '@shared/ipc'
import { IPC } from '@shared/ipc'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  return (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
}

function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: WebForgeApi = {
  app: {
    info: () => invoke('app:info'),
    pickFolder: (title) => invoke('app:pickFolder', title),
    pickFile: (kind) => invoke('app:pickFile', kind),
    openExternal: (url) => invoke('app:openExternal', url),
    openPath: (target) => invoke('app:openPath', { path: target })
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    testAi: () => invoke('settings:testAi'),
    exportData: () => invoke('settings:export'),
    reset: () => invoke('settings:reset')
  },
  projects: {
    list: () => invoke('projects:list'),
    create: (name) => invoke('projects:create', { name }),
    openDialog: () => invoke('projects:openDialog'),
    openPath: (path) => invoke('projects:openPath', { path }),
    import: (path, allowUnknown) => invoke('projects:import', { path, allowUnknown }),
    detect: (path) => invoke('projects:detect', { path }),
    remove: (projectId, deleteFiles) => invoke('projects:remove', { projectId, deleteFiles }),
    rename: (projectId, name) => invoke('projects:rename', { projectId, name }),
    tree: (projectId) => invoke('projects:tree', { projectId }),
    readFile: (projectId, relativePath) => invoke('projects:readFile', { projectId, relativePath })
  },
  extract: {
    start: (options) => invoke('extract:start', options),
    cancel: (projectId) => invoke('extract:cancel', { projectId }),
    onProgress: (callback) => subscribe(IPC.extractProgress, callback)
  },
  preview: {
    start: (projectId) => invoke('preview:start', { projectId }),
    stop: (projectId) => invoke('preview:stop', { projectId }),
    state: (projectId) => invoke('preview:state', { projectId }),
    setScripts: (projectId, blocked) => invoke('preview:setScripts', { projectId, blocked })
  },
  editor: {
    save: (request) => invoke('editor:save', request),
    replaceImage: (request) => invoke('editor:replaceImage', request),
    undo: (projectId) => invoke('editor:undo', { projectId }),
    redo: (projectId) => invoke('editor:redo', { projectId }),
    history: (projectId) => invoke('editor:history', { projectId })
  },
  plugins: {
    list: () => invoke('plugins:list'),
    addManifest: () => invoke('plugins:addManifest'),
    addPath: (path) => invoke('plugins:addPath', { path }),
    toggle: (pluginId, enabled) => invoke('plugins:toggle', { pluginId, enabled }),
    remove: (pluginId) => invoke('plugins:remove', { pluginId }),
    run: (pluginId, projectId, inputs) => invoke('plugins:run', { pluginId, projectId, inputs }),
    cancel: (runId) => invoke('plugins:cancel', { runId }),
    runs: (pluginId) => invoke('plugins:runs', pluginId ? { pluginId } : undefined),
    installDependencies: (pluginId) => invoke('plugins:installDeps', { pluginId }),
    onEvent: (callback) => subscribe(IPC.pluginsEvent, callback)
  },
  integration: {
    inspect: (fullName) => invoke('integration:inspect', { fullName }),
    connect: (fullName, options) =>
      invoke('integration:connect', {
        fullName,
        force: options?.force ?? false,
        installDependencies: options?.installDependencies ?? true
      })
  },
  ai: {
    plan: (brief) => invoke('ai:plan', brief),
    generate: (brief, plan, jobId) => invoke('ai:generate', { brief, plan, jobId }),
    cancel: (jobId) => invoke('ai:cancel', { jobId }),
    onProgress: (callback) => subscribe(IPC.aiProgress, callback)
  },
  discover: {
    search: (query, page, sort) => invoke('discover:search', { query, page, sort }),
    repo: (fullName) => invoke('discover:repo', { fullName })
  },
  qa: {
    run: (projectId, pages, checks) => invoke('qa:run', { projectId, pages, checks }),
    cancel: (projectId) => invoke('qa:cancel', { projectId })
  },
  diagnostics: {
    get: () => invoke('diagnostics:get')
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  events: {
    onEditorSelection: (callback) => subscribe('editor:selection', callback),
    onNavigate: (callback) => subscribe('app:navigate', callback)
  }
}

contextBridge.exposeInMainWorld('webforge', api)
