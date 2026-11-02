import { describe, expect, it } from 'vitest'
import { pluginManifestSchema } from '../src/shared/schemas'

const valid = {
  name: 'example-tool',
  displayName: 'ابزار نمونه',
  description: 'توضیح',
  version: '1.0.0',
  runtime: 'node',
  command: 'node',
  args: ['tool.js'],
  cwd: '.',
  inputs: [{ key: 'siteUrl', label: 'آدرس سایت', type: 'url', required: true }],
  outputs: [{ key: 'report', type: 'file', path: 'report.json' }],
  permissions: { network: false, projectWrite: true, environment: [] },
  timeoutSeconds: 300
}

describe('plugin manifest schema', () => {
  it('accepts the documented manifest shape', () => {
    const result = pluginManifestSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('rejects missing commands and unsafe names', () => {
    expect(pluginManifestSchema.safeParse({ ...valid, command: '' }).success).toBe(false)
    expect(pluginManifestSchema.safeParse({ ...valid, name: '../evil' }).success).toBe(false)
  })

  it('applies safe defaults', () => {
    const result = pluginManifestSchema.parse({ ...valid, args: undefined, outputs: undefined, permissions: undefined })
    expect(result.args).toEqual([])
    expect(result.outputs).toEqual([])
    expect(result.permissions.network).toBe(false)
  })
})
