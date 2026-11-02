import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import type {
  ConnectStrategy,
  IntegrationFinding,
  IntegrationReport,
  PluginInput,
  PluginManifest,
  PluginOutput,
  Project,
  ToolAiVerdict,
  ToolConnectPlan,
  ToolConnectResult
} from '@shared/types'
import type { Logger } from '../core/logger'
import type { DiscoveryService } from './discovery'
import type { AiService, ConnectDesign } from './ai'
import type { PluginService } from './plugins'
import type { SettingsService } from './settings'
import type { ProjectService } from './projects'
import { AppError } from '../core/errors'
import { findNpmLauncher } from '../core/npm'
import { assertInside, ensureDir, sanitizeSegment, uniquePath } from '../core/fs-guard'

export interface Evidence {
  fullName: string
  repoName: string
  description: string
  readme: string
  sourceDir: string
  files: string[]
  packageJsonText: string
  packageJson: PackageJson | null
  findings: IntegrationFinding[]
  runtime: IntegrationReport['runtime']
  bin: string | null
  scripts: string[]
  riskLevel: IntegrationReport['riskLevel']
}

interface CachedInspection {
  report: IntegrationReport
  evidence: Evidence
  plan: ToolConnectPlan
  slug: string
}

const MAX_ZIP_BYTES = 80 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024
const MAX_FILES = 5000
const ALLOWED_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', '0BSD', 'CC0-1.0', 'Unlicense'])
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']
const PACKAGE_NAME = /^(?:@[\w.-]+\/)?[\w.-]+(?:@[0-9][\w.+-]*)?$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/
const ENTRY_EXT = /\.(?:m|c)?js$/

const STRATEGY_TITLES: Record<ConnectStrategy, string> = {
  'local-node': 'اجرای محلی با Node داخلی برنامه',
  'npm-package': 'اجرای بستهٔ npm با npx',
  'local-python': 'اجرای اسکریپت پایتون',
  'static-project': 'افزودن به‌عنوان پروژهٔ قابل ویرایش',
  manual: 'اتصال دستی'
}

export class IntegrationService {
  private readonly discovery: DiscoveryService
  private readonly ai: AiService
  private readonly plugins: PluginService
  private readonly projects: ProjectService
  private readonly settings: SettingsService
  private readonly logger: Logger
  private readonly paths: () => { tempDir: string; pluginsDir: string }
  private readonly cache = new Map<string, CachedInspection>()

  constructor(
    discovery: DiscoveryService,
    ai: AiService,
    plugins: PluginService,
    projects: ProjectService,
    settings: SettingsService,
    logger: Logger,
    paths: () => { tempDir: string; pluginsDir: string }
  ) {
    this.discovery = discovery
    this.ai = ai
    this.plugins = plugins
    this.projects = projects
    this.settings = settings
    this.logger = logger
    this.paths = paths
  }

  async inspect(fullName: string): Promise<IntegrationReport> {
    const repo = await this.discovery.repo(fullName)
    const findings: IntegrationFinding[] = []
    if (repo.archived) findings.push({ severity: 'critical', message: 'مخزن آرشیو شده است.' })
    if (!repo.license) findings.push({ severity: 'critical', message: 'مجوز مشخصی ندارد.' })
    else if (!ALLOWED_LICENSES.has(repo.license)) {
      findings.push({ severity: 'warning', message: `مجوز ${repo.license} برای استفادهٔ مجدد محدودیت دارد.` })
    }
    const ageDays = Math.round((Date.now() - new Date(repo.pushedAt).getTime()) / 86_400_000)
    if (ageDays > 540) findings.push({ severity: 'warning', message: `آخرین فعالیت ${ageDays} روز پیش بوده است.` })
    if (repo.sizeKb > 80_000) findings.push({ severity: 'warning', message: 'حجم مخزن بالاست؛ ممکن است شامل فایل‌های غیرضروری باشد.' })

    const workDir = path.join(this.paths().tempDir, 'webforge-integration', hash(fullName))
    const sourceDir = path.join(workDir, 'source')
    const packageJsonText = await this.downloadRepository(repo.fullName, repo.defaultBranch, sourceDir, findings)
    const packageJson = parsePackageJson(packageJsonText)
    const files = listFiles(sourceDir)
    const fileCount = files.length
    if (fileCount > MAX_FILES) findings.push({ severity: 'critical', message: `تعداد فایل‌ها (${fileCount}) از سقف مجاز بیشتر است.` })
    this.staticScan(sourceDir, files, packageJson, findings)

    const bin = detectBin(packageJson)
    const scripts = Object.keys(packageJson?.scripts ?? {})
    const installHooks = scripts.filter((name) => INSTALL_HOOKS.includes(name))
    if (installHooks.length > 0) {
      findings.push({
        severity: 'warning',
        message: `اسکریپت‌های نصب وجود دارد (${installHooks.join(', ')}). نصب با --ignore-scripts انجام می‌شود.`
      })
    }
    if (packageJson && packageJson.dependencies && Object.keys(packageJson.dependencies).length > 80) {
      findings.push({ severity: 'warning', message: 'تعداد وابستگی‌ها بالاست.' })
    }

    const runtime = detectRuntime(packageJson, files)
    const critical = findings.filter((finding) => finding.severity === 'critical').length
    const warnings = findings.filter((finding) => finding.severity === 'warning').length

    let aiVerdict: ToolAiVerdict | null = null
    if (this.settings.hasApiKey()) {
      try {
        aiVerdict = await this.ai.auditTool({
          fullName: repo.fullName,
          description: repo.description,
          license: repo.license,
          stars: repo.stars,
          readme: repo.readme,
          packageJson: packageJsonText,
          fileList: files,
          findings: findings.map((finding) => `[${finding.severity}] ${finding.message}`)
        })
        for (const warning of aiVerdict.warnings.slice(0, 8)) {
          findings.push({ severity: 'warning', message: `AI: ${warning}` })
        }
        if (aiVerdict.verdict === 'unsafe') findings.push({ severity: 'critical', message: `AI: ${aiVerdict.summary}` })
      } catch (error) {
        this.logger.warn('INTEGRATION_AI_SKIPPED', 'بررسی AI انجام نشد.', {
          fullName,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const riskLevel: IntegrationReport['riskLevel'] =
      critical > 0 ? 'high' : warnings > 0 || repo.risk.level === 'high' ? 'medium' : 'low'
    const evidence: Evidence = {
      fullName: repo.fullName,
      repoName: repo.name,
      description: repo.description,
      readme: repo.readme,
      sourceDir,
      files,
      packageJsonText,
      packageJson,
      findings,
      runtime,
      bin,
      scripts,
      riskLevel
    }

    const plan = await this.designPlan(evidence, aiVerdict)
    const runnable = plan.strategy !== 'manual'
    let reason = plan.rationale
    if (critical > 0) reason = 'یافتهٔ بحرانی وجود دارد؛ برای ادغام، تأیید صریح لازم است.'
    if (repo.license === null) reason = 'بدون مجوز مشخص؛ برای ادغام، تأیید صریح لازم است.'

    const manifest = plan.actionable && plan.strategy !== 'static-project' ? this.buildManifest(evidence, plan) : null
    const report: IntegrationReport = {
      fullName: repo.fullName,
      repoUrl: repo.htmlUrl,
      license: repo.license,
      stars: repo.stars,
      riskLevel: critical > 0 ? 'high' : riskLevel,
      ai: aiVerdict,
      runtime,
      installable: runnable,
      reason,
      packageName: packageJson?.name ?? null,
      bin: bin ?? null,
      scripts,
      fileCount,
      sizeKb: repo.sizeKb,
      findings: dedupe(findings),
      proposedManifest: manifest,
      usage: planDemoUsage(plan),
      connect: plan
    }
    this.cache.set(fullName, { report, evidence, plan, slug: sanitizeSegment(repo.name, 'tool') })
    this.logger.info('INTEGRATION_INSPECTED', 'ریپو بازرسی شد.', {
      fullName,
      riskLevel: report.riskLevel,
      strategy: plan.strategy,
      ai: plan.usedAi
    })
    return report
  }

  /** Performs the plan: registers a plugin, or imports the repo as an editable project. */
  async connect(
    fullName: string,
    options: { force: boolean; installDependencies: boolean }
  ): Promise<ToolConnectResult> {
    let cached = this.cache.get(fullName)
    if (!cached) {
      await this.inspect(fullName)
      cached = this.cache.get(fullName)
    }
    if (!cached) throw new AppError('INTEGRATION_MISSING', 'نتیجهٔ بازرسی پیدا نشد؛ دوباره بازرسی کن.')
    const { report, evidence, plan, slug } = cached
    if (!plan.actionable) throw new AppError('INTEGRATION_NOT_CONNECTABLE', plan.rationale || 'این ابزار به‌صورت خودکار قابل اتصال نیست.')
    if (plan.strategy === 'npm-package' && !findNpmLauncher('npx')) {
      throw new AppError('NPM_NOT_FOUND', 'برای اجرای ابزارهای npm به Node و npm روی این سیستم نیاز است.')
    }
    if (!options.force && report.riskLevel === 'high') {
      throw new AppError('INTEGRATION_BLOCKED', 'ریسک این ابزار بالاست. برای ادامه، تأیید صریح لازم است.')
    }
    if (!fs.existsSync(evidence.sourceDir)) {
      throw new AppError('INTEGRATION_EXPIRED', 'فایل‌های موقت بازرسی پاک شده‌اند؛ دوباره بازرسی کن.')
    }
    return plan.strategy === 'static-project'
      ? this.connectAsProject(evidence, plan, report, slug)
      : this.connectAsPlugin(evidence, plan, report, slug, options.installDependencies)
  }

  private async connectAsPlugin(
    evidence: Evidence,
    plan: ToolConnectPlan,
    report: IntegrationReport,
    slug: string,
    installDependencies: boolean
  ): Promise<ToolConnectResult> {
    const manifest = this.buildManifest(evidence, plan)
    const installedRoot = path.join(this.paths().pluginsDir, 'installed')
    ensureDir(installedRoot)
    const target = uniquePath(path.join(installedRoot, slug))
    ensureDir(target)
    const logs: string[] = [`اتصال با راهبرد ${STRATEGY_TITLES[plan.strategy]}.`]
    if (plan.strategy !== 'npm-package') {
      await copyTree(evidence.sourceDir, target, 0)
      logs.push('فایل‌های منبع در پوشهٔ ابزار کپی شد.')
    } else {
      fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ private: true, name: slug, version: '1.0.0' }, null, 2), 'utf8')
      logs.push('بسته در اولین اجرا با npx از registry دریافت می‌شود.')
    }

    let manifestName = manifest.name
    const existing = this.plugins.list().find((plugin) => plugin.name === manifestName)
    if (existing) manifestName = `${manifestName.slice(0, 70)}-${hash(evidence.fullName).slice(0, 6)}`
    const finalManifest: PluginManifest = { ...manifest, name: manifestName }
    fs.writeFileSync(path.join(target, 'plugin.manifest.json'), JSON.stringify(finalManifest, null, 2), 'utf8')
    fs.writeFileSync(path.join(target, 'INTEGRATION.md'), this.integrationDoc(report, plan, evidence), 'utf8')
    const plugin = await this.plugins.addFromPath(target)
    logs.push(`ابزار «${plugin.displayName}» در فهرست ابزارها ثبت شد.`)

    if (installDependencies && plan.needsDependencies && plan.strategy === 'local-node') {
      try {
        const deps = await this.plugins.installDependencies(plugin.id)
        logs.push(deps.ok ? 'وابستگی‌های npm با --ignore-scripts نصب شد.' : `نصب وابستگی ناموفق بود (کد ${deps.exitCode}).`)
        if (!deps.ok) logs.push(deps.logs.slice(-1500))
      } catch (error) {
        logs.push(`نصب وابستگی انجام نشد: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else if (plan.needsDependencies && plan.strategy === 'local-node') {
      logs.push('وابستگی‌ها نصب نشده‌اند؛ از صفحهٔ ابزارها «نصب وابستگی» را بزن.')
    }

    this.logger.info('INTEGRATION_CONNECTED', 'ابزار به فضای کاری متصل شد.', {
      fullName: evidence.fullName,
      pluginId: plugin.id,
      strategy: plan.strategy
    })
    return { strategy: plan.strategy, report, plugin, project: null, installedTo: target, logs }
  }

  private async connectAsProject(
    evidence: Evidence,
    plan: ToolConnectPlan,
    report: IntegrationReport,
    slug: string
  ): Promise<ToolConnectResult> {
    const root = path.join(this.settings.get().projectsDir, 'from-github')
    ensureDir(root)
    const target = uniquePath(path.join(root, sanitizeSegment(slug, 'tool')))
    ensureDir(target)
    await copyTree(evidence.sourceDir, target, 0)
    fs.writeFileSync(path.join(target, 'FROM-GITHUB.md'), this.integrationDoc(report, plan, evidence), 'utf8')
    const project: Project = this.projects.register({
      name: `${evidence.repoName} (GitHub)`.slice(0, 120),
      dir: target,
      type: 'static',
      status: 'ready'
    })
    this.logger.info('INTEGRATION_PROJECT_IMPORTED', 'مخزن وب‌سایت به پروژهٔ قابل ویرایش تبدیل شد.', {
      fullName: evidence.fullName,
      projectId: project.id
    })
    return {
      strategy: 'static-project',
      report,
      plugin: null,
      project,
      installedTo: target,
      logs: [
        'فایل‌های سایت در پوشهٔ پروژه‌ها کپی شد.',
        `پروژهٔ «${project.name}» ساخته شد؛ در ویرایشگر بصری می‌توانی همهٔ بخش‌هایش را تغییر بدهی.`,
        `مسیر: ${target}`
      ]
    }
  }

  private integrationDoc(report: IntegrationReport, plan: ToolConnectPlan, evidence: Evidence): string {
    return [
      `# ${evidence.repoName}`,
      '',
      `منبع: ${report.repoUrl}`,
      `مجوز: ${report.license ?? 'نامشخص'}`,
      `ریسک: ${report.riskLevel}`,
      `راهبرد اتصال: ${STRATEGY_TITLES[plan.strategy]}${plan.usedAi ? ' (با تصمیم هوش مصنوعی)' : ' (تشخیص خودکار)'}`,
      '',
      '## حکم بازرسی',
      report.ai?.summary ?? plan.rationale,
      '',
      '## مراحل انجام‌شده',
      ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
      '',
      '## استفاده',
      plan.demoArguments ? ` آرگومان نمونه: \`${plan.demoArguments}\`` : 'آرگومانی لازم ندارد.',
      ...plan.inputs.map((input) => `- ${input.label} (${input.key})${input.required ? ' — الزامی' : ''}`),
      '',
      '## هشدارها',
      ...report.findings.map((finding) => `- [${finding.severity}] ${finding.message}`),
      '',
      '> این ابزار در همان کاربر اجرا می‌شود. برای ابزارهای ناشناس از VM جدا استفاده کن.'
    ].join('\n')
  }

  private buildManifest(evidence: Evidence, plan: ToolConnectPlan): PluginManifest {
    const base = sanitizeSegment(evidence.repoName.toLowerCase(), 'tool').replace(/[^a-z0-9-_.]/g, '-')
    return {
      name: base.slice(0, 80),
      displayName: evidence.repoName.slice(0, 100),
      description: `${evidence.description || STRATEGY_TITLES[plan.strategy]}`.slice(0, 2000),
      version: evidence.packageJson?.version ?? '1.0.0',
      runtime: plan.strategy === 'npm-package' ? 'executable' : plan.strategy === 'local-python' ? 'python' : 'node',
      command: plan.command,
      args: plan.args,
      cwd: '.',
      inputs: plan.inputs,
      outputs: plan.outputs,
      permissions: plan.permissions,
      timeoutSeconds: plan.timeoutSeconds,
      icon: plan.strategy === 'static-project' ? 'globe' : 'terminal'
    }
  }

  /** AI plan when available and trustworthy, deterministic heuristics otherwise. */
  private async designPlan(evidence: Evidence, aiVerdict: ToolAiVerdict | null): Promise<ToolConnectPlan> {
    if (this.settings.hasApiKey()) {
      try {
        const design = await this.ai.designConnect({
          fullName: evidence.fullName,
          description: evidence.description,
          readme: evidence.readme,
          packageJson: evidence.packageJsonText,
          fileList: evidence.files,
          findings: evidence.findings.map((finding) => `[${finding.severity}] ${finding.message}${finding.file ? ` (${finding.file})` : ''}`),
          detectedRuntime: evidence.runtime,
          detectedBin: evidence.bin,
          scripts: evidence.scripts
        })
        const plan = this.normalizePlan(design, evidence)
        if (plan) return plan
        evidence.findings.push({ severity: 'info', message: 'طرح هوش مصنوعی با فایل‌های مخزن جور نشد؛ از تشخیص خودکار استفاده شد.' })
      } catch (error) {
        this.logger.warn('INTEGRATION_CONNECT_AI_SKIPPED', 'طرح اتصال هوش مصنوعی ناموفق بود.', {
          fullName: evidence.fullName,
          error: error instanceof Error ? error.message : String(error)
        })
        evidence.findings.push({ severity: 'info', message: 'طرح اتصال هوش مصنوعی به نتیجه نرسید؛ تشخیص خودکار اعمال شد.' })
      }
    }
    return this.heuristicPlan(evidence, aiVerdict)
  }

  /** Cross-checks every AI claim against the real files before trusting it. */
  normalizePlan(design: ConnectDesign, evidence: Evidence): ToolConnectPlan | null {
    const safeInputs = dedupeInputs(design.inputs)
    const base: Omit<ToolConnectPlan, 'strategy' | 'actionable' | 'command' | 'entry' | 'args'> = {
      title: STRATEGY_TITLES[design.strategy],
      inputs: toPluginInputs(safeInputs),
      outputs: toPluginOutputs(design.outputs),
      permissions: {
        network: design.permissions.network,
        projectWrite: design.permissions.projectWrite,
        environment: design.permissions.environment.filter((name) => ENV_NAME.test(name))
      },
      timeoutSeconds: design.timeoutSeconds,
      needsDependencies: design.needsDependencies,
      demoArguments: design.demoArguments.slice(0, 500),
      rationale: design.rationale.slice(0, 1500) || STRATEGY_TITLES[design.strategy],
      steps: design.steps.length > 0 ? design.steps.slice(0, 8) : [STRATEGY_TITLES[design.strategy]],
      confidence: design.confidence,
      usedAi: true
    }

    switch (design.strategy) {
      case 'local-node': {
        const entry = this.resolveSourceEntry(design.entry, evidence) ?? this.resolveSourceEntry(evidence.bin, evidence)
        if (!entry) return null
        return {
          ...base,
          strategy: 'local-node',
          actionable: true,
          command: entry,
          entry,
          args: commandArgs(safeInputs)
        }
      }
      case 'npm-package': {
        const name = (design.entry ?? evidence.packageJson?.name ?? '').trim()
        if (!PACKAGE_NAME.test(name)) return null
        return {
          ...base,
          strategy: 'npm-package',
          actionable: true,
          command: 'npx',
          entry: name,
          args: ['--yes', packageSpecifier(name), ...commandArgs(safeInputs)],
          permissions: { ...base.permissions, network: true }
        }
      }
      case 'local-python': {
        const entry = this.resolveSourceEntry(design.entry, evidence, /\.py$/i)
        if (!entry) return null
        return { ...base, strategy: 'local-python', actionable: true, command: entry, entry, args: commandArgs(safeInputs) }
      }
      case 'static-project': {
        const entry = this.resolveSourceEntry(design.entry ?? 'index.html', evidence, /\.(?:html?|md)$/i, true)
        if (!entry) return null
        return {
          ...base,
          strategy: 'static-project',
          actionable: true,
          command: '',
          entry,
          args: [],
          inputs: [],
          outputs: [],
          needsDependencies: false,
          steps: design.steps.length
            ? design.steps
            : ['فایل‌های سایت در پوشهٔ پروژه‌ها کپی می‌شود.', 'پروژه در فهرست پروژه‌ها ثبت می‌شود.', 'با ویرایشگر بصری می‌توانی متن، عکس و استایل هر بخش را تغییر بدهی.']
        }
      }
      case 'manual':
        return { ...base, strategy: 'manual', actionable: false, command: '', entry: design.entry ?? null, args: [], inputs: [], outputs: [] }
      default:
        return null
    }
  }

  private resolveSourceEntry(
    candidate: string | null | undefined,
    evidence: Evidence,
    extension: RegExp = ENTRY_EXT,
    allowDirectory = false
  ): string | null {
    if (!candidate) return null
    const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
    if (!normalized || normalized.includes('..')) return null
    if (!extension.test(normalized) && !allowDirectory) return null
    try {
      const full = assertInside(evidence.sourceDir, path.join(evidence.sourceDir, normalized))
      const stat = fs.statSync(full)
      if (stat.isFile()) return normalized
      if (allowDirectory && stat.isDirectory()) return normalized
    } catch {
      return null
    }
    return null
  }

  heuristicPlan(evidence: Evidence, aiVerdict: ToolAiVerdict | null): ToolConnectPlan {
    const binEntry = this.resolveSourceEntry(evidence.bin, evidence)
    const packageName = evidence.packageJson?.name ?? null
    const hasDependencies = Object.keys(evidence.packageJson?.dependencies ?? {}).length > 0
    const singlePy = evidence.files.filter((file) => /\.py$/i.test(file))
    const rootPy =
      evidence.files.find((file) => /(^|\/)(cli|__main__|main|app|manage)\.py$/i.test(file)) ??
      (singlePy.length === 1 ? singlePy[0] : undefined)
    const siteIndex = evidence.files.find((file) => /(^|\/)index\.html?$/i.test(file))
    const usage = aiVerdict?.usage ?? ''

    const build = (
      strategy: ConnectStrategy,
      extra: Partial<ToolConnectPlan> & { command: string; entry: string | null; rationale: string }
    ): ToolConnectPlan => ({
      strategy,
      actionable: strategy !== 'manual',
      title: STRATEGY_TITLES[strategy],
      args: [],
      inputs: genericInputs(),
      outputs: [],
      permissions: { network: strategy === 'npm-package', projectWrite: true, environment: [] },
      timeoutSeconds: 600,
      needsDependencies: false,
      demoArguments: '--help',
      steps: [STRATEGY_TITLES[strategy]],
      confidence: 0.45,
      usedAi: false,
      ...extra
    })

    if (evidence.runtime === 'node' && binEntry) {
      return build('local-node', {
        command: binEntry,
        entry: binEntry,
        needsDependencies: hasDependencies,
        args: commandArgs([]),
        rationale: `ابزار Node با entry «${binEntry}»؛ با Node داخلیٔ برنامه اجرا می‌شود${hasDependencies ? ' و وابستگی‌هایش نصب می‌شود' : ''}.`,
        steps: [
          'فایل‌های مخزن در پوشهٔ ابزارها کپی می‌شود.',
          hasDependencies ? 'وابستگی‌ها با npm install --ignore-scripts نصب می‌شود.' : 'وابستگی اضافه‌ای لازم نیست.',
          `اجرا با: node ${binEntry} <آرگومان‌ها>`,
          usage ? `نحوهٔ استفاده از README: ${usage.slice(0, 200)}` : 'برای دیدن گزینه‌ها اول --help را اجرا کن.'
        ]
      })
    }
    if (evidence.runtime === 'node' && packageName) {
      return build('npm-package', {
        command: 'npx',
        entry: packageName,
        args: ['--yes', packageName, ...commandArgs([])],
        permissions: { network: true, projectWrite: true, environment: [] },
        rationale: `فایل قابل اجرا در مخزن نیست (احتمالاً در build تولید می‌شود)، اما بستهٔ منتشرشدهٔ «${packageName}» با npx اجرا می‌شود.`,
        steps: [
          'دستور با npx و گزینهٔ --yes اجرا می‌شود.',
          'بسته در اولین اجرا از registry دانلود می‌شود؛ اینترنت لازم است.',
          'خروجی در پوشهٔ پروژهٔ فعال نوشته می‌شود.'
        ]
      })
    }
    if (evidence.runtime === 'python' && rootPy) {
      return build('local-python', {
        command: rootPy,
        entry: rootPy,
        inputs: genericInputs(),
        args: commandArgs([]),
        rationale: `اسکریپت پایتون «${rootPy}» با مفسر سیستم اجرا می‌شود.`,
        steps: [
          'فایل‌های مخزن کپی می‌شود.',
          'اگر requirements.txt دارد، اول آن را با pip نصب کن (این کار به دلیل امنیت، خودکار انجام نمی‌شود).',
          `اجرا با: python ${rootPy} <آرگومان‌ها>`
        ]
      })
    }
    if (siteIndex) {
      return build('static-project', {
        command: '',
        entry: siteIndex,
        inputs: [],
        outputs: [],
        demoArguments: '',
        rationale: 'این مخزن یک سایت/قالب استاتیک است؛ به‌جای ابزار، مستقیم به پروژهٔ قابل ویرایش تبدیلش می‌کنم.',
        steps: [
          'فایل‌های سایت به پوشهٔ پروژه‌ها کپی می‌شود.',
          'پروژه در فهرست پروژه‌ها ثبت می‌شود.',
          'در ویرایشگر بصری می‌توانی متن، تصویر، استایل و ساختار هر بخش را تغییر بدهی.'
        ]
      })
    }
    return build('manual', {
      command: '',
      entry: evidence.bin ?? null,
      inputs: [],
      demoArguments: '',
      rationale: `راهبرد اتصال خودکاری برای این مخزن پیدا نشد (نوع: ${evidence.runtime}). بر اساس README عمل کن.`,
      steps: [
        'README مخزن را بخوان و ابزار را دستی نصب کن.',
        'بعد از نصب، از صفحهٔ «ابزارها» یک manifest بساز و دستور اجرایی‌اش را وارد کن.',
        'در manifest می‌توانی از {{projectPath}} و آرگومان‌های دلخواه استفاده کنی.'
      ]
    })
  }
  private async downloadRepository(
    fullName: string,
    branch: string,
    sourceDir: string,
    findings: IntegrationFinding[]
  ): Promise<string> {
    const workDir = path.dirname(sourceDir)
    await fsp.rm(workDir, { recursive: true, force: true })
    ensureDir(workDir)
    const zipPath = path.join(workDir, 'repo.zip')
    const url = `https://codeload.github.com/${fullName}/zip/refs/heads/${encodeURIComponent(branch)}`
    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { 'User-Agent': 'WebForgeStudio/1.0' } })
    } catch {
      throw new AppError('REPO_DOWNLOAD_FAILED', 'دانلود مخزن از GitHub ناموفق بود.', 502)
    }
    if (!response.ok) throw new AppError('REPO_DOWNLOAD_FAILED', `GitHub با کد ${response.status} پاسخ داد.`, 502)
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_ZIP_BYTES) throw new AppError('REPO_TOO_LARGE', 'حجم مخزن برای بازرسی خودکار بیش از حد مجاز است.')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_ZIP_BYTES) throw new AppError('REPO_TOO_LARGE', 'حجم مخزن برای بازرسی خودکار بیش از حد مجاز است.')
    fs.writeFileSync(zipPath, buffer)
    let zip: AdmZip
    try {
      zip = new AdmZip(zipPath)
    } catch {
      throw new AppError('REPO_INVALID_ZIP', 'فایل دریافتی یک ZIP معتبر نیست.', 502)
    }
    const entries = zip.getEntries()
    let total = 0
    let count = 0
    for (const entry of entries) {
      const name = entry.entryName.replace(/\\/g, '/')
      if (name.includes('..') || name.startsWith('/')) {
        throw new AppError('REPO_UNSAFE_ZIP', 'آرشیو شامل مسیر ناامن است.')
      }
      total += entry.header.size
      count += 1
      if (total > MAX_EXTRACTED_BYTES) throw new AppError('REPO_TOO_LARGE', 'حجم استخراج‌شدهٔ مخزن بیش از حد مجاز است.')
      if (count > MAX_FILES * 2) throw new AppError('REPO_TOO_MANY_FILES', 'تعداد فایل‌های مخزن بیش از حد مجاز است.')
    }
    ensureDir(sourceDir)
    const rootSegment = entries[0]?.entryName.split('/')[0] ?? ''
    for (const entry of entries) {
      if (entry.isDirectory) continue
      const clean = entry.entryName.replace(/\\/g, '/')
      const relative = rootSegment && clean.startsWith(`${rootSegment}/`) ? clean.slice(rootSegment.length + 1) : clean
      if (!relative) continue
      if (relative.startsWith('.git/')) continue
      const target = path.join(sourceDir, relative)
      if (!target.startsWith(sourceDir + path.sep)) continue
      ensureDir(path.dirname(target))
      fs.writeFileSync(target, entry.getData())
    }
    findings.push({ severity: 'info', message: `${entries.length} ورودی ZIP بازرسی شد.` })
    const packagePath = path.join(sourceDir, 'package.json')
    if (fs.existsSync(packagePath)) return fs.readFileSync(packagePath, 'utf8')
    try {
      const raw = await fetch(`https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(branch)}/package.json`, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'WebForgeStudio/1.0' }
      })
      return raw.ok ? await raw.text() : ''
    } catch {
      return ''
    }
  }

  private staticScan(
    root: string,
    files: string[],
    packageJson: PackageJson | null,
    findings: IntegrationFinding[]
  ): void {
    const scripts = packageJson?.scripts ?? {}
    for (const name of INSTALL_HOOKS) {
      if (scripts[name]) findings.push({ severity: 'warning', message: `اسکریپت ${name}: ${scripts[name].slice(0, 160)}` })
    }
    const suspicious: Array<[RegExp, string]> = [
      [/child_process|execSync|spawnSync/, 'فراخوانی پردازهٔ سیستمی'],
      [/\beval\s*\(|new Function\s*\(/, 'اجرای کد پویا'],
      [/curl[^\n|]*\|\s*(sh|bash)|wget[^\n|]*\|\s*(sh|bash)/, 'دانلود و اجرای اسکریپت از شبکه'],
      [/powershell[^\n]*-enc/, 'PowerShell رمزگذاری‌شده'],
      [/rm\s+-rf\s+\/(?!\w)/, 'دستور حذف مخرب'],
      [/process\.env\.(AWS_|GITHUB_|NPM_TOKEN|OPENAI|DEEPSEEK)/, 'خواندن مستقیم secret از محیط']
    ]
    const binaryExt = /\.(exe|dll|so|dylib|bin|msi|bat|cmd|ps1)$/i
    let scanned = 0
    for (const file of files) {
      if (scanned >= 800) break
      const full = path.join(root, file)
      if (binaryExt.test(file)) {
        findings.push({ severity: 'warning', message: 'فایل اجرایی/اسکریپت در مخزن وجود دارد.', file })
        continue
      }
      if (!/\.(js|mjs|cjs|ts|tsx|jsx|py|sh|ps1)$/i.test(file)) continue
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.size > 400_000) {
        findings.push({ severity: 'warning', message: 'فایل کد بزرگ است؛ ممکن است مبهم‌سازی شده باشد.', file })
        continue
      }
      scanned += 1
      let content = ''
      try {
        content = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      for (const [pattern, label] of suspicious) {
        if (pattern.test(content)) findings.push({ severity: 'warning', message: label, file })
      }
      const longest = content.split('\n').reduce((max, line) => Math.max(max, line.length), 0)
      if (longest > 4000) findings.push({ severity: 'warning', message: 'خط بسیار طولانی (نشانهٔ مبهم‌سازی).', file })
    }
    if (scanned === 0) findings.push({ severity: 'info', message: 'فایل کد قابل اسکن پیدا نشد.' })
  }
}

function genericInputs(): PluginInput[] {
  return [
    {
      key: 'arguments',
      label: 'آرگومان‌های خط فرمان',
      type: 'text',
      required: false,
      placeholder: '--help',
      help: 'گزینه‌ها را همین‌جا بنویس؛ هر گزینه با فاصله جدا می‌شود.'
    }
  ]
}

function dedupeInputs(inputs: ConnectDesign['inputs']): ConnectDesign['inputs'] {
  const seen = new Set<string>()
  return inputs.filter((input) => {
    if (seen.has(input.key) || input.key === 'arguments' || input.key === 'projectPath') return false
    seen.add(input.key)
    return true
  })
}

function toPluginInputs(inputs: ConnectDesign['inputs']): PluginInput[] {
  const list: PluginInput[] = inputs.map((input) => ({
    key: input.key,
    label: input.label,
    type: input.type === 'select' ? 'select' : input.type,
    required: input.required,
    default: input.default,
    options: input.options?.map((value) => ({ label: value, value })),
    placeholder: input.placeholder,
    help: input.help
  }))
  list.push({
    key: 'arguments',
    label: 'آرگومان‌های اضافه',
    type: 'text',
    required: false,
    placeholder: '--verbose',
    help: 'هر گزینهٔ دیگری که نیاز داری اینجا بنویس؛ در پایان دستور اضافه می‌شود.'
  })
  return list
}

function toPluginOutputs(outputs: ConnectDesign['outputs']): PluginOutput[] {
  return outputs.map((output) => ({
    key: output.key,
    label: output.label || output.key,
    type: output.type,
    path: output.path.replace(/\\/g, '/').replace(/^\/+/, '')
  }))
}

/**
 * Builds the argv template. Booleans become conditional flags and optional
 * `--key=value` pairs are dropped when empty, so a half-filled form still
 * produces a command the tool accepts.
 */
function commandArgs(inputs: ConnectDesign['inputs']): string[] {
  const args: string[] = []
  for (const input of inputs) {
    const flag = (input.flag ?? '').trim()
    if (input.type === 'boolean') {
      if (flag) args.push(`?{{${input.key}}}:${flag}`)
      continue
    }
    if (!flag || input.argStyle === 'positional') {
      args.push(`{{${input.key}}}`)
      continue
    }
    if (input.argStyle === 'value') args.push(flag, `{{${input.key}}}`)
    else args.push(`${flag}={{${input.key}}}`)
  }
  args.push('{{arguments}}')
  return args
}

/** `pkg@2.1.0` -> `pkg@2.1.0`, `pkg` -> `pkg`; scopes keep their first segment. */
function packageSpecifier(name: string): string {
  const at = name.lastIndexOf('@')
  if (at <= 0) return name
  return name.slice(0, at)
}

function planDemoUsage(plan: ToolConnectPlan): string {  if (plan.strategy === 'manual') return ''
  if (plan.strategy === 'static-project') return 'پروژهٔ استاتیک در ویرایشگر بصری'
  const head = plan.strategy === 'npm-package' ? `npx ${plan.entry ?? ''}` : `${plan.strategy === 'local-python' ? 'python' : 'node'} ${plan.entry ?? ''}`
  return `${head} ${plan.demoArguments}`.trim()
}

interface PackageJson {
  name?: string
  version?: string
  description?: string
  bin?: string | Record<string, string>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function parsePackageJson(text: string): PackageJson | null {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as PackageJson
  } catch {
    return null
  }
}

export function detectBin(pkg: PackageJson | null): string | null {
  if (!pkg?.bin) return null
  if (typeof pkg.bin === 'string') return pkg.bin
  const values = Object.values(pkg.bin).filter(Boolean)
  return values[0] ?? null
}

export function detectRuntime(pkg: PackageJson | null, files: string[]): IntegrationReport['runtime'] {
  if (pkg?.bin) return 'node'
  if (files.some((file) => /(^|\/)(pyproject\.toml|setup\.py)$/.test(file))) return 'python'
  if (files.some((file) => /\.(exe|msi)$/i.test(file))) return 'binary'
  if (pkg || files.some((file) => /(^|\/)(index\.html|next\.config|vite\.config)/.test(file))) return 'web'
  return 'unknown'
}

function listFiles(root: string, max = MAX_FILES): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    if (files.length >= max) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= max) return
      if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) continue
    if (/^\.(npmrc|yarnrc)/i.test(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(root)
  return files
}

async function copyTree(source: string, target: string, depth: number): Promise<void> {
  if (depth > 12) return
  for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) continue
    if (/^\.(npmrc|yarnrc)/i.test(entry.name)) continue
    // Following a link would copy files that were never part of the inspected repo.
    if (entry.isSymbolicLink()) continue
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) {
      ensureDir(to)
      await copyTree(from, to, depth + 1)
    } else {
      const stat = await fsp.stat(from)
      if (stat.size > 20 * 1024 * 1024) continue
      await fsp.copyFile(from, to)
    }
  }
}

function dedupe(findings: IntegrationFinding[]): IntegrationFinding[] {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = `${finding.severity}|${finding.message}|${finding.file ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
