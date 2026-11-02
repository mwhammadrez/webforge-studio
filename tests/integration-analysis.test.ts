import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  detectBin,
  detectRuntime,
  type Evidence,
} from '../src/main/services/integration'
import { IntegrationService } from '../src/main/services/integration'
import type { ToolAiVerdict } from '../src/shared/types'
import { tempDir } from './helpers'

function makeService(): IntegrationService {
  return new IntegrationService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { hasApiKey: () => false } as never,
    { info() {}, warn() {}, error() {} } as never,
    () => ({ tempDir: '', pluginsDir: '' })
  )
}

function evidence(root: string, overrides: Partial<Evidence> = {}): Evidence {
  const base: Evidence = {
    fullName: 'owner/tool',
    repoName: 'tool',
    description: 'A test tool',
    readme: '',
    sourceDir: root,
    files: listSource(root),
    packageJsonText: '{}',
    packageJson: null,
    findings: [],
    runtime: 'unknown',
    bin: null,
    scripts: [],
    riskLevel: 'low'
  }
  return { ...base, ...overrides }
}

function listSource(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(root)
  return out
}

function write(root: string, relative: string, content = '// code'): void {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}

const verdict: ToolAiVerdict = {
  used: true,
  verdict: 'safe',
  riskLevel: 'low',
  summary: 'safe',
  capabilities: [],
  runnable: true,
  runtime: 'node',
  usage: 'tool --input file',
  warnings: [],
  permissions: { network: false, projectWrite: true }
}

describe('integration analysis helpers', () => {
  it('detects string and object bins', () => {
    expect(detectBin({ bin: 'cli.js' })).toBe('cli.js')
    expect(detectBin({ bin: { tool: 'dist/tool.js', other: 'other.js' } })).toBe('dist/tool.js')
    expect(detectBin({})).toBeNull()
    expect(detectBin(null)).toBeNull()
  })

  it('detects node, python, binary and web runtimes', () => {
    expect(detectRuntime({ bin: 'cli.js' }, ['cli.js'])).toBe('node')
    expect(detectRuntime({}, ['pyproject.toml'])).toBe('python')
    expect(detectRuntime({}, ['bin/tool.exe'])).toBe('binary')
    expect(detectRuntime({ scripts: { dev: 'vite' } }, ['index.html'])).toBe('web')
    expect(detectRuntime(null, ['LICENSE'])).toBe('unknown')
  })
})

describe('IntegrationService connect plans', () => {
  it('runs a node CLI with the bundled interpreter when bin exists in the source', () => {
    const root = tempDir('webforge-connect-node-')
    write(root, 'bin/cli.js')
    const plan = makeService().heuristicPlan(
      evidence(root, { runtime: 'node', bin: 'bin/cli.js', packageJson: { name: 'tool', version: '1.0.0', bin: 'bin/cli.js' } }),
      verdict
    )
    expect(plan.strategy).toBe('local-node')
    expect(plan.actionable).toBe(true)
    expect(plan.command).toBe('bin/cli.js')
    expect(plan.args).toContain('{{arguments}}')
    expect(plan.permissions.network).toBe(false)
  })

  it('falls back to npx when the entry only exists after a build', () => {
    const root = tempDir('webforge-connect-npx-')
    write(root, 'src/cli.ts')
    const plan = makeService().heuristicPlan(
      evidence(root, { runtime: 'node', bin: 'dist/cli.js', packageJson: { name: '@scope/tool', bin: 'dist/cli.js' } }),
      verdict
    )
    expect(plan.strategy).toBe('npm-package')
    expect(plan.command).toBe('npx')
    expect(plan.args.slice(0, 2)).toEqual(['--yes', '@scope/tool'])
    expect(plan.permissions.network).toBe(true)
  })

  it('turns a static site into an editable project instead of a plugin', () => {
    const root = tempDir('webforge-connect-site-')
    write(root, 'index.html', '<!doctype html><title>x</title>')
    const plan = makeService().heuristicPlan(evidence(root, { runtime: 'web' }), verdict)
    expect(plan.strategy).toBe('static-project')
    expect(plan.entry).toBe('index.html')
    expect(plan.inputs).toEqual([])
  })

  it('repairs a hallucinated entry with the detected bin, or gives up', () => {
    const root = tempDir('webforge-connect-ghost-')
    write(root, 'index.js')
    const repaired = makeService().normalizePlan(
      {
        strategy: 'local-node',
        entry: 'bin/does-not-exist.js',
        inputs: [],
        outputs: [],
        permissions: { network: false, projectWrite: true, environment: [] },
        timeoutSeconds: 60,
        needsDependencies: false,
        demoArguments: '',
        rationale: 'توضیح',
        steps: ['مرحله'],
        confidence: 0.9
      },
      evidence(root, { runtime: 'node', bin: 'index.js' })
    )
    expect(repaired?.entry).toBe('index.js')

    const hopeless = makeService().normalizePlan(
      {
        strategy: 'local-node',
        entry: 'bin/does-not-exist.js',
        inputs: [],
        outputs: [],
        permissions: { network: false, projectWrite: true, environment: [] },
        timeoutSeconds: 60,
        needsDependencies: false,
        demoArguments: '',
        rationale: 'توضیح',
        steps: ['مرحله'],
        confidence: 0.9
      },
      evidence(root, { runtime: 'node' })
    )
    expect(hopeless).toBeNull()
  })

  it('builds argv templates from the flags the model named', () => {
    const root = tempDir('webforge-connect-args-')
    write(root, 'cli.js')
    const plan = makeService().normalizePlan(
      {
        strategy: 'local-node',
        entry: 'cli.js',
        inputs: [
          { key: 'out', label: 'خروجی', type: 'folder', required: false, flag: '--out', argStyle: 'flag' },
          { key: 'watch', label: 'پایش', type: 'boolean', required: false, flag: '--watch', argStyle: 'flag' },
          { key: 'mode', label: 'حالت', type: 'select', required: true, flag: '--mode', argStyle: 'value', options: ['fast', 'slow'] },
          { key: 'src', label: 'منبع', type: 'text', required: true, argStyle: 'positional' }
        ],
        outputs: [{ key: 'result', label: 'نتیجه', type: 'folder', path: 'out/' }],
        permissions: { network: true, projectWrite: true, environment: ['GITHUB_TOKEN', 'bad name'] },
        timeoutSeconds: 300,
        needsDependencies: true,
        demoArguments: '--help',
        rationale: 'اجرای محلی',
        steps: ['کپی فایل‌ها'],
        confidence: 0.8
      },
      evidence(root, { runtime: 'node', bin: 'cli.js' })
    )
    expect(plan).not.toBeNull()
    expect(plan?.args).toEqual(['--out={{out}}', '?{{watch}}:--watch', '--mode', '{{mode}}', '{{src}}', '{{arguments}}'])
    expect(plan?.permissions.environment).toEqual(['GITHUB_TOKEN'])
    expect(plan?.outputs[0].path).toBe('out/')
    expect(plan?.inputs.some((input) => input.key === 'arguments')).toBe(true)
  })

  it('rejects an npm package name that is not a valid specifier', () => {
    const root = tempDir('webforge-connect-badname-')
    const plan = makeService().normalizePlan(
      {
        strategy: 'npm-package',
        entry: 'rm -rf /',
        inputs: [],
        outputs: [],
        permissions: { network: true, projectWrite: false, environment: [] },
        timeoutSeconds: 60,
        needsDependencies: false,
        demoArguments: '',
        rationale: '',
        steps: [],
        confidence: 0.7
      },
      evidence(root, {})
    )
    expect(plan).toBeNull()
  })
})
