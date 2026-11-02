import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { EditorService } from '../src/main/services/editor'
import { ProjectService } from '../src/main/services/projects'
import { makeDb, makeLogger, tempDir } from './helpers'

function setup(): {
  editor: EditorService
  projects: ProjectService
  projectId: string
  file: string
  root: string
} {
  const root = tempDir('webforge-editor-')
  const site = path.join(root, 'site')
  fs.mkdirSync(site, { recursive: true })
  const file = path.join(site, 'index.html')
  fs.writeFileSync(
    file,
    '<!doctype html>\n<html><head><title>Test</title></head><body>\n<div id="hero" class="hero">\n  <h1>Old title</h1>\n  <img id="pic" src="old.png" alt="old">\n  <a id="link" href="/old">Old link</a>\n</div>\n</body></html>\n',
    'utf8'
  )
  const db = makeDb(root)
  const logger = makeLogger()
  const projects = new ProjectService(db, logger)
  const project = projects.register({ name: 'site', dir: site, type: 'static' })
  const editor = new EditorService(db, projects, logger)
  return { editor, projects, projectId: project.id, file, root: site }
}

describe('EditorService', () => {
  it('edits text without touching the rest of the file', async () => {
    const { editor, projectId, file } = setup()
    const before = fs.readFileSync(file, 'utf8')
    const summary = await editor.save({
      projectId,
      file: 'index.html',
      selector: '#hero h1',
      action: { type: 'text', text: 'New title' }
    })
    const after = fs.readFileSync(file, 'utf8')
    expect(after).toContain('<h1>New title</h1>')
    expect(after.replace('<h1>New title</h1>', '<h1>Old title</h1>')).toBe(before)
    expect(summary.kind).toBe('text')
    expect(fs.existsSync(summary.backupPath)).toBe(true)
  })

  it('adds and updates style attributes, attributes and images', async () => {
    const { editor, projectId, file } = setup()
    await editor.save({ projectId, file: 'index.html', selector: '#hero', action: { type: 'style', name: 'color', value: 'red' } })
    await editor.save({ projectId, file: 'index.html', selector: '#hero', action: { type: 'style', name: 'background-color', value: 'black' } })
    await editor.save({ projectId, file: 'index.html', selector: '#pic', action: { type: 'image', src: '/assets/new.png', alt: 'new alt' } })
    await editor.save({ projectId, file: 'index.html', selector: '#link', action: { type: 'link', href: '/new', target: '_blank' } })
    const html = fs.readFileSync(file, 'utf8')
    expect(html).toContain('color: red')
    expect(html).toContain('background-color: black')
    expect(html).toContain('src="/assets/new.png"')
    expect(html).toContain('alt="new alt"')
    expect(html).toContain('href="/new"')
    expect(html).toContain('target="_blank"')
  })

  it('undoes and redoes edits', async () => {
    const { editor, projectId, file } = setup()
    const original = fs.readFileSync(file, 'utf8')
    await editor.save({ projectId, file: 'index.html', selector: '#hero h1', action: { type: 'text', text: 'Changed' } })
    const changed = fs.readFileSync(file, 'utf8')
    const undone = editor.undo(projectId)
    expect(undone.restoredFile).toBe('index.html')
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    editor.redo(projectId)
    expect(fs.readFileSync(file, 'utf8')).toBe(changed)
    const history = editor.history(projectId)
    expect(history).toHaveLength(1)
    expect(history[0].reverted).toBe(false)
  })

  it('rejects edits for elements that do not exist', async () => {
    const { editor, projectId } = setup()
    await expect(
      editor.save({ projectId, file: 'index.html', selector: '#missing', action: { type: 'text', text: 'x' } })
    ).rejects.toMatchObject({ code: 'ELEMENT_NOT_MAPPED' })
  })

  it('prevents path traversal', async () => {
    const { editor, projectId } = setup()
    await expect(
      editor.save({ projectId, file: '../../etc/passwd', selector: 'body', action: { type: 'text', text: 'x' } })
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' })
  })
})
