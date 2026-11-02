import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditAction, EditEventRecord, EditorTarget, FileNode, PreviewState, Project } from '@shared/types'
import { useApp } from '../store'
import { Button, Empty, Field, SectionTitle, statusBadge } from '../components/ui'
import { Icon } from '../components/Icon'
import { errorMessage, unwrap } from '../lib/api'
import { date, fa } from '../lib/format'

const STYLE_KEYS = [
  'color', 'background-color', 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing',
  'text-align', 'opacity', 'display', 'border-radius', 'border', 'max-width',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left'
] as const

export default function Workspace(): React.JSX.Element {
  const { projects, activeProjectId } = useApp()
  const navigate = useApp((state) => state.navigate)
  const toast = useApp((state) => state.toast)
  const setActiveProject = useApp((state) => state.setActiveProject)
  const setPreviewGlobal = useApp((state) => state.setPreview)
  const project = projects.find((item) => item.id === activeProjectId) ?? null
  const [tree, setTree] = useState<FileNode[]>([])
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [starting, setStarting] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<EditorTarget | null>(null)
  const [pageFile, setPageFile] = useState('index.html')
  const [pagePath, setPagePath] = useState('')
  const [history, setHistory] = useState<EditEventRecord[]>([])
  const [saving, setSaving] = useState(false)
  const [viewFile, setViewFile] = useState<{ path: string; content: string } | null>(null)
  const [selectPage, setSelectPage] = useState('')
  const [activePath, setActivePath] = useState('')
  const [zen, setZen] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  const hasClean = useMemo(() => tree.some((node) => node.isDirectory && node.name === 'clean'), [tree])
  const toPagePath = (relativePath: string): string => (relativePath.startsWith('clean/') ? relativePath.slice(6) : relativePath)
  const htmlFiles = useMemo(() => flatten(tree).filter((node) => !node.isDirectory && /\.html?$/i.test(node.name)), [tree])

  const setPreviewState = useCallback(
    (state: PreviewState | null) => {
      setPreview(state)
      setPreviewGlobal(state)
    },
    [setPreviewGlobal]
  )

  /** Maps a URL path reported by the iframe back onto a real file in the project. */
  const resolvePage = useCallback(
    (urlPath: string): FileNode | null => {
      const clean = `/${urlPath.replace(/^\/+/, '')}`.replace(/\/$/, '/index.html')
      const candidate = htmlFiles.find((node) => {
        const page = `/${toPagePath(node.relativePath)}`
        return page === clean || `${page}index.html` === clean || `${page}/` === clean
      })
      return candidate ?? null
    },
    [htmlFiles]
  )

  const loadProject = useCallback(
    async (target: Project) => {
      try {
        const [nodes, state, edits] = await Promise.all([
          unwrap(window.webforge.projects.tree(target.id)),
          unwrap(window.webforge.preview.state(target.id)),
          unwrap(window.webforge.editor.history(target.id))
        ])
        setTree(nodes)
        setPreviewState(state)
        setHistory(edits)
        setSelected(null)
        const root = nodes.find((node) => node.isDirectory && node.name === 'clean')
        const files = flatten(root ? (root.children ?? []) : nodes).filter(
          (node) => !node.isDirectory && /\.html?$/i.test(node.name) && node.name !== 'admin.html'
        )
        const initial =
          files.find((node) => /(^|\/)index\.html?$/i.test(node.relativePath)) ?? files[0]
        if (initial) {
          setPageFile(initial.relativePath)
          setSelectPage(initial.relativePath)
          setPagePath(toPagePath(initial.relativePath))
          setActivePath(initial.relativePath)
        }
        if (!state.running) {
          setStarting(true)
          setPreviewState(await unwrap(window.webforge.preview.start(target.id)))
        }
      } catch (error) {
        toast('error', 'باز کردن پروژه ناموفق بود', errorMessage(error))
      } finally {
        setStarting(false)
      }
    },
    [setPreviewState, toast]
  )

  useEffect(() => {
    if (project) void loadProject(project)
  }, [project, loadProject])

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow
    const expectedOrigin = preview?.url ? new URL(preview.url).origin : null
    const onMessage = (event: MessageEvent): void => {
      // The preview server is reachable by anything on the machine; only accept
      // messages that carry this session's token and really come from the frame.
      if (!expectedOrigin || event.origin !== expectedOrigin) return
      if (frameWindow && event.source !== frameWindow) return
      const data = event.data as { type?: string; token?: string; target?: EditorTarget; pagePath?: string }
      if (!data || typeof data !== 'object' || data.token !== preview?.token) return
      if (data.type === 'webforge:select' && data.target) {
        setSelected(data.target)
        const page = data.pagePath ?? ''
        setPagePath(page)
        const node = resolvePage(page)
        if (node) {
          setPageFile(node.relativePath)
          setSelectPage(node.relativePath)
          setActivePath(node.relativePath)
        } else {
          setPageFile(hasClean ? `clean/${page}` : page)
        }
      }
      if (data.type === 'webforge:ready') setPagePath(data.pagePath ?? '')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [preview?.url, preview?.token, hasClean, resolvePage])

  function sendToFrame(payload: Record<string, unknown>): void {
    if (!preview?.url || !preview.token) return
    frameRef.current?.contentWindow?.postMessage({ ...payload, token: preview.token }, new URL(preview.url).origin)
  }

  useEffect(() => {
    sendToFrame({ type: 'webforge:mode', enabled: selectMode })
    if (selectMode && selected) sendToFrame({ type: 'webforge:highlight', selector: selected.selector })
  }, [selectMode, preview?.running])

  const pageUrl = (relative: string): string =>
    `${preview?.url ?? ''}/${encodePath(toPagePath(relative))}?t=${Date.now()}`

  const reloadPreview = (keepSelection = true): void => {
    if (!preview?.url) return
    if (frameRef.current) frameRef.current.src = pageUrl(pageFile)
    if (keepSelection && selected) {
      window.setTimeout(() => sendToFrame({ type: 'webforge:mode', enabled: selectMode }), 450)
    }
  }

  const stopPreview = async (): Promise<void> => {
    if (!project) return
    try {
      setPreviewState(await unwrap(window.webforge.preview.stop(project.id)))
      setSelected(null)
      setSelectMode(false)
    } catch (error) {
      toast('error', 'توقف پیش‌نمایش ناموفق بود', errorMessage(error))
    }
  }

  const startPreview = async (): Promise<void> => {
    if (!project) return
    setStarting(true)
    try {
      setPreviewState(await unwrap(window.webforge.preview.start(project.id)))
    } catch (error) {
      toast('error', 'اجرای پیش‌نمایش ناموفق بود', errorMessage(error))
    } finally {
      setStarting(false)
    }
  }

  const applyToFrame = (action: EditAction): void => {
    if (!selected) return
    sendToFrame({
      type: 'webforge:apply',
      selector: selected.selector,
      kind: action.type,
      name: 'name' in action ? action.name : undefined,
      alt: action.type === 'image' ? action.alt : undefined,
      target: action.type === 'link' ? action.target : undefined,
      textIndex: action.type === 'text' ? action.textIndex ?? selected.textIndex ?? 0 : undefined,
      value:
        action.type === 'text'
          ? action.text
          : action.type === 'attr' || action.type === 'style'
            ? action.value
            : action.type === 'image'
              ? action.src
              : action.type === 'link'
                ? action.href
                : action.type === 'html' || action.type === 'insertBefore' || action.type === 'insertAfter'
                  ? action.html
                  : ''
    })
  }

  const save = async (action: EditAction, notify = true): Promise<boolean> => {
    if (!project || !selected) return false
    setSaving(true)
    try {
      const summary = await unwrap(
        window.webforge.editor.save({
          projectId: project.id,
          file: pageFile,
          selector: selected.selector,
          action,
          fallbackText: selected.clickedText ?? selected.text,
          textIndex: action.type === 'text' ? action.textIndex ?? selected.textIndex ?? 0 : undefined
        })
      )
      applyToFrame(action)
      setHistory(await unwrap(window.webforge.editor.history(project.id)))
      if (notify) toast('success', 'تغییرات ذخیره شد', `پشتیبان: ${summary.backupPath}`)
      return true
    } catch (error) {
      toast('error', 'ذخیرهٔ تغییر ناموفق بود', errorMessage(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveMany = async (actions: EditAction[]): Promise<void> => {
    for (const action of actions) {
      if (!(await save(action, false))) return
    }
    if (actions.length) toast('success', 'تغییرات ذخیره شد', `${actions.length} تغییر اعمال شد`)
  }

  const replaceImage = async (): Promise<void> => {
    if (!project || !selected) return
    try {
      const source = await unwrap(window.webforge.app.pickFile('image'))
      if (!source) return
      setSaving(true)
      const summary = await unwrap(
        window.webforge.editor.replaceImage({
          projectId: project.id,
          file: pageFile,
          selector: selected.selector,
          sourcePath: source
        })
      )
      sendToFrame({ type: 'webforge:apply', selector: selected.selector, kind: 'image', value: summary.after })
      setHistory(await unwrap(window.webforge.editor.history(project.id)))
      toast('success', 'تصویر جایگزین شد')
    } catch (error) {
      toast('error', 'جایگزینی تصویر ناموفق بود', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const revert = async (direction: 'undo' | 'redo'): Promise<void> => {
    if (!project) return
    try {
      if (direction === 'undo') await unwrap(window.webforge.editor.undo(project.id))
      else await unwrap(window.webforge.editor.redo(project.id))
      setHistory(await unwrap(window.webforge.editor.history(project.id)))
      setSelected(null)
      reloadPreview(false)
      toast('success', direction === 'undo' ? 'آخرین تغییر بازگردانی شد' : 'تغییر دوباره اعمال شد')
    } catch (error) {
      toast('error', direction === 'undo' ? 'بازگردانی ناموفق بود' : 'اجرای دوباره ناموفق بود', errorMessage(error))
    }
  }

  const openFile = async (node: FileNode): Promise<void> => {
    if (!project) return
    if (/\.html?$/i.test(node.name)) {
      setPageFile(node.relativePath)
      setSelectPage(node.relativePath)
      setActivePath(node.relativePath)
      setPagePath(toPagePath(node.relativePath))
      setSelected(null)
      if (frameRef.current && preview?.url) frameRef.current.src = pageUrl(node.relativePath)
      return
    }
    try {
      const file = await unwrap(window.webforge.projects.readFile(project.id, node.relativePath))
      setViewFile({ path: node.relativePath, content: file.content })
    } catch (error) {
      toast('error', 'خواندن فایل ناموفق بود', errorMessage(error))
    }
  }

  if (!project) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-header__title">ویرایشگر بصری</h1>
            <p className="page-header__sub">یک پروژه انتخاب کن تا پیش‌نمایش و ویرایشگر باز شوند.</p>
          </div>
        </div>
        <div className="card">
          {projects.length === 0 ? (
            <Empty icon="folder" title="پروژه‌ای وجود ندارد" description="اول یک سایت استخراج کن یا پوشه‌ای باز کن." action={<Button variant="primary" icon="download" onClick={() => navigate('extract')}>استخراج سایت</Button>} />
          ) : (
            <div className="list">
              {projects.map((item) => (
                <button key={item.id} className="list__item" onClick={() => setActiveProject(item.id)}>
                  <span className="list__icon"><Icon name="globe" size={16} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="list__title">{item.name}</span>
                    <span className="list__meta">{item.path}</span>
                  </span>
                  {statusBadge(item.status)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const previewSrc = preview?.running && preview.url ? `${preview.url}/${encodePath(pagePath || toPagePath(pageFile))}` : ''

  return (
    <div className="page" style={{ paddingBottom: 18 }}>
      <div className="row row--between" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 12 }}>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <h1 className="page-header__title" style={{ fontSize: 19 }}>{project.name}</h1>
              {projects.length > 1 ? (
                <select
                  className="select"
                  style={{ maxWidth: 200, minHeight: 30, padding: '2px 8px', fontSize: 11.5 }}
                  value={project.id}
                  onChange={(event) => {
                    if (project) void window.webforge.preview.stop(project.id)
                    setPreviewState(null)
                    setActiveProject(event.target.value)
                  }}
                  aria-label="تغییر پروژه"
                >
                  {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              ) : null}
            </div>
            <div className="path" style={{ maxWidth: 460 }}>{project.path}</div>
          </div>
          {statusBadge(project.status)}
          {preview?.running ? <span className="badge badge--success">پیش‌نمایش فعال</span> : <span className="badge">پیش‌نمایش متوقف</span>}
        </div>
        <div className="row row--wrap">
          <Button size="sm" variant={selectMode ? 'primary' : 'default'} icon="edit" onClick={() => setSelectMode((value) => !value)} disabled={!preview?.running}>
            {selectMode ? 'حالت انتخاب فعال' : 'حالت انتخاب'}
          </Button>
          <Button size="sm" variant="ghost" icon="undo" onClick={() => void revert('undo')} disabled={!history.some((item) => !item.reverted)}>Undo</Button>
          <Button size="sm" variant="ghost" icon="redo" onClick={() => void revert('redo')} disabled={!history.some((item) => item.reverted)}>Redo</Button>
          {preview?.running ? (
            <>
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => reloadPreview()}>بارگذاری مجدد</Button>
              <Button size="sm" variant="danger" icon="stop" onClick={() => void stopPreview()}>توقف</Button>
            </>
          ) : (
            <Button size="sm" variant="primary" icon="play" onClick={() => void startPreview()} loading={starting}>اجرای پیش‌نمایش</Button>
          )}
          <Button size="sm" variant={zen ? 'primary' : 'ghost'} icon="zoom" onClick={() => setZen((value) => !value)}>
            {zen ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه'}
          </Button>
          <Button size="sm" variant="ghost" icon="folder" onClick={() => void window.webforge.app.openPath(project.path)} aria-label="پوشهٔ پروژه" />
        </div>
      </div>

      {project.type === 'node' ? (
        <div className="alert alert--info" style={{ marginBottom: 10 }}>
          <Icon name="alert" size={15} />
          <span>این پروژه Node شناسایی شده است. فایل‌ها و تست کار می‌کنند؛ برای پیش‌نمایش، فایل HTML استاتیک لازم است یا از dev server جدا استفاده کن.</span>
        </div>
      ) : null}

      <div className={`workspace ${zen ? 'workspace--zen' : ''}`}>
        <aside className="workspace__panel">
          <div className="workspace__head">
            <span>فایل‌ها</span>
            <span className="badge">{fa(htmlFiles.length)} صفحه</span>
          </div>
          <div className="file-tree">
            {tree.length === 0 ? <div style={{ padding: 12, color: 'var(--muted)', fontSize: 11.5 }}>فایلی پیدا نشد.</div> : null}
            {tree.map((node) => (
              <TreeNode key={node.path} node={node} onOpen={(item) => void openFile(item)} active={activePath === node.relativePath} depth={0} />
            ))}
          </div>
        </aside>

        <section className="workspace__panel">
          <div className="workspace__head">
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              <Icon name="eye" size={15} />
              <select
                className="select"
                style={{ minHeight: 28, padding: '2px 8px', fontSize: 11.5, maxWidth: 250 }}
                value={selectPage}
                onChange={(event) => {
                  const value = event.target.value
                  setSelectPage(value)
                  setPageFile(value)
                  setPagePath(toPagePath(value))
                  setActivePath(value)
                  setSelected(null)
                }}
              >
                {htmlFiles.map((file) => (
                  <option key={file.path} value={file.relativePath}>{file.relativePath}</option>
                ))}
              </select>
              <span className="path" style={{ maxWidth: 220 }}>{preview?.url ?? ''}</span>
            </div>
            <div className="row" style={{ gap: 5 }}>
              {preview?.running ? <span className="status-dot status-dot--on" /> : <span className="status-dot" />}
              <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 10.5 }}>{selectMode ? 'روی بخش موردنظر کلیک کن (دوباره کلیک = والد)' : 'برای ویرایش، حالت انتخاب را فعال کن'}</span>
            </div>
          </div>
          {previewSrc ? (
            <iframe
              ref={frameRef}
              className="preview-frame"
              title="پیش‌نمایش سایت"
              src={previewSrc}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              onLoad={() => {
                sendToFrame({ type: 'webforge:mode', enabled: selectMode })
                if (selectMode && selected) sendToFrame({ type: 'webforge:highlight', selector: selected.selector })
              }}
            />
          ) : (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', background: 'var(--panel-2)' }}>
              <Empty
                icon="play"
                title={starting ? 'در حال اجرای پیش‌نمایش…' : 'پیش‌نمایش متوقف است'}
                description={starting ? 'سرور محلی آماده می‌شود.' : 'برای دیدن سایت و ویرایش بصری، پیش‌نمایش را اجرا کن.'}
                action={!starting ? <Button variant="primary" icon="play" onClick={() => void startPreview()}>اجرای پیش‌نمایش</Button> : undefined}
              />
            </div>
          )}
        </section>

        <aside className="workspace__panel">
          <div className="workspace__head">
            <span>بازرس عنصر</span>
            {selected ? <span className="badge badge--accent">{selected.tag}</span> : null}
          </div>
          <div className="inspector">
            {!selected ? (
              <div className="stack" style={{ gap: 10 }}>
                <div className="alert alert--info">
                  <Icon name="edit" size={16} />
                  <span>حالت انتخاب را روشن کن و روی متن، عکس، دکمه یا هر بخش کلیک کن. با دوبار کلیک یا Alt، بخش بزرگ‌تر انتخاب می‌شود.</span>
                </div>
                <div className="alert">
                  <Icon name="shield" size={16} />
                  <span>هر ذخیره یک پشتیبان زمان‌دار می‌سازد و قابل بازگردانی است.</span>
                </div>
              </div>
            ) : (
              <Inspector
                key={`${selected.selector}-${pageFile}`}
                target={selected}
                saving={saving}
                onSave={(action) => void save(action)}
                onSaveMany={(actions) => void saveMany(actions)}
                onSelectLevel={(selector) => {
                  const level = selected.levels?.find((item) => item.selector === selector)
                  if (!level) return
                  setSelected({
                    ...selected,
                    selector: level.selector,
                    tag: level.tag,
                    text: level.text,
                    editableText: level.editableText ?? level.text,
                    textIndex: 0,
                    levels: selected.levels
                  })
                  sendToFrame({ type: 'webforge:highlight', selector })
                }}
                onReplaceImage={() => void replaceImage()}
              />
            )}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <SectionTitle title="تاریخچه" hint="آخرین تغییرها" />
              {history.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>هنوز تغییری ثبت نشده است.</div>
              ) : (
                <div className="stack" style={{ gap: 7 }}>
                  {history.slice(0, 6).map((item) => (
                    <div key={item.id} style={{ fontSize: 10.5, color: 'var(--muted)', display: 'flex', gap: 6 }}>
                      <span className={item.reverted ? 'badge badge--warn' : 'badge badge--success'} style={{ fontSize: 9 }}>
                        {item.reverted ? 'بازگردانده' : 'ثبت'}
                      </span>
                      <span className="path" style={{ flex: 1 }}>{item.filePath}</span>
                      <span>{date(item.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {viewFile ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setViewFile(null)}>
          <div className="modal" style={{ width: 'min(900px, 100%)' }}>
            <div className="modal__head">
              <h3 className="path">{viewFile.path}</h3>
              <Button variant="ghost" icon="x" onClick={() => setViewFile(null)} aria-label="بستن" />
            </div>
            <div className="modal__body" style={{ padding: 0 }}>
              <pre className="log" style={{ maxHeight: '65vh', margin: 0, border: 0, borderRadius: 0 }}>{viewFile.content.slice(0, 200000)}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Inspector({
  target,
  saving,
  onSave,
  onSaveMany,
  onSelectLevel,
  onReplaceImage
}: {
  target: EditorTarget
  saving: boolean
  onSave: (action: EditAction) => void
  onSaveMany: (actions: EditAction[]) => void
  onSelectLevel: (selector: string) => void
  onReplaceImage: () => void
}): React.JSX.Element {
  const [text, setText] = useState(target.editableText ?? target.text)
  const [textIndex, setTextIndex] = useState(target.textIndex ?? 0)
  const [href, setHref] = useState(target.attrs.href ?? '')
  const [linkTarget, setLinkTarget] = useState(target.attrs.target ?? '_self')
  const [imageSrc, setImageSrc] = useState(target.imageSrc ?? target.attrs.src ?? '')
  const [alt, setAlt] = useState(target.attrs.alt ?? '')
  const [styles, setStyles] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const key of STYLE_KEYS) initial[key] = target.styles[key] ?? ''
    return initial
  })
  const [classes, setClasses] = useState<string[]>(target.classes ?? [])
  const [newClass, setNewClass] = useState('')
  const [attrs, setAttrs] = useState<Array<{ name: string; value: string }>>(() =>
    Object.entries(target.attrs)
      .filter(([name]) => name !== 'class')
      .map(([name, value]) => ({ name, value: value ?? '' }))
  )
  const [newAttr, setNewAttr] = useState({ name: '', value: '' })
  const [html, setHtml] = useState(target.html)
  const [showHtml, setShowHtml] = useState(false)
  const [tab, setTab] = useState<'text' | 'style' | 'markup'>('text')

  const isImage = ['img', 'picture', 'video', 'source'].includes(target.tag)
  const isLink = target.tag === 'a'
  const transparent = target.styles['is-transparent-bg'] === '1'

  const changedStyles = (): EditAction[] => {
    const actions: EditAction[] = []
    for (const key of STYLE_KEYS) {
      const value = (styles[key] ?? '').trim()
      const original = (target.styles[key] ?? '').trim()
      if (value !== original) actions.push({ type: 'style', name: key, value })
    }
    return actions
  }

  const commitClass = (value: string): void => onSave({ type: 'attr', name: 'class', value })

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="stack" style={{ gap: 6 }}>
        <div className="selector-pill" title={target.selector}>{target.selector}</div>
        {target.levels && target.levels.length > 1 ? (
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {target.levels.slice(0, 5).map((level) => (
              <button
                key={level.selector}
                className={level.selector === target.selector ? 'badge badge--accent' : 'badge'}
                style={{ cursor: 'pointer', fontSize: 9.5 }}
                onClick={() => onSelectLevel(level.selector)}
                title={level.text}
              >
                {level.tag}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="row" style={{ gap: 4 }}>
        {([['text', 'محتوا'], ['style', 'استایل'], ['markup', 'ساختار']] as const).map(([key, label]) => (
          <button key={key} className="tab" data-active={tab === key} onClick={() => setTab(key)} style={{ flex: 1 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'text' ? (
        <div className="stack" style={{ gap: 10 }}>
          {!isImage ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="field__label"><Icon name="type" size={14} /> متن</span>
              <textarea className="textarea" style={{ minHeight: 74 }} value={text} onChange={(event) => setText(event.target.value)} />
              {(target.textCount ?? 0) > 1 ? (
                <Field label="کدام بخش از متن؟">
                  <input
                    className="input input--ltr"
                    type="number"
                    min={0}
                    max={(target.textCount ?? 1) - 1}
                    value={textIndex}
                    onChange={(event) => setTextIndex(Number(event.target.value))}
                  />
                </Field>
              ) : null}
              {(target.textCount ?? 0) === 0 && target.hasElementChildren ? (
                <div className="alert alert--warn" style={{ padding: '7px 10px' }}>
                  <Icon name="alert" size={14} />
                  <span>این عنصر متن مستقیم ندارد؛ ذخیرهٔ متن محتوای فرزندانش را جایگزین می‌کند. برای ویرایش دقیق‌تر از فهرست بالا یکی از فرزند‌ها را انتخاب کن.</span>
                </div>
              ) : null}
              <Button size="sm" variant="primary" icon="save" loading={saving} onClick={() => onSave({ type: 'text', text, textIndex })}>
                ذخیرهٔ متن
              </Button>
            </div>
          ) : null}

          {isImage ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="field__label"><Icon name="image" size={14} /> تصویر</span>
              <input className="input input--ltr" value={imageSrc} onChange={(event) => setImageSrc(event.target.value)} placeholder="/assets/image.jpg" />
              <input className="input" placeholder="متن جایگزین (alt)" value={alt} onChange={(event) => setAlt(event.target.value)} />
              <div className="row">
                <Button size="sm" icon="folder" onClick={onReplaceImage} loading={saving}>انتخاب فایل…</Button>
                <Button size="sm" variant="primary" icon="save" onClick={() => onSave({ type: 'image', src: imageSrc, alt })}>ذخیرهٔ مسیر</Button>
              </div>
            </div>
          ) : null}

          {isLink ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="field__label"><Icon name="link" size={14} /> لینک</span>
              <input className="input input--ltr" value={href} onChange={(event) => setHref(event.target.value)} placeholder="/about.html" />
              <select className="select" value={linkTarget} onChange={(event) => setLinkTarget(event.target.value)}>
                <option value="">همین پنجره</option>
                <option value="_blank">پنجرهٔ جدید</option>
                <option value="_parent">پنجرهٔ والد</option>
                <option value="_top">بالاترین پنجره</option>
              </select>
              <Button size="sm" variant="primary" icon="save" onClick={() => onSave({ type: 'link', href, target: linkTarget || undefined })}>ذخیرهٔ لینک</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'style' ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="grid grid--2" style={{ gap: 8 }}>
            <ColorField label="رنگ متن" value={styles.color} onChange={(value) => setStyles((prev) => ({ ...prev, color: value }))} />
            <ColorField
              label="پس‌زمینه"
              value={styles['background-color']}
              allowTransparent={transparent}
              onChange={(value) => setStyles((prev) => ({ ...prev, 'background-color': value }))}
            />
          </div>
          <div className="grid grid--2" style={{ gap: 8 }}>
            <Field label="اندازهٔ فونت"><input className="input input--ltr" value={styles['font-size']} placeholder="16px" onChange={(event) => setStyles((p) => ({ ...p, 'font-size': event.target.value }))} /></Field>
            <Field label="وزن فونت">
              <select className="select" value={styles['font-weight']} onChange={(event) => setStyles((p) => ({ ...p, 'font-weight': event.target.value }))}>
                <option value="">بدون تغییر</option>
                {['300', '400', '500', '600', '700', '800', '900'].map((weight) => <option key={weight} value={weight}>{weight}</option>)}
              </select>
            </Field>
            <Field label="خانوادهٔ فونت"><input className="input input--ltr" value={styles['font-family']} placeholder="Vazirmatn, sans-serif" onChange={(event) => setStyles((p) => ({ ...p, 'font-family': event.target.value }))} /></Field>
            <Field label="ارتفاع خط"><input className="input input--ltr" value={styles['line-height']} placeholder="1.6" onChange={(event) => setStyles((p) => ({ ...p, 'line-height': event.target.value }))} /></Field>
            <Field label="فاصلهٔ حروف"><input className="input input--ltr" value={styles['letter-spacing']} placeholder="0.5px" onChange={(event) => setStyles((p) => ({ ...p, 'letter-spacing': event.target.value }))} /></Field>
            <Field label="تراز متن">
              <select className="select" value={styles['text-align']} onChange={(event) => setStyles((p) => ({ ...p, 'text-align': event.target.value }))}>
                <option value="">بدون تغییر</option>
                {['right', 'center', 'left', 'justify'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="نمایش">
              <select className="select" value={styles.display} onChange={(event) => setStyles((p) => ({ ...p, display: event.target.value }))}>
                <option value="">بدون تغییر</option>
                {['block', 'inline', 'inline-block', 'flex', 'grid', 'inline-flex', 'none'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="شفافیت"><input className="input input--ltr" value={styles.opacity} placeholder="1" onChange={(event) => setStyles((p) => ({ ...p, opacity: event.target.value }))} /></Field>
          </div>

          <BoxEditor title="پدینگ" keys={['padding-top', 'padding-right', 'padding-bottom', 'padding-left']} labels={['بالا', 'راست', 'پایین', 'چپ']} styles={styles} onChange={(key, value) => setStyles((p) => ({ ...p, [key]: value }))} />
          <BoxEditor title="مارجین" keys={['margin-top', 'margin-right', 'margin-bottom', 'margin-left']} labels={['بالا', 'راست', 'پایین', 'چپ']} styles={styles} onChange={(key, value) => setStyles((p) => ({ ...p, [key]: value }))} />

          <div className="grid grid--2" style={{ gap: 8 }}>
            <Field label="گردی گوشه"><input className="input input--ltr" value={styles['border-radius']} placeholder="12px" onChange={(event) => setStyles((p) => ({ ...p, 'border-radius': event.target.value }))} /></Field>
            <Field label="حداکثر عرض"><input className="input input--ltr" value={styles['max-width']} placeholder="720px" onChange={(event) => setStyles((p) => ({ ...p, 'max-width': event.target.value }))} /></Field>
          </div>
          <Field label="قاب (border)"><input className="input input--ltr" value={styles.border} placeholder="1px solid #334155" onChange={(event) => setStyles((p) => ({ ...p, border: event.target.value }))} /></Field>

          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" variant="primary" icon="save" loading={saving} onClick={() => onSaveMany(changedStyles())}>
              اعمال استایل‌ها
            </Button>
            <Button size="sm" onClick={() => onSave({ type: 'style', name: 'display', value: 'none' })}>مخفی کردن</Button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 10.5, margin: 0 }}>
            فقط فیلدهایی که تغییر کرده‌اند نوشته می‌شوند. فیلدی را خالی بگذار و «اعمال» را بزن تا آن استایل از عنصر حذف شود و سایت به CSS اصلی‌اش برگردد.
          </p>
        </div>
      ) : null}

      {tab === 'markup' ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="stack" style={{ gap: 6 }}>
            <span className="field__label"><Icon name="code" size={14} /> کلاس‌ها</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {classes.length === 0 ? <span style={{ color: 'var(--muted)', fontSize: 11 }}>کلاسی ندارد.</span> : null}
              {classes.map((name) => (
                <button key={name} className="badge" style={{ cursor: 'pointer' }} title="حذف کلاس"
                  onClick={() => {
                    const next = classes.filter((item) => item !== name)
                    setClasses(next)
                    commitClass(next.join(' '))
                  }}>
                  {name} ×
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <input className="input input--ltr" placeholder="new-class" value={newClass} onChange={(event) => setNewClass(event.target.value)} />
              <Button size="sm" onClick={() => {
                const name = newClass.trim()
                if (!name || classes.includes(name)) return
                const next = [...classes, name]
                setClasses(next)
                setNewClass('')
                commitClass(next.join(' '))
              }}>افزودن</Button>
            </div>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <span className="field__label"><Icon name="settings" size={14} /> ویژگی‌ها</span>
            <div className="stack" style={{ gap: 5 }}>
              {attrs.map((attr, index) => (
                <div key={`${attr.name}-${index}`} className="row" style={{ gap: 5 }}>
                  <input className="input input--ltr" style={{ flex: 1 }} value={attr.name} onChange={(event) => setAttrs((prev) => prev.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))} />
                  <input className="input input--ltr" style={{ flex: 2 }} value={attr.value} onChange={(event) => setAttrs((prev) => prev.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))} />
                  <Button size="sm" variant="ghost" icon="save" loading={saving} aria-label={`ذخیره ${attr.name}`} onClick={() => onSave({ type: 'attr', name: attr.name, value: attr.value })} />
                  <Button size="sm" variant="ghost" icon="trash" aria-label={`حذف ${attr.name}`} onClick={() => { setAttrs((prev) => prev.filter((_, i) => i !== index)); onSave({ type: 'removeAttr', name: attr.name }) }} />
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 5 }}>
              <input className="input input--ltr" placeholder="name" value={newAttr.name} onChange={(event) => setNewAttr((p) => ({ ...p, name: event.target.value }))} />
              <input className="input input--ltr" placeholder="value" value={newAttr.value} onChange={(event) => setNewAttr((p) => ({ ...p, value: event.target.value }))} />
              <Button size="sm" onClick={() => {
                const name = newAttr.name.trim()
                if (!name) return
                onSave({ type: 'attr', name, value: newAttr.value })
                setAttrs((prev) => [...prev.filter((item) => item.name !== name), { name, value: newAttr.value }])
                setNewAttr({ name: '', value: '' })
              }}>ثبت</Button>
            </div>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <button className="row" style={{ gap: 6, color: 'var(--muted)', fontSize: 11.5 }} onClick={() => setShowHtml((value) => !value)}>
              <Icon name={showHtml ? 'chevron' : 'code'} size={13} />
              {showHtml ? 'بستن ویرایش HTML' : 'ویرایش HTML این بخش'}
            </button>
            {showHtml ? (
              <>
                <textarea className="textarea input--ltr" style={{ minHeight: 130, fontFamily: 'var(--mono, monospace)', fontSize: 11 }} value={html} onChange={(event) => setHtml(event.target.value)} />
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="primary" icon="save" loading={saving} onClick={() => onSave({ type: 'html', html })}>جایگزینی محتوا</Button>
                  <Button size="sm" onClick={() => onSave({ type: 'insertAfter', html })}>افزودن بعد از</Button>
                  <Button size="sm" onClick={() => onSave({ type: 'insertBefore', html })}>افزودن قبل از</Button>
                </div>
              </>
            ) : null}
          </div>

          <div className="alert" style={{ gap: 8 }}>
            <Icon name="trash" size={15} />
            <span>حذف کامل عنصر از صفحه:</span>
            <Button size="sm" variant="danger" onClick={() => { onSave({ type: 'remove' }); }} disabled={saving}>حذف عنصر</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BoxEditor({
  title,
  keys,
  labels,
  styles,
  onChange
}: {
  title: string
  keys: string[]
  labels: string[]
  styles: Record<string, string>
  onChange: (key: string, value: string) => void
}): React.JSX.Element {
  return (
    <div className="stack" style={{ gap: 5 }}>
      <span className="field__label">{title}</span>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {keys.map((key, index) => (
          <input
            key={key}
            className="input input--ltr"
            style={{ minHeight: 28, fontSize: 11 }}
            title={labels[index]}
            placeholder={labels[index]}
            value={styles[key] ?? ''}
            onChange={(event) => onChange(key, event.target.value)}
          />
        ))}
      </div>
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
  allowTransparent = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  allowTransparent?: boolean
}): React.JSX.Element {
  const hex = rgbToHex(value)
  return (
    <Field label={allowTransparent ? `${label} (شفاف)` : label}>
      <div className="color-row">
        <input type="color" value={hex} onChange={(event) => onChange(event.target.value)} />
        <input className="input input--ltr" value={value} placeholder="rgba(0,0,0,0)" onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  )
}

function TreeNode({
  node,
  onOpen,
  active,
  depth
}: {
  node: FileNode
  onOpen: (node: FileNode) => void
  active: boolean
  depth: number
}): React.JSX.Element {
  const [open, setOpen] = useState(depth < 1)
  if (node.isDirectory) {
    return (
      <div>
        <button className="file-tree__row" style={{ paddingInlineStart: 6 + depth * 12 }} onClick={() => setOpen((value) => !value)}>
          <Icon name="chevron" size={12} style={{ transform: open ? 'rotate(-90deg)' : 'none', transition: 'transform .12s' }} />
          <Icon name="folder" size={14} />
          <span>{node.name}</span>
          <span style={{ marginInlineStart: 'auto', color: 'var(--muted)', fontSize: 10 }}>{node.children?.length ?? 0}</span>
        </button>
        {open
          ? (node.children ?? []).map((child) => (
              <TreeNode key={child.path} node={child} onOpen={onOpen} active={active} depth={depth + 1} />
            ))
          : null}
      </div>
    )
  }
  return (
    <button
      className="file-tree__row"
      data-active={active}
      style={{ paddingInlineStart: 6 + depth * 12 }}
      onClick={() => onOpen(node)}
      title={node.relativePath}
    >
      <Icon name={/\.html?$/i.test(node.name) ? 'code' : /\.(png|jpe?g|svg|webp|gif)$/i.test(node.name) ? 'image' : 'file'} size={13} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
    </button>
  )
}

function flatten(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = []
  const walk = (items: FileNode[]): void => {
    for (const item of items) {
      result.push(item)
      if (item.children) walk(item.children)
    }
  }
  walk(nodes)
  return result
}

function encodePath(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

/** Color pickers only take hex; keep any rgb()/hex value renderable. */
function rgbToHex(value: string): string {
  const trimmed = (value ?? '').trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map((char) => `${char}${char}`).join('')}`
  }
  const match = trimmed.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[\s,]+([\d.]+))?\s*\)/)
  if (!match) return '#000000'
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  if (alpha === 0) return '#ffffff'
  const hex = (number: string): string => Number(number).toString(16).padStart(2, '0')
  return `#${hex(match[1])}${hex(match[2])}${hex(match[3])}`
}
