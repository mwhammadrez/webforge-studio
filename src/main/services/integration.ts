import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import type {
  IntegrationFinding,
  IntegrationInstallResult,
  IntegrationReport,
  PluginManifest,
  ToolAiVerdict
} from '@shared/types'
import type { Logger } from '../core/logger'
import type { DiscoveryService } from './discovery'
import type { AiService } from './ai'
import type { PluginService } from './plugins'
import type { SettingsService } from './settings'
import { AppError } from '../core/errors'
import { ensureDir, sanitizeSegment, uniquePath } from '../core/fs-guard'

interface CachedInspection {
  report: IntegrationReport
  sourceDir: string
  manifest: PluginManifest | null
  slug: string
}

const MAX_ZIP_BYTES = 80 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024
const MAX_FILES = 5000
const ALLOWED_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', '0BSD', 'CC0-1.0', 'Unlicense'])
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']

export class IntegrationService {
  private readonly discovery: DiscoveryService
  private readonly ai: AiService
  private readonly plugins: PluginService
  private readonly settings: SettingsService
  private readonly logger: Logger
  private readonly paths: () => { tempDir: string; pluginsDir: string }
  private readonly cache = new Map<string, CachedInspection>()

  constructor(
    discovery: DiscoveryService,
    ai: AiService,
    plugins: PluginService,
    settings: SettingsService,
    logger: Logger,
    paths: () => { tempDir: string; pluginsDir: string }
  ) {
    this.discovery = discovery
    this.ai = ai
    this.plugins = plugins
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
    const runnable = runtime === 'node' && Boolean(bin) && fileCount <= MAX_FILES
    const installable = runnable
    let reason = runnable
      ? 'این مخزن یک ابزار Node با entry قابل اجراست.'
      : runtime === 'node'
        ? 'entry قابل اجرا (bin) در package.json پیدا نشد؛ احتمالاً یک اپ/سایت است نه ابزار CLI.'
        : runtime === 'web'
          ? 'این مخزن یک اپ یا سایت است، نه ابزار خط فرمان.'
          : `runtime «${runtime}» در این نسخه به‌صورت خودکار قابل ادغام نیست.`
    if (critical > 0) reason = 'یافتهٔ بحرانی وجود دارد؛ برای ادغام، تأیید صریح لازم است.'
    if (repo.license === null) reason = 'بدون مجوز مشخص؛ برای ادغام، تأیید صریح لازم است.'

    const manifest = runnable
      ? buildManifest(repo.fullName, repo.name, repo.description, packageJson?.version ?? '1.0.0', aiVerdict)
      : null
    const report: IntegrationReport = {
      fullName: repo.fullName,
      repoUrl: repo.htmlUrl,
      license: repo.license,
      stars: repo.stars,
      riskLevel: critical > 0 ? 'high' : riskLevel,
      ai: aiVerdict,
      runtime,
      installable,
      reason,
      packageName: packageJson?.name ?? null,
      bin: bin ?? null,
      scripts,
      fileCount,
      sizeKb: repo.sizeKb,
      findings: dedupe(findings),
      proposedManifest: manifest,
      usage: aiVerdict?.usage || (bin ? `node ${bin}` : '')
    }
    this.cache.set(fullName, { report, sourceDir, manifest, slug: sanitizeSegment(repo.name, 'tool') })
    this.logger.info('INTEGRATION_INSPECTED', 'ریپو بازرسی شد.', {
      fullName,
      riskLevel: report.riskLevel,
      installable,
      ai: Boolean(aiVerdict)
    })
    return report
  }

  async install(fullName: string, force: boolean): Promise<IntegrationInstallResult> {
    let cached = this.cache.get(fullName)
    if (!cached) {
      await this.inspect(fullName)
      cached = this.cache.get(fullName)
    }
    if (!cached) throw new AppError('INTEGRATION_MISSING', 'نتیجهٔ بازرسی پیدا نشد؛ دوباره تلاش کن.')
    const { report, sourceDir, manifest, slug } = cached
    if (!manifest) throw new AppError('INTEGRATION_NOT_RUNNABLE', report.reason)
    if (!force && report.riskLevel === 'high') {
      throw new AppError('INTEGRATION_BLOCKED', 'ریسک این ابزار بالاست. برای ادامه، تأیید صریح لازم است.')
    }
    if (!fs.existsSync(sourceDir)) throw new AppError('INTEGRATION_EXPIRED', 'فایل‌های موقت بازرسی پاک شده‌اند؛ دوباره بازرسی کن.')

    const installedRoot = path.join(this.paths().pluginsDir, 'installed')
    ensureDir(installedRoot)
    const target = uniquePath(path.join(installedRoot, slug))
    ensureDir(target)
    await copyTree(sourceDir, target, 0)
    const wrapper = path.join(target, 'webforge-run.cjs')
    fs.writeFileSync(wrapper, BUILD_WRAPPER, 'utf8')
    let manifestName = manifest.name
    const existing = this.plugins.list().find((plugin) => plugin.name === manifestName)
    if (existing) manifestName = `${manifestName.slice(0, 70)}-${hash(fullName).slice(0, 6)}`
    const finalManifest: PluginManifest = {
      ...manifest,
      name: manifestName,
      args: [wrapper, '{{arguments}}']
    }
    fs.writeFileSync(path.join(target, 'plugin.manifest.json'), JSON.stringify(finalManifest, null, 2), 'utf8')
    fs.writeFileSync(
      path.join(target, 'INTEGRATION.md'),
      [
        `# ${finalManifest.displayName}`,
        '',
        `منبع: ${report.repoUrl}`,
        `مجوز: ${report.license ?? 'نامشخص'}`,
        `ریسک: ${report.riskLevel}`,
        '',
        '## حکم بازرسی',
        report.ai?.summary ?? report.reason,
        '',
        '## هشدارها',
        ...report.findings.map((finding) => `- [${finding.severity}] ${finding.message}`),
        '',
        '## استفاده',
        report.usage || 'طبق README مخزن.',
        '',
        '> این ابزار در همان کاربر اجرا می‌شود. برای ابزارهای ناشناس از VM جدا استفاده کن.'
      ].join('\n'),
      'utf8'
    )
    const plugin = await this.plugins.addFromPath(target)
    this.logger.info('INTEGRATION_INSTALLED', 'ابزار در فضای کاری ثبت شد.', { fullName, pluginId: plugin.id })
    return { plugin, report }
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

export function buildManifest(
  fullName: string,
  repoName: string,
  description: string,
  version: string,
  ai: ToolAiVerdict | null
): PluginManifest {
  const base = sanitizeSegment(`${repoName}`.toLowerCase(), 'tool').replace(/[^a-z0-9-_.]/g, '-')
  return {
    name: base.slice(0, 80),
    displayName: repoName.slice(0, 100),
    description: `${description}${ai?.capabilities?.length ? ` — ${ai.capabilities.join('، ')}` : ''}`.slice(0, 2000),
    version: version || '1.0.0',
    runtime: 'node',
    command: 'node',
    args: [],
    cwd: '.',
    inputs: [
      {
        key: 'arguments',
        label: 'آرگومان‌های خط فرمان',
        type: 'text',
        required: false,
        help: ai?.usage || `طبق README مخزن ${fullName} وارد کن؛ مثال: --help`,
        placeholder: '--help'
      }
    ],
    outputs: [],
    permissions: {
      network: ai?.permissions.network ?? true,
      projectWrite: ai?.permissions.projectWrite ?? true,
      environment: []
    },
    timeoutSeconds: 600,
    builtin: undefined,
    icon: 'terminal'
  }
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

const BUILD_WRAPPER = `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const pkgPath = path.join(__dirname, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error('package.json پیدا نشد.');
  process.exit(2);
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin || {})[0];
if (!bin) {
  console.error('این بسته entry قابل اجرا (bin) ندارد.');
  process.exit(2);
}
const args = process.argv.slice(2).filter((value) => value !== '');
const result = spawnSync(process.execPath, [path.join(__dirname, bin), ...args], {
  stdio: 'inherit',
  cwd: process.env.WEBFORGE_PROJECT_PATH || process.cwd(),
  env: process.env
});
process.exit(result.status === null ? 1 : result.status);
`
