import type {
  AiBrief,
  AiGenerateResult,
  AiPlanResult,
  AiProgress,
  AiSitePlan,
  AppInfo,
  AppSettings,
  Diagnostics,
  EditEventRecord,
  EditSummary,
  EditorSelectionMessage,
  ExtractionOptions,
  ExtractionProgress,
  ExtractionReport,
  FileNode,
  GithubRepoDetail,
  GithubRepoSummary,
  InstallDepsResult,
  IntegrationInstallResult,
  IntegrationReport,
  IpcResult,
  Plugin,
  PluginRun,
  PluginRunEvent,
  PluginRunResult,
  PreviewState,
  Project,
  ProjectDetection,
  QaReport,
  ReplaceImageRequest,
  SaveEditRequest,
  SettingsPatch
} from './types'

export const IPC = {
  appInfo: 'app:info',
  appPickFolder: 'app:pickFolder',
  appPickFile: 'app:pickFile',
  appOpenExternal: 'app:openExternal',
  appOpenPath: 'app:openPath',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsTestAi: 'settings:testAi',
  settingsExport: 'settings:export',
  settingsReset: 'settings:reset',
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsOpenDialog: 'projects:openDialog',
  projectsOpenPath: 'projects:openPath',
  projectsImport: 'projects:import',
  projectsDetect: 'projects:detect',
  projectsRemove: 'projects:remove',
  projectsRename: 'projects:rename',
  projectsTree: 'projects:tree',
  projectsReadFile: 'projects:readFile',
  extractStart: 'extract:start',
  extractCancel: 'extract:cancel',
  extractProgress: 'extract:progress',
  previewStart: 'preview:start',
  previewStop: 'preview:stop',
  previewState: 'preview:state',
  editorSave: 'editor:save',
  editorReplaceImage: 'editor:replaceImage',
  editorUndo: 'editor:undo',
  editorRedo: 'editor:redo',
  editorHistory: 'editor:history',
  pluginsList: 'plugins:list',
  pluginsAddManifest: 'plugins:addManifest',
  pluginsAddPath: 'plugins:addPath',
  pluginsToggle: 'plugins:toggle',
  pluginsRemove: 'plugins:remove',
  pluginsRun: 'plugins:run',
  pluginsCancel: 'plugins:cancel',
  pluginsRuns: 'plugins:runs',
  pluginInstallDeps: 'plugins:installDeps',
  pluginsEvent: 'plugins:event',
  integrationInspect: 'integration:inspect',
  integrationInstall: 'integration:install',
  aiPlan: 'ai:plan',
  aiGenerate: 'ai:generate',
  aiCancel: 'ai:cancel',
  aiProgress: 'ai:progress',
  discoverSearch: 'discover:search',
  discoverRepo: 'discover:repo',
  qaRun: 'qa:run',
  qaCancel: 'qa:cancel',
  diagnosticsGet: 'diagnostics:get',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close'
} as const

export type Unsubscribe = () => void

export interface WebForgeApi {
  app: {
    info(): Promise<IpcResult<AppInfo>>
    pickFolder(title?: string): Promise<IpcResult<string | null>>
    pickFile(kind: 'manifest' | 'image' | 'any'): Promise<IpcResult<string | null>>
    openExternal(url: string): Promise<IpcResult<void>>
    openPath(target: string): Promise<IpcResult<void>>
  }
  settings: {
    get(): Promise<IpcResult<AppSettings>>
    update(patch: SettingsPatch): Promise<IpcResult<AppSettings>>
    testAi(): Promise<IpcResult<{ ok: boolean; message: string; models?: string[] }>>
    exportData(): Promise<IpcResult<string | null>>
    reset(): Promise<IpcResult<AppSettings>>
  }
  projects: {
    list(): Promise<IpcResult<Project[]>>
    create(name: string): Promise<IpcResult<Project>>
    openDialog(): Promise<IpcResult<Project | null>>
    openPath(path: string): Promise<IpcResult<Project>>
    import(path: string, allowUnknown: boolean): Promise<IpcResult<Project>>
    detect(path: string): Promise<IpcResult<ProjectDetection>>
    remove(projectId: string, deleteFiles: boolean): Promise<IpcResult<{ movedTo: string | null }>>
    rename(projectId: string, name: string): Promise<IpcResult<Project>>
    tree(projectId: string): Promise<IpcResult<FileNode[]>>
    readFile(projectId: string, relativePath: string): Promise<IpcResult<{ content: string; size: number; language: string }>>
  }
  extract: {
    start(options: ExtractionOptions): Promise<IpcResult<ExtractionReport>>
    cancel(projectId: string): Promise<IpcResult<boolean>>
    onProgress(callback: (progress: ExtractionProgress) => void): Unsubscribe
  }
  preview: {
    start(projectId: string): Promise<IpcResult<PreviewState>>
    stop(projectId: string): Promise<IpcResult<PreviewState>>
    state(projectId: string): Promise<IpcResult<PreviewState>>
  }
  editor: {
    save(request: SaveEditRequest): Promise<IpcResult<EditSummary>>
    replaceImage(request: ReplaceImageRequest): Promise<IpcResult<EditSummary>>
    undo(projectId: string): Promise<IpcResult<{ restoredFile: string; eventId: string }>>
    redo(projectId: string): Promise<IpcResult<{ restoredFile: string; eventId: string }>>
    history(projectId: string): Promise<IpcResult<EditEventRecord[]>>
  }
  plugins: {
    list(): Promise<IpcResult<Plugin[]>>
    addManifest(): Promise<IpcResult<Plugin | null>>
    addPath(path: string): Promise<IpcResult<Plugin>>
    toggle(pluginId: string, enabled: boolean): Promise<IpcResult<Plugin>>
    remove(pluginId: string): Promise<IpcResult<void>>
    run(pluginId: string, projectId: string | null, inputs: Record<string, string | number | boolean>): Promise<IpcResult<PluginRunResult>>
    cancel(runId: string): Promise<IpcResult<boolean>>
    runs(pluginId?: string): Promise<IpcResult<PluginRun[]>>
    installDependencies(pluginId: string): Promise<IpcResult<InstallDepsResult>>
    onEvent(callback: (event: PluginRunEvent) => void): Unsubscribe
  }
  ai: {
    plan(brief: AiBrief): Promise<IpcResult<AiPlanResult>>
    generate(brief: AiBrief, plan: AiSitePlan, jobId: string): Promise<IpcResult<AiGenerateResult>>
    cancel(jobId: string): Promise<IpcResult<boolean>>
    onProgress(callback: (progress: AiProgress) => void): Unsubscribe
  }
  integration: {
    inspect(fullName: string): Promise<IpcResult<IntegrationReport>>
    install(fullName: string, force: boolean): Promise<IpcResult<IntegrationInstallResult>>
  }
  discover: {
    search(query: string, page: number, sort: 'stars' | 'updated' | 'best-match'): Promise<IpcResult<{ total: number; items: GithubRepoSummary[] }>>
    repo(fullName: string): Promise<IpcResult<GithubRepoDetail>>
  }
  qa: {
    run(projectId: string, pages: string[], checks: string[]): Promise<IpcResult<QaReport>>
    cancel(projectId: string): Promise<IpcResult<boolean>>
  }
  diagnostics: {
    get(): Promise<IpcResult<Diagnostics>>
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  events: {
    onEditorSelection(callback: (message: EditorSelectionMessage) => void): Unsubscribe
    onNavigate(callback: (page: string, projectId?: string) => void): Unsubscribe
  }
}
