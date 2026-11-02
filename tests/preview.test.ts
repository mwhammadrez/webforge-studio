import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PreviewService } from '../src/main/services/preview'
import { ProjectService } from '../src/main/services/projects'
import { makeDb, makeLogger, tempDir } from './helpers'

function setup(): { preview: PreviewService; projectId: string; site: string; db: ReturnType<typeof makeDb> } {
  const root = tempDir('webforge-preview-')
  const site = path.join(root, 'site')
  fs.mkdirSync(path.join(site, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body><h1>Hello</h1></body></html>', 'utf8')
  fs.writeFileSync(path.join(site, 'assets', 'a.txt'), 'asset', 'utf8')
  const db = makeDb(root)
  const logger = makeLogger()
  const projects = new ProjectService(db, logger)
  const project = projects.register({ name: 'site', dir: site, type: 'static' })
  const start = 5400 + Math.floor(Math.random() * 400)
  const preview = new PreviewService(projects, logger, () => ({ start, end: start + 40 }))
  return { preview, projectId: project.id, site, db }
}

describe('PreviewService', () => {
  it('serves html with the editor injected and blocks path traversal', async () => {
    const { preview, projectId, db } = setup()
    const state = await preview.start(projectId)
    expect(state.running).toBe(true)
    expect(state.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const response = await fetch(`${state.url}/`)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('/__webforge/editor.js')
    const editorScript = await fetch(`${state.url}/__webforge/editor.js`)
    const editorSource = await editorScript.text()
    expect(editorSource).toContain('webforge:select')
    // The client script ships as a raw template string, so a syntax error would only show up at click time.
    expect(() => new Function(editorSource)).not.toThrow()
    const traversal = await fetch(`${state.url}/../../etc/passwd`)
    expect(traversal.status).toBe(404)
    const asset = await fetch(`${state.url}/assets/a.txt`)
    expect(await asset.text()).toBe('asset')
    await preview.stop(projectId)
    expect(preview.state(projectId).running).toBe(false)
    db.close()
  })

  it('supports the admin panel content API and uploads', async () => {
    const { preview, projectId, db, site } = setup()
    const state = await preview.start(projectId)
    const initial = await fetch(`${state.url}/api/content`)
    expect(await initial.json()).toEqual({ version: 1, pages: {} })
    const save = await fetch(`${state.url}/api/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, pages: { '/': { overrides: {} } } })
    })
    expect(save.status).toBe(200)
    const stored = await fetch(`${state.url}/api/content`)
    expect((await stored.json()) as { version: number }).toMatchObject({ version: 1 })
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    const upload = await fetch(`${state.url}/api/upload?name=test.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: png
    })
    const uploadResult = (await upload.json()) as { ok: boolean; path: string }
    expect(uploadResult.ok).toBe(true)
    expect(fs.existsSync(path.join(site, uploadResult.path))).toBe(true)
    await preview.stop(projectId)
    db.close()
  })
})
