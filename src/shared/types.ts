export type ThemeMode = 'dark' | 'light' | 'system'
export type ProjectType = 'static' | 'node' | 'unknown'
export type ProjectStatus = 'ready' | 'extracting' | 'partial' | 'error' | 'archived'

export interface Project {
  id: string
  name: string
  path: string
  type: ProjectType
  sourceUrl: string | null
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
  status: ProjectStatus
  entryFile: string | null
  fileCount: number
}

export interface ProjectDetection {
  type: ProjectType
  entryFile: string | null
  htmlFiles: string[]
  packageJson: boolean
  framework: string | null
  fileCount: number
  hints: string[]
}

export interface FileNode {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  size: number
  children?: FileNode[]
}

export interface ExtractionOptions {
  url: string
  name: string
  outputRoot?: string
  maxFiles: number
  maxBytesMb: number
  maxDepth: number
  timeoutSeconds: number
  concurrency?: number
  rendered: boolean
  includeExternalAssets: boolean
  respectRobots: boolean
}

export interface ExtractionWarning {
  url: string
  reason: string
}

export interface ExtractionReport {
  projectId: string
  projectPath: string
  sourceUrl: string
  mode: 'http' | 'rendered'
  pages: number
  assets: number
  bytes: number
  skipped: number
  warnings: ExtractionWarning[]
  durationMs: number
  partial: boolean
  manifestPath: string
}

export interface ExtractionProgress {
  projectId: string
  phase: 'validating' | 'discovering' | 'downloading' | 'rewriting' | 'finishing'
  currentUrl: string
  completed: number
  total: number
  bytes: number
  warnings: number
  message: string
  elapsedMs: number
}

export interface PreviewState {
  projectId: string
  running: boolean
  url: string | null
  port: number | null
  token: string | null
  pid: number | null
  startedAt: string | null
  /** While true the site's own scripts are not served, so the preview shows the file as written. */
  scriptsBlocked: boolean
  error: string | null
}

export interface AppSettings {
  theme: ThemeMode
  projectsDir: string
  pluginDir: string
  portStart: number
  portEnd: number
  aiBaseUrl: string
  aiModel: string
  aiKeyConfigured: boolean
  extraction: {
    maxFiles: number
    maxBytesMb: number
    maxDepth: number
    timeoutSeconds: number
    concurrency: number
  }
}

export interface SettingsPatch {
  theme?: ThemeMode
  projectsDir?: string
  pluginDir?: string
  portStart?: number
  portEnd?: number
  aiBaseUrl?: string
  aiModel?: string
  aiKey?: string
  extraction?: Partial<AppSettings['extraction']>
}

export interface EditorTarget {
  selector: string
  tag: string
  text: string
  html: string
  attrs: Record<string, string | null>
  classes: string[]
  styles: Record<string, string>
  imageSrc: string | null
  label: string
  /** Number of non-blank direct text nodes inside the element. */
  textCount?: number
  /** Concatenated direct text nodes; the server edits exactly these. */
  editableText?: string
  hasElementChildren?: boolean
  /** The element and its ancestors, nearest first, for quick re-targeting. */
  levels?: Array<{ selector: string; tag: string; text: string; editableText?: string }>
  /** Index of the clicked text node among the target's own child text nodes. */
  textIndex?: number
  /** Text the user actually clicked, used to re-anchor the selection after a reload. */
  clickedText?: string
}

export interface EditorSelectionMessage {
  type: 'webforge:select'
  pagePath: string
  target: EditorTarget
}

export type EditAction =
  | { type: 'text'; text: string; textIndex?: number }
  | { type: 'attr'; name: string; value: string }
  | { type: 'removeAttr'; name: string }
  | { type: 'style'; name: string; value: string }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'link'; href: string; target?: string }
  | { type: 'html'; html: string }
  | { type: 'remove' }
  | { type: 'insertBefore'; html: string }
  | { type: 'insertAfter'; html: string }

export interface SaveEditRequest {
  projectId: string
  file: string
  selector: string
  action: EditAction
  fallbackText?: string
  textIndex?: number
}

export interface EditSummary {
  file: string
  kind: EditAction['type']
  before: string
  after: string
  backupPath: string
  eventId: string
  canUndo: boolean
  canRedo: boolean
}

export interface EditEventRecord {
  id: string
  projectId: string
  filePath: string
  kind: string
  before: string
  after: string
  createdAt: string
  reverted: boolean
}

export interface ReplaceImageRequest {
  projectId: string
  file: string
  selector: string
  sourcePath: string
}

export type PluginRuntime = 'node' | 'python' | 'executable' | 'shell' | 'builtin'

export interface PluginInput {
  key: string
  label: string
  type: 'text' | 'url' | 'number' | 'boolean' | 'select' | 'projectPath' | 'folder' | 'file' | 'textarea'
  required: boolean
  default?: string | number | boolean
  options?: Array<{ label: string; value: string }>
  placeholder?: string
  help?: string
}

export interface PluginOutput {
  key: string
  type: 'file' | 'folder' | 'json'
  path: string
  label?: string
}

export interface PluginPermissions {
  network: boolean
  projectWrite: boolean
  environment: string[]
}

export interface PluginManifest {
  name: string
  displayName: string
  description: string
  version: string
  runtime: PluginRuntime
  command: string
  args: string[]
  cwd: string
  inputs: PluginInput[]
  outputs: PluginOutput[]
  permissions: PluginPermissions
  timeoutSeconds: number
  builtin?: string
  icon?: string
}

export interface Plugin {
  id: string
  name: string
  displayName: string
  description: string
  version: string
  entry: string
  runtime: PluginRuntime
  enabled: boolean
  requiresNetwork: boolean
  requiresProjectWrite: boolean
  createdAt: string
  manifest: PluginManifest
  lastRunAt: string | null
  lastStatus: PluginRunStatus | null
  hasDependencies: boolean
}

export type PluginRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'timeout'

export interface PluginRun {
  id: string
  pluginId: string
  projectId: string | null
  status: PluginRunStatus
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  logPath: string
  outputPaths: string[]
  durationMs: number | null
}

export interface PluginRunEvent {
  runId: string
  stream: 'stdout' | 'stderr' | 'system'
  chunk: string
  status: PluginRunStatus
}

export interface PluginRunResult {
  run: PluginRun
  logs: string
  outputPaths: string[]
}

export interface AiPagePlan {
  slug: string
  title: string
  goal: string
  sections: Array<{ type: string; intent: string }>
}

export interface AiSitePlan {
  brand: {
    name: string
    oneLiner: string
    audience: string
    tone: string[]
  }
  design: {
    direction: string
    palette: { bg: string; fg: string; accent: string; muted: string; surface: string }
    typography: { display: string; body: string; scale: string[] }
    layout: string
    motion: string
  }
  nav: Array<{ label: string; href: string }>
  pages: AiPagePlan[]
  footer: { columns: string[]; legal: string }
  estimatedRequests: number
}

export interface AiBrief {
  brief: string
  businessName: string
  audience: string
  language: 'fa' | 'en'
  pageCount: number
  style: string
  colors: string
  sections: string[]
  outputRoot?: string
}

export interface AiPlanResult {
  plan: AiSitePlan
  model: string
  estimatedRequests: number
  estimatedCostUsd: number
}

export interface AiProgress {
  stage: 'planning' | 'tokens' | 'shell' | 'page' | 'writing' | 'done' | 'error'
  current: number
  total: number
  message: string
  file: string | null
}

export interface AiGenerateResult {
  projectId: string
  projectPath: string
  files: string[]
  model: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  previewUrl: string | null
}

export interface GithubRepoSummary {
  id: number
  fullName: string
  owner: string
  name: string
  description: string
  stars: number
  forks: number
  language: string | null
  license: string | null
  archived: boolean
  pushedAt: string
  openIssues: number
  htmlUrl: string
  topics: string[]
  risk: { level: 'low' | 'medium' | 'high'; reasons: string[] }
}

export interface GithubRepoDetail extends GithubRepoSummary {
  readme: string
  defaultBranch: string
  sizeKb: number
  homepage: string | null
  compatibility: string
}

export interface ToolAiVerdict {
  used: boolean
  verdict: 'safe' | 'caution' | 'unsafe' | 'unknown'
  riskLevel: 'low' | 'medium' | 'high'
  summary: string
  capabilities: string[]
  runnable: boolean
  runtime: 'node' | 'python' | 'binary' | 'web' | 'unknown'
  usage: string
  warnings: string[]
  permissions: { network: boolean; projectWrite: boolean }
}

export interface IntegrationFinding {
  severity: 'info' | 'warning' | 'critical'
  message: string
  file?: string
}

export interface IntegrationReport {
  fullName: string
  repoUrl: string
  license: string | null
  stars: number
  riskLevel: 'low' | 'medium' | 'high'
  ai: ToolAiVerdict | null
  runtime: 'node' | 'python' | 'binary' | 'web' | 'unknown'
  installable: boolean
  reason: string
  packageName: string | null
  bin: string | null
  scripts: string[]
  fileCount: number
  sizeKb: number
  findings: IntegrationFinding[]
  proposedManifest: PluginManifest | null
  usage: string
  connect: ToolConnectPlan
}

/** How WebForge wires an external tool into the app. */
export type ConnectStrategy =
  | 'local-node'
  | 'npm-package'
  | 'local-python'
  | 'static-project'
  | 'manual'

export interface ToolConnectPlan {
  strategy: ConnectStrategy
  /** False when WebForge can only document the steps instead of running them. */
  actionable: boolean
  title: string
  /** Executable the plugin will spawn, already resolved for this OS. */
  command: string
  /** File inside the repository, or the npm package name for npm-package. */
  entry: string | null
  args: string[]
  inputs: PluginInput[]
  outputs: PluginOutput[]
  permissions: PluginPermissions
  timeoutSeconds: number
  /** Needs `npm install --ignore-scripts` before the first run. */
  needsDependencies: boolean
  steps: string[]
  demoArguments: string
  rationale: string
  confidence: number
  usedAi: boolean
}

export interface ToolConnectResult {
  strategy: ConnectStrategy
  report: IntegrationReport
  plugin: Plugin | null
  project: Project | null
  installedTo: string | null
  logs: string[]
}

export interface InstallDepsResult {
  pluginId: string
  ok: boolean
  exitCode: number | null
  logs: string
}

export interface QaFinding {
  tool: string
  category: 'html' | 'links' | 'a11y' | 'seo' | 'performance' | 'security' | 'console' | 'responsive'
  severity: 'info' | 'minor' | 'major' | 'critical'
  message: string
  url?: string
  selector?: string
  help?: string
}

export interface QaReport {
  projectId: string
  startedAt: string
  durationMs: number
  score: number
  findings: QaFinding[]
  metrics: {
    pages: number
    lcpMs: number | null
    domContentLoadedMs: number | null
    loadMs: number | null
    transferKb: number
    consoleErrors: number
    failedRequests: number
    imagesWithoutAlt: number
  }
}

export interface Diagnostics {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  userData: string
  logsDir: string
  dbPath: string
  activePreviews: Array<{ projectId: string; url: string; pid: number }>
  runningPlugins: Array<{ runId: string; pluginId: string; startedAt: string }>
  recentErrors: Array<{ at: string; code: string; message: string }>
  counts: { projects: number; plugins: number; edits: number; runs: number }
}

export interface AppInfo {
  version: string
  platform: string
  isPackaged: boolean
  homeDir: string
  defaultProjectsDir: string
  hasAiKey: boolean
}

export interface IpcError {
  code: string
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }
