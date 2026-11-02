import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ExtractionService } from '../src/main/services/extraction'
import { ProjectService } from '../src/main/services/projects'
import { makeDb, makeLogger, startFixtureSite, tempDir, type FixtureServer } from './helpers'

let fixture: FixtureServer
beforeAll(async () => {
  process.env.WEBFORGE_ALLOW_PRIVATE = '1'
  fixture = await startFixtureSite()
})
afterAll(async () => {
  delete process.env.WEBFORGE_ALLOW_PRIVATE
  await fixture.close()
})

describe('ExtractionService', () => {
  it('extracts html, css and assets and rewrites local paths', async () => {
    const dir = tempDir()
    const db = makeDb(dir)
    const logger = makeLogger()
    const projects = new ProjectService(db, logger)
    const extraction = new ExtractionService(db, projects, logger, () => dir)
    const progress: string[] = []
    const report = await extraction.extract(
      {
        url: fixture.url,
        name: 'fixture',
        outputRoot: dir,
        maxFiles: 50,
        maxBytesMb: 20,
        maxDepth: 1,
        timeoutSeconds: 60,
        rendered: false,
        includeExternalAssets: false,
        respectRobots: true
      },
      { onProgress: (event) => progress.push(event.phase) }
    )

    expect(report.pages).toBe(2)
    expect(report.assets).toBeGreaterThanOrEqual(4)
    expect(report.bytes).toBeGreaterThan(0)
    const project = projects.get(report.projectId)
    expect(fs.existsSync(path.join(project.path, 'clean', 'index.html'))).toBe(true)
    expect(fs.existsSync(path.join(project.path, 'clean', 'about.html'))).toBe(true)
    expect(fs.existsSync(path.join(project.path, 'clean', 'style.css'))).toBe(true)
    expect(fs.existsSync(path.join(project.path, 'clean', 'img', 'a.png'))).toBe(true)
    expect(fs.existsSync(path.join(project.path, 'clean', 'img', 'bg.png'))).toBe(true)
    expect(fs.existsSync(path.join(project.path, 'clean', 'app.js'))).toBe(true)
    expect(fs.existsSync(path.join(project.path, 'webforge.manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(project.path, 'reports', 'extraction-report.json'))).toBe(true)

    const html = fs.readFileSync(path.join(project.path, 'clean', 'index.html'), 'utf8')
    expect(html).toContain('style.css')
    expect(html).not.toContain('src="/img/a.png"')
    expect(html).toContain('img/a.png')
    expect(html).toContain('about.html')
    expect(html).toContain('https://external.example/x')

    const css = fs.readFileSync(path.join(project.path, 'clean', 'style.css'), 'utf8')
    expect(css).not.toContain("url('/img/bg.png')")
    expect(css).toContain('img/bg.png')
    expect(css).toContain('fonts/x.woff2')

    const manifest = JSON.parse(fs.readFileSync(path.join(project.path, 'webforge.manifest.json'), 'utf8')) as {
      sourceUrl: string
      files: Array<{ url: string; sha256: string | null }>
    }
    expect(manifest.sourceUrl).toBe(`${fixture.url}/`)
    expect(manifest.files.length).toBeGreaterThan(3)
    expect(manifest.files.every((file) => file.sha256 === null || file.sha256.length === 64)).toBe(true)
    expect(progress).toContain('downloading')
    expect(progress).toContain('rewriting')
    db.close()
  })

  it('rejects private urls when the guard is enabled', async () => {
    process.env.WEBFORGE_ALLOW_PRIVATE = '0'
    const dir = tempDir()
    const db = makeDb(dir)
    const logger = makeLogger()
    const projects = new ProjectService(db, logger)
    const extraction = new ExtractionService(db, projects, logger, () => dir)
    await expect(
      extraction.extract(
        {
          url: 'http://127.0.0.1:9999',
          name: 'blocked',
          outputRoot: dir,
          maxFiles: 10,
          maxBytesMb: 1,
          maxDepth: 1,
          timeoutSeconds: 20,
          rendered: false,
          includeExternalAssets: false,
          respectRobots: true
        },
        { onProgress: () => undefined }
      )
    ).rejects.toMatchObject({ code: 'PRIVATE_URL_NOT_ALLOWED' })
    expect(db.all('SELECT * FROM projects')).toHaveLength(0)
    db.close()
    process.env.WEBFORGE_ALLOW_PRIVATE = '1'
  })
})
