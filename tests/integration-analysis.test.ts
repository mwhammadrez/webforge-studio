import { describe, expect, it } from 'vitest'
import { buildManifest, detectBin, detectRuntime } from '../src/main/services/integration'

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

  it('builds a safe manifest with a free-form argument input', () => {
    const manifest = buildManifest('owner/tool', 'tool', 'A test tool', '1.2.3', {
      used: true,
      verdict: 'safe',
      riskLevel: 'low',
      summary: 'safe',
      capabilities: ['convert', 'inspect'],
      runnable: true,
      runtime: 'node',
      usage: 'tool --input file',
      warnings: [],
      permissions: { network: false, projectWrite: true }
    })
    expect(manifest.name).toBe('tool')
    expect(manifest.inputs[0].key).toBe('arguments')
    expect(manifest.permissions.network).toBe(false)
    expect(manifest.timeoutSeconds).toBe(600)
    expect(manifest.description).toContain('convert')
  })
})
