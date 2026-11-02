import { useMemo, useState } from 'react'
import type { Project } from '@shared/types'
import { useApp } from '../store'
import { Button, Confirm, Empty, Field, Modal, statusBadge } from '../components/ui'
import { Icon } from '../components/Icon'
import { errorMessage, unwrap } from '../lib/api'
import { fa, shortDate, timeAgo } from '../lib/format'

export default function Projects(): React.JSX.Element {
  const { projects } = useApp()
  const refreshProjects = useApp((state) => state.refreshProjects)
  const navigate = useApp((state) => state.navigate)
  const toast = useApp((state) => state.toast)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<Project | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [removing, setRemoving] = useState<Project | null>(null)
  const [deleteFiles, setDeleteFiles] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        project.path.toLowerCase().includes(needle) ||
        (project.sourceUrl ?? '').toLowerCase().includes(needle)
    )
  }, [projects, query])

  const openFolder = async (): Promise<void> => {
    try {
      const project = await unwrap(window.webforge.projects.openDialog())
      if (!project) return
      await refreshProjects()
      navigate('workspace', project.id)
    } catch (error) {
      toast('error', 'باز کردن پوشه ناموفق بود', errorMessage(error))
    }
  }

  const create = async (): Promise<void> => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      const project = await unwrap(window.webforge.projects.create(newName.trim()))
      await refreshProjects()
      setCreating(false)
      setNewName('')
      navigate('workspace', project.id)
      toast('success', 'پروژه ساخته شد')
    } catch (error) {
      toast('error', 'ساخت پروژه ناموفق بود', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const rename = async (): Promise<void> => {
    if (!renaming || !renameValue.trim()) return
    try {
      await unwrap(window.webforge.projects.rename(renaming.id, renameValue.trim()))
      await refreshProjects()
      setRenaming(null)
      toast('success', 'نام پروژه تغییر کرد')
    } catch (error) {
      toast('error', 'تغییر نام ناموفق بود', errorMessage(error))
    }
  }

  const remove = async (): Promise<void> => {
    if (!removing) return
    try {
      const result = await unwrap(window.webforge.projects.remove(removing.id, deleteFiles))
      await refreshProjects()
      setRemoving(null)
      setDeleteFiles(false)
      toast('success', 'پروژه از فهرست حذف شد', result.movedTo ? `فایل‌ها به ${result.movedTo} منتقل شدند.` : undefined)
    } catch (error) {
      toast('error', 'حذف پروژه ناموفق بود', errorMessage(error))
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">پروژه‌ها</h1>
          <p className="page-header__sub">همهٔ سایت‌های محلی، پوشه‌های استخراج‌شده و پروژه‌های ساخته‌شده با AI.</p>
        </div>
        <div className="page-header__actions">
          <Button icon="folder" onClick={() => void openFolder()}>
            باز کردن پوشه
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            پروژهٔ جدید
          </Button>
        </div>
      </div>

      <div className="card" style={{ padding: 10, marginBottom: 14 }}>
        <div className="row">
          <Icon name="search" size={16} />
          <input
            className="input"
            style={{ border: 0, background: 'transparent', minHeight: 34 }}
            placeholder="جستجو در نام، مسیر یا آدرس سایت…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="badge">{fa(filtered.length)} پروژه</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <Empty
            icon="folder"
            title="هنوز پروژه‌ای نداری"
            description="برای شروع، یک سایت را استخراج کن، پوشه‌ای را باز کن، یا با هوش مصنوعی سایت بساز."
            action={
              <div className="row">
                <Button variant="primary" icon="download" onClick={() => navigate('extract')}>
                  استخراج سایت
                </Button>
                <Button icon="sparkles" onClick={() => navigate('ai')}>
                  ساخت با AI
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="grid grid--2">
          {filtered.map((project) => (
            <div key={project.id} className="card" style={{ padding: 15 }}>
              <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                <div className="row" style={{ gap: 10, minWidth: 0 }}>
                  <span className="list__icon">
                    <Icon name={project.type === 'static' ? 'globe' : 'code'} size={16} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 750, fontSize: 14 }}>{project.name}</div>
                    <div className="path" style={{ maxWidth: 330 }}>{project.path}</div>
                  </div>
                </div>
                {statusBadge(project.status)}
              </div>
              <div className="row row--wrap" style={{ gap: 6, marginTop: 11 }}>
                <span className="badge badge--info">{project.type === 'static' ? 'استاتیک' : project.type === 'node' ? 'Node' : 'نامشخص'}</span>
                <span className="badge">
                  <Icon name="file" size={11} /> {fa(project.fileCount)} فایل
                </span>
                <span className="badge">
                  <Icon name="clock" size={11} /> {timeAgo(project.lastOpenedAt)}
                </span>
                {project.sourceUrl ? <span className="badge">{new URL(project.sourceUrl).hostname}</span> : null}
              </div>
              <div className="row" style={{ marginTop: 13 }}>
                <Button size="sm" variant="primary" icon="edit" onClick={() => navigate('workspace', project.id)}>
                  باز کردن
                </Button>
                <Button size="sm" variant="ghost" icon="folder" onClick={() => void window.webforge.app.openPath(project.path)}>
                  پوشه
                </Button>
                <span className="spacer" />
                <Button size="sm" variant="ghost" onClick={() => { setRenaming(project); setRenameValue(project.name) }} aria-label="تغییر نام">
                  تغییر نام
                </Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(project)} aria-label="حذف" />
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 9 }}>ساخته‌شده: {shortDate(project.createdAt)}</div>
            </div>
          ))}
        </div>
      )}

      {creating ? (
        <Modal
          title="پروژهٔ جدید"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreating(false)}>انصراف</Button>
              <Button variant="primary" onClick={() => void create()} loading={busy}>ساخت پوشه</Button>
            </>
          }
        >
          <Field label="نام پروژه" required hint="یک پوشهٔ خالی با همین نام در مسیر پیش‌فرض ساخته می‌شود.">
            <input className="input" value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus placeholder="مثلاً سایت شرکت" />
          </Field>
        </Modal>
      ) : null}

      {renaming ? (
        <Modal
          title="تغییر نام پروژه"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRenaming(null)}>انصراف</Button>
              <Button variant="primary" onClick={() => void rename()}>ذخیره</Button>
            </>
          }
        >
          <Field label="نام جدید" hint="مسیر پوشه تغییر نمی‌کند؛ فقط نام نمایشی.">
            <input className="input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
          </Field>
        </Modal>
      ) : null}

      {removing ? (
        <Confirm
          title="حذف پروژه"
          danger
          confirmLabel="حذف از فهرست"
          onClose={() => { setRemoving(null); setDeleteFiles(false) }}
          onConfirm={() => void remove()}
          message={
            <div className="stack">
              <p>
                پروژهٔ <b>{removing.name}</b> از فهرست برنامه حذف می‌شود.
              </p>
              <div className="path">{removing.path}</div>
              <label className="checkbox">
                <input type="checkbox" checked={deleteFiles} onChange={(event) => setDeleteFiles(event.target.checked)} />
                فایل‌ها هم به سبد بازیابی منتقل شوند (پوشه حذف نمی‌شود؛ به <span className="code">.webforge-trash</span> منتقل می‌شود).
              </label>
            </div>
          }
        />
      ) : null}
    </div>
  )
}
