import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExtractionProgress, ExtractionReport } from '@shared/types'
import { useApp } from '../store'
import { Button, Field, Progress, SectionTitle } from '../components/ui'
import { Icon } from '../components/Icon'
import { errorMessage, unwrap } from '../lib/api'
import { bytes, duration, fa } from '../lib/format'

export default function Extract(): React.JSX.Element {
  const { settings } = useApp()
  const toast = useApp((state) => state.toast)
  const refreshProjects = useApp((state) => state.refreshProjects)
  const navigate = useApp((state) => state.navigate)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [outputRoot, setOutputRoot] = useState<string>('')
  const [maxFiles, setMaxFiles] = useState(settings?.extraction.maxFiles ?? 500)
  const [maxBytesMb, setMaxBytesMb] = useState(settings?.extraction.maxBytesMb ?? 300)
  const [maxDepth, setMaxDepth] = useState(settings?.extraction.maxDepth ?? 2)
  const [timeoutSeconds, setTimeoutSeconds] = useState(settings?.extraction.timeoutSeconds ?? 180)
  const [rendered, setRendered] = useState(false)
  const [includeExternalAssets, setIncludeExternalAssets] = useState(false)
  const [respectRobots, setRespectRobots] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ExtractionProgress | null>(null)
  const [report, setReport] = useState<ExtractionReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const projectIdRef = useRef<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.webforge.extract.onProgress((next) => {
      projectIdRef.current = next.projectId
      setProgress(next)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (settings && !nameTouched && !name) {
      setName('')
    }
  }, [settings, nameTouched, name])

  const validUrl = useMemo(() => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }, [url])

  const suggestName = (value: string): void => {
    setUrl(value)
    if (nameTouched) return
    try {
      const parsed = new URL(value)
      const host = parsed.hostname.replace(/^www\./, '')
      setName(host)
    } catch {
      // Keep the current name until the URL becomes valid.
    }
  }

  const chooseFolder = async (): Promise<void> => {
    try {
      const folder = await unwrap(window.webforge.app.pickFolder('پوشهٔ مقصد پروژه'))
      if (folder) setOutputRoot(folder)
    } catch (err) {
      toast('error', 'انتخاب پوشه ناموفق بود', errorMessage(err))
    }
  }

  const start = async (): Promise<void> => {
    setError(null)
    setReport(null)
    setProgress(null)
    if (!validUrl) {
      setError('آدرس سایت معتبر نیست. آدرس باید با http:// یا https:// شروع شود.')
      return
    }
    if (!name.trim()) {
      setError('نام پروژه را وارد کن.')
      return
    }
    setRunning(true)
    projectIdRef.current = null
    try {
      const result = await unwrap(
        window.webforge.extract.start({
          url: url.trim(),
          name: name.trim(),
          outputRoot: outputRoot || undefined,
          maxFiles,
          maxBytesMb,
          maxDepth,
          timeoutSeconds,
          rendered,
          includeExternalAssets,
          respectRobots
        })
      )
      setReport(result)
      setRunning(false)
      await refreshProjects()
      toast(result.partial ? 'warn' : 'success', result.partial ? 'استخراج با هشدار کامل شد' : 'استخراج کامل شد', `${fa(result.pages)} صفحه و ${fa(result.assets)} دارایی`)
    } catch (err) {
      setRunning(false)
      setError(errorMessage(err))
    }
  }

  const cancel = async (): Promise<void> => {
    if (!projectIdRef.current) return
    try {
      await unwrap(window.webforge.extract.cancel(projectIdRef.current))
    } catch (err) {
      toast('error', 'لغو استخراج ناموفق بود', errorMessage(err))
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">استخراج سایت</h1>
          <p className="page-header__sub">
            آدرس یک سایت عمومی را وارد کن تا HTML، CSS، JavaScript، تصاویر و فونت‌ها با ساختار قابل‌ویرایش ذخیره شوند.
            پوشهٔ خام در <span className="code">mirror/</span> و نسخهٔ قابل‌اجرا در <span className="code">clean/</span> ساخته می‌شود.
          </p>
        </div>
      </div>

      <div className="grid grid--2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(300px, 1fr)' }}>
        <section className="card card--pad stack">
          <SectionTitle title="مشخصات استخراج" hint="فقط سایت‌هایی را استخراج کن که مالک آن هستی یا اجازهٔ تحلیل داری." />
          <Field label="آدرس سایت" required hint="مثال: https://example.com — آدرس‌های localhost و شبکهٔ داخلی مسدود هستند.">
            <input
              className="input input--ltr"
              value={url}
              onChange={(event) => suggestName(event.target.value)}
              placeholder="https://example.com"
              dir="ltr"
              disabled={running}
            />
          </Field>
          <div className="grid grid--2">
            <Field label="نام پروژه" required>
              <input className="input" value={name} onChange={(event) => { setName(event.target.value); setNameTouched(true) }} placeholder="نام سایت" disabled={running} />
            </Field>
            <Field label="پوشهٔ مقصد" hint={outputRoot || settings?.projectsDir}>
              <div className="row">
                <input className="input path" value={outputRoot || settings?.projectsDir || ''} readOnly dir="ltr" />
                <Button variant="ghost" icon="folder" onClick={() => void chooseFolder()} disabled={running} aria-label="انتخاب پوشه" />
              </div>
            </Field>
          </div>

          <div className="section-title" style={{ marginTop: 4 }}>
            <h3>گزینه‌های پیشرفته</h3>
          </div>
          <div className="grid grid--3">
            <Field label="حداکثر فایل">
              <input className="input" type="number" value={maxFiles} min={1} max={20000} onChange={(event) => setMaxFiles(Number(event.target.value))} disabled={running} />
            </Field>
            <Field label="حداکثر حجم (MB)">
              <input className="input" type="number" value={maxBytesMb} min={1} max={20480} onChange={(event) => setMaxBytesMb(Number(event.target.value))} disabled={running} />
            </Field>
            <Field label="عمق خزش">
              <input className="input" type="number" value={maxDepth} min={0} max={20} onChange={(event) => setMaxDepth(Number(event.target.value))} disabled={running} />
            </Field>
          </div>
          <div className="grid grid--2">
            <Field label="زمان مجاز (ثانیه)">
              <input className="input" type="number" value={timeoutSeconds} min={10} max={3600} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} disabled={running} />
            </Field>
            <div className="stack" style={{ gap: 8, paddingTop: 22 }}>
              <label className="checkbox">
                <input type="checkbox" checked={respectRobots} onChange={(event) => setRespectRobots(event.target.checked)} disabled={running} />
                رعایت robots.txt
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={includeExternalAssets} onChange={(event) => setIncludeExternalAssets(event.target.checked)} disabled={running} />
                دانلود دارایی‌های دامنه‌های دیگر
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={rendered} onChange={(event) => setRendered(event.target.checked)} disabled={running} />
                حالت رندرشده (سایت‌های JavaScript‌دار)
              </label>
            </div>
          </div>

          {error ? (
            <div className="alert alert--error">
              <Icon name="alert" size={17} />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="row" style={{ marginTop: 4 }}>
            <Button variant="primary" icon="download" onClick={() => void start()} loading={running} disabled={running}>
              شروع استخراج
            </Button>
            {running ? (
              <Button variant="danger" icon="stop" onClick={() => void cancel()}>
                لغو
              </Button>
            ) : null}
            <span className="spacer" />
            <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>
              {validUrl ? 'آدرس معتبر به نظر می‌رسد.' : 'آدرس را کامل وارد کن.'}
            </span>
          </div>
        </section>

        <section className="card card--pad stack">
          <SectionTitle title="پیشرفت" hint="گزارش زندهٔ دانلود و هشدارها" />
          {!progress && !report ? (
            <div className="empty" style={{ padding: '34px 10px' }}>
              <div className="empty__icon">
                <Icon name="globe" size={24} />
              </div>
              <h3>آمادهٔ شروع</h3>
              <p>آدرس سایت را وارد کن تا استخراج شروع شود.</p>
            </div>
          ) : null}

          {progress && running ? (
            <>
              <div className="row row--between" style={{ fontSize: 12.5 }}>
                <span className="row" style={{ gap: 7 }}>
                  <span className="status-dot status-dot--on" />
                  {progress.message}
                </span>
                <span style={{ color: 'var(--muted)' }}>{duration(progress.elapsedMs)}</span>
              </div>
              <Progress value={progress.completed} total={progress.total} indeterminate={progress.phase !== 'downloading'} />
              <div className="grid grid--3" style={{ gap: 8 }}>
                <MiniStat label="دانلود" value={fa(progress.completed)} />
                <MiniStat label="کل" value={fa(progress.total)} />
                <MiniStat label="حجم" value={bytes(progress.bytes)} />
              </div>
              <div className="path">{progress.currentUrl}</div>
              <div className="alert alert--info">
                <Icon name="shield" size={16} />
                <span>هر دارایی قبل از دانلود از نظر آدرس عمومی بررسی می‌شود؛ JavaScript سایت اجرا نمی‌شود.</span>
              </div>
            </>
          ) : null}

          {report ? (
            <>
              <div className={`alert ${report.partial ? 'alert--warn' : 'alert--success'}`}>
                <Icon name={report.partial ? 'alert' : 'check'} size={17} />
                <span>{report.partial ? 'استخراج با هشدار کامل شد؛ فایل‌های سالم حفظ شدند.' : 'استخراج کامل شد.'}</span>
              </div>
              <div className="grid grid--2" style={{ gap: 8 }}>
                <MiniStat label="صفحات" value={fa(report.pages)} />
                <MiniStat label="دارایی‌ها" value={fa(report.assets)} />
                <MiniStat label="حجم" value={bytes(report.bytes)} />
                <MiniStat label="نادیده‌گرفته" value={fa(report.skipped)} />
              </div>
              {report.warnings.length > 0 ? (
                <div className="stack" style={{ gap: 6, maxHeight: 180, overflow: 'auto' }}>
                  {report.warnings.slice(0, 12).map((warning, index) => (
                    <div key={`${warning.url}-${index}`} className="alert alert--warn" style={{ padding: '7px 9px', fontSize: 11 }}>
                      <span className="path" style={{ flex: 1 }}>{warning.url}</span>
                      <span>{warning.reason}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Button variant="primary" icon="edit" onClick={() => navigate('workspace', report.projectId)}>
                  باز کردن در ویرایشگر
                </Button>
                <Button icon="folder" onClick={() => void window.webforge.app.openPath(report.projectPath)}>
                  پوشهٔ پروژه
                </Button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 11px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontWeight: 750, fontSize: 14 }}>{value}</div>
    </div>
  )
}
