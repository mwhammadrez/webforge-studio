import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditAction, EditEventRecord, EditorTarget, FileNode, PreviewState, Project } from '@shared/types'
import { useApp } from '../store'
import { Button, Empty, Field, SectionTitle, statusBadge } from '../components/ui'
import { Icon } from '../components/Icon'
import { errorMessage, unwrap } from '../lib/api'
import { date, fa } from '../lib/format'

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

  const loadProject = useCallback(
    async (target: Project) => {
      try {
        const [nodes, state, edits] = await Promise.all([
          unwrap(window.webforge.projects.tree(target.id)),
          unwrap(window.webforge.preview.state(target.id)),
          unwrap(window.webforge.editor.history(target.id))
        ])
        setTree(nodes)
        setPreview(state)
        setPreviewGlobal(state)
        setHistory(edits)
        const root = nodes.find((node) => node.isDirectory && node.name === 'clean')
        const files = flatten(root ? (root.children ?? []) : nodes).filter(
          (node) => !node.isDirectory && /\.html?$/i.test(node.name) && node.name !== 'admin.html'
        )
        const initial =
          files.find((node) => /\.html?$/i.test(node.relativePath) && /(^|\/)index\.html?$/i.test(node.relativePath)) ??
          files[0]
        if (initial) {
          setPageFile(initial.relativePath)
          setSelectPage(initial.relativePath)
          setPagePath(toPagePath(initial.relativePath))
          setActivePath(initial.relativePath)
        }
        if (!state.running) {
          setStarting(true)
          const next = await unwrap(window.webforge.preview.start(target.id))
          setPreview(next)
          setPreviewGlobal(next)
        }
      } catch (error) {
        toast('error', 'باز کردن پروژه ناموفق بود', errorMessage(error))
      } finally {
        setStarting(false)
      }
    },
    [setPreviewGlobal, toast]
  )

  useEffect(() => {
    if (project) void loadProject(project)
  }, [project, loadProject])

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string; target?: EditorTarget; pagePath?: string }
      if (!data || typeof data !== 'object') return
      if (data.type === 'webforge:select' && data.target) {
        setSelected(data.target)
        const page = data.pagePath ?? ''
        setPagePath(page)
        setPageFile(hasClean ? `clean/${page}` : page)
      }
      if (data.type === 'webforge:ready') {
        setPagePath(data.pagePath ?? '')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [hasClean])

  function sendToFrame(payload: unknown): void {
    frameRef.current?.contentWindow?.postMessage(payload, '*')
  }

  useEffect(() => {
    sendToFrame({ type: 'webforge:mode', enabled: selectMode })
  }, [selectMode, preview?.running])

  const reloadPreview = (): void => {
    if (!preview?.url) return
    const target = `${preview.url}/${encodePath(toPagePath(pageFile))}?t=${Date.now()}`
    if (frameRef.current) frameRef.current.src = target
    sendToFrame({ type: 'webforge:mode', enabled: selectMode })
  }

  const stopPreview = async (): Promise<void> => {
    if (!project) return
    try {
      const state = await unwrap(window.webforge.preview.stop(project.id))
      setPreview(state)
      setPreviewGlobal(state)
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
      const state = await unwrap(window.webforge.preview.start(project.id))
      setPreview(state)
      setPreviewGlobal(state)
    } catch (error) {
      toast('error', 'اجرای پیش‌نمایش ناموفق بود', errorMessage(error))
    } finally {
      setStarting(false)
    }
  }

  const save = async (action: EditAction): Promise<void> => {
    if (!project || !selected) return
    setSaving(true)
    try {
      const summary = await unwrap(
        window.webforge.editor.save({
          projectId: project.id,
          file: pageFile,
          selector: selected.selector,
          action,
          fallbackText: selected.text
        })
      )
      sendToFrame({
        type: 'webforge:apply',
        selector: selected.selector,
        kind: action.type,
        name: action.type === 'style' || action.type === 'attr' ? action.name : undefined,
        value:
          action.type === 'text'
            ? action.text
            : action.type === 'attr'
              ? action.value
              : action.type === 'style'
                ? action.value
                : action.type === 'image'
                  ? action.src
                  : action.href
      })
      const edits = await unwrap(window.webforge.editor.history(project.id))
      setHistory(edits)
      toast('success', 'تغییرات ذخیره شد', `پشتیبان: ${summary.backupPath}`)
    } catch (error) {
      toast('error', 'ذخیرهٔ تغییر ناموفق بود', errorMessage(error))
    } finally {
      setSaving(false)
    }
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
      toast('success', 'تصویر جایگزین شد')
    } catch (error) {
      toast('error', 'جایگزینی تصویر ناموفق بود', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const undo = async (): Promise<void> => {
    if (!project) return
    try {
      await unwrap(window.webforge.editor.undo(project.id))
      setHistory(await unwrap(window.webforge.editor.history(project.id)))
      reloadPreview()
      toast('success', 'آخرین تغییر بازگردانی شد')
    } catch (error) {
      toast('error', 'بازگردانی ناموفق بود', errorMessage(error))
    }
  }

  const redo = async (): Promise<void> => {
    if (!project) return
    try {
      await unwrap(window.webforge.editor.redo(project.id))
      setHistory(await unwrap(window.webforge.editor.history(project.id)))
      reloadPreview()
      toast('success', 'تغییر دوباره اعمال شد')
    } catch (error) {
      toast('error', 'اجرای دوباره ناموفق بود', errorMessage(error))
    }
  }

  const openFile = async (node: FileNode): Promise<void> => {
    if (!project) return
    if (/\.html?$/i.test(node.name)) {
      const relative = toPagePath(node.relativePath)
      setPageFile(node.relativePath)
      setSelectPage(node.relativePath)
      setActivePath(node.relativePath)
      if (frameRef.current && preview?.url) {
        frameRef.current.src = `${preview.url}/${encodePath(relative)}?t=${Date.now()}`
      }
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
            <h1 className="page-header__title" style={{ fontSize: 19 }}>{project.name}</h1>
            <div className="path" style={{ maxWidth: 460 }}>{project.path}</div>
          </div>
          {statusBadge(project.status)}
          {preview?.running ? <span className="badge badge--success">پیش‌نمایش فعال</span> : <span className="badge">پیش‌نمایش متوقف</span>}
        </div>
        <div className="row row--wrap">
          <Button size="sm" variant={selectMode ? 'primary' : 'default'} icon="edit" onClick={() => setSelectMode((value) => !value)} disabled={!preview?.running}>
            {selectMode ? 'حالت انتخاب فعال' : 'حالت انتخاب'}
          </Button>
          <Button size="sm" variant="ghost" icon="undo" onClick={() => void undo()} disabled={!history.some((item) => !item.reverted)}>Undo</Button>
          <Button size="sm" variant="ghost" icon="redo" onClick={() => void redo()} disabled={!history.some((item) => item.reverted)}>Redo</Button>
          {preview?.running ? (
            <>
              <Button size="sm" variant="ghost" icon="refresh" onClick={reloadPreview}>بارگذاری مجدد</Button>
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
              <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 10.5 }}>{selectMode ? 'روی بخش موردنظر کلیک کن' : 'برای ویرایش، حالت انتخاب را فعال کن'}</span>
            </div>
          </div>
          {previewSrc ? (
            <iframe
              ref={frameRef}
              className="preview-frame"
              title="پیش‌نمایش سایت"
              src={previewSrc}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              onLoad={() => sendToFrame({ type: 'webforge:mode', enabled: selectMode })}
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
                  <span>حالت انتخاب را روشن کن و روی متن، عکس، دکمه یا هر بخش کلیک کن.</span>
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
  onReplaceImage
}: {
  target: EditorTarget
  saving: boolean
  onSave: (action: EditAction) => void
  onReplaceImage: () => void
}): React.JSX.Element {
  const [text, setText] = useState(target.text)
  const [href, setHref] = useState(target.attrs.href ?? '')
  const [targetAttr, setTargetAttr] = useState(target.attrs.target ?? '_self')
  const [imageSrc, setImageSrc] = useState(target.imageSrc ?? target.attrs.src ?? '')
  const [alt, setAlt] = useState(target.attrs.alt ?? '')
  const [color, setColor] = useState(rgbToHex(target.styles.color))
  const [background, setBackground] = useState(rgbToHex(target.styles.backgroundColor))
  const [fontSize, setFontSize] = useState(target.styles.fontSize)
  const [fontWeight, setFontWeight] = useState(target.styles.fontWeight)
  const [padding, setPadding] = useState(target.styles.paddingTop)
  const [margin, setMargin] = useState(target.styles.marginTop)
  const [radius, setRadius] = useState(target.styles.borderRadius)
  const [display, setDisplay] = useState(target.styles.display)

  const isImage = target.tag === 'img' || target.tag === 'picture' || target.tag === 'video'
  const isLink = target.tag === 'a'

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="selector-pill">{target.selector}</div>

      {!isImage ? (
        <div className="stack" style={{ gap: 6 }}>
          <span className="field__label"><Icon name="type" size={14} /> متن</span>
          <textarea className="textarea" style={{ minHeight: 74 }} value={text} onChange={(event) => setText(event.target.value)} />
          <Button size="sm" variant="primary" icon="save" loading={saving} onClick={() => onSave({ type: 'text', text })}>
            ذخیرهٔ متن
          </Button>
        </div>
      ) : null}

      {isImage ? (
        <div className="stack" style={{ gap: 6 }}>
          <span className="field__label"><Icon name="image" size={14} /> تصویر</span>
          <input className="input input--ltr" value={imageSrc} onChange={(event) => setImageSrc(event.target.value)} />
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
          <input className="input input--ltr" value={href} onChange={(event) => setHref(event.target.value)} />
          <select className="select" value={targetAttr} onChange={(event) => setTargetAttr(event.target.value)}>
            <option value="_self">همین پنجره</option>
            <option value="_blank">پنجرهٔ جدید</option>
            <option value="_parent">پنجرهٔ والد</option>
            <option value="_top">بالاترین پنجره</option>
          </select>
          <Button size="sm" variant="primary" icon="save" onClick={() => onSave({ type: 'link', href, target: targetAttr })}>ذخیرهٔ لینک</Button>
        </div>
      ) : null}

      <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <span className="field__label"><Icon name="palette" size={14} /> استایل</span>
        <div className="grid grid--2" style={{ gap: 8 }}>
          <Field label="رنگ متن">
            <div className="color-row">
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
              <input className="input input--ltr" value={color} onChange={(event) => setColor(event.target.value)} />
            </div>
          </Field>
          <Field label="پس‌زمینه">
            <div className="color-row">
              <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
              <input className="input input--ltr" value={background} onChange={(event) => setBackground(event.target.value)} />
            </div>
          </Field>
        </div>
        <div className="grid grid--2" style={{ gap: 8 }}>
          <Field label="اندازهٔ فونت"><input className="input input--ltr" value={fontSize} onChange={(event) => setFontSize(event.target.value)} /></Field>
          <Field label="وزن فونت"><input className="input input--ltr" value={fontWeight} onChange={(event) => setFontWeight(event.target.value)} /></Field>
          <Field label="پدینگ"><input className="input input--ltr" value={padding} onChange={(event) => setPadding(event.target.value)} /></Field>
          <Field label="مارجین"><input className="input input--ltr" value={margin} onChange={(event) => setMargin(event.target.value)} /></Field>
          <Field label="گردی گوشه"><input className="input input--ltr" value={radius} onChange={(event) => setRadius(event.target.value)} /></Field>
          <Field label="نمایش">
            <select className="select" value={display} onChange={(event) => setDisplay(event.target.value)}>
              <option value="block">block</option>
              <option value="inline">inline</option>
              <option value="inline-block">inline-block</option>
              <option value="flex">flex</option>
              <option value="grid">grid</option>
              <option value="none">none (مخفی)</option>
            </select>
          </Field>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <Button size="sm" onClick={() => onSave({ type: 'style', name: 'color', value: color })}>رنگ متن</Button>
          <Button size="sm" onClick={() => onSave({ type: 'style', name: 'background-color', value: background })}>پس‌زمینه</Button>
          <Button size="sm" onClick={() => onSave({ type: 'style', name: 'font-size', value: fontSize })}>اندازه</Button>
          <Button size="sm" onClick={() => onSave({ type: 'style', name: 'font-weight', value: fontWeight })}>وزن</Button>
          <Button size="sm" onClick={() => onSave({ type: 'style', name: 'padding', value: padding })}>پدینگ</Button>
          <Button size="sm" onClick={() => onSave({ type: 'style', name: 'margin', value: margin })}>مارجین</Button>
          <Button size="sm" onClick={() => onSave({ type: 'style', name: 'border-radius', value: radius })}>گردی</Button>
          <Button size="sm" onClick={() => onSave({ type: 'style', name: 'display', value: display })}>نمایش</Button>
        </div>
      </div>
    </div>
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

function rgbToHex(value: string): string {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return '#000000'
  const hex = (number: string): string => Number(number).toString(16).padStart(2, '0')
  return `#${hex(match[1])}${hex(match[2])}${hex(match[3])}`
}
