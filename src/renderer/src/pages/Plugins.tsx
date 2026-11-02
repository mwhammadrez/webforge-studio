import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstallDepsResult, Plugin, PluginInput, PluginRun, PluginRunEvent } from '@shared/types'
import { useApp } from '../store'
import { Button, Confirm, Empty, Field, Modal, SectionTitle, statusBadge } from '../components/ui'
import { Icon } from '../components/Icon'
import { errorMessage, unwrap } from '../lib/api'
import { date, fa, timeAgo } from '../lib/format'

export default function Plugins(): React.JSX.Element {
  const { projects, activeProjectId } = useApp()
  const toast = useApp((state) => state.toast)
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [runningPlugin, setRunningPlugin] = useState<Plugin | null>(null)
  const [runs, setRuns] = useState<PluginRun[]>([])
  const [removing, setRemoving] = useState<Plugin | null>(null)
  const [depResult, setDepResult] = useState<InstallDepsResult | null>(null)
  const [depLoading, setDepLoading] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, history] = await Promise.all([
        unwrap(window.webforge.plugins.list()),
        unwrap(window.webforge.plugins.runs())
      ])
      setPlugins(list)
      setRuns(history)
    } catch (error) {
      toast('error', 'خواندن ابزارها ناموفق بود', errorMessage(error))
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const addPlugin = async (): Promise<void> => {
    try {
      const plugin = await unwrap(window.webforge.plugins.addManifest())
      if (!plugin) return
      await load()
      toast('success', 'ابزار ثبت شد', plugin.displayName)
    } catch (error) {
      toast('error', 'افزودن ابزار ناموفق بود', errorMessage(error))
    }
  }

  const installDeps = async (plugin: Plugin): Promise<void> => {
    setDepLoading(plugin.id)
    try {
      const result = await unwrap(window.webforge.plugins.installDependencies(plugin.id))
      setDepResult(result)
      await load()
      toast(result.ok ? 'success' : 'error', result.ok ? 'وابستگی‌ها نصب شدند' : 'نصب وابستگی‌ها ناموفق بود')
    } catch (error) {
      toast('error', 'نصب وابستگی‌ها ناموفق بود', errorMessage(error))
    } finally {
      setDepLoading(null)
    }
  }

  const toggle = async (plugin: Plugin): Promise<void> => {
    try {
      await unwrap(window.webforge.plugins.toggle(plugin.id, !plugin.enabled))
      await load()
    } catch (error) {
      toast('error', 'تغییر وضعیت ناموفق بود', errorMessage(error))
    }
  }

  const remove = async (): Promise<void> => {
    if (!removing) return
    try {
      await unwrap(window.webforge.plugins.remove(removing.id))
      setRemoving(null)
      await load()
      toast('success', 'ابزار حذف شد')
    } catch (error) {
      toast('error', 'حذف ابزار ناموفق بود', errorMessage(error))
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">ابزارها</h1>
          <p className="page-header__sub">
            ابزارهای داخلی و پلاگین‌های خودت. هر ابزار با مانیفست، فرم فارسی خودکار، لاگ زنده، محدودیت زمان و مجوزهای صریح اجرا می‌شود.
          </p>
        </div>
        <div className="page-header__actions">
          <Button icon="plus" onClick={() => void addPlugin()}>افزودن ابزار</Button>
        </div>
      </div>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <div className="stack">
          {plugins.length === 0 ? (
            <div className="card">
              <Empty icon="layers" title="هنوز ابزاری نداری" description="پوشه یا مانیفست ابزار را اضافه کن." action={<Button variant="primary" icon="plus" onClick={() => void addPlugin()}>افزودن ابزار</Button>} />
            </div>
          ) : null}
          {plugins.map((plugin) => (
            <section key={plugin.id} className="card card--pad">
              <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <span className="action-card__icon" style={{ flex: '0 0 auto' }}>
                    <Icon name={plugin.runtime === 'builtin' ? 'panel' : plugin.runtime === 'python' ? 'cpu' : 'terminal'} size={18} />
                  </span>
                  <div>
                    <div className="row" style={{ gap: 7 }}>
                      <span style={{ fontWeight: 750, fontSize: 14 }}>{plugin.displayName}</span>
                      {plugin.runtime === 'builtin' ? <span className="badge badge--accent">داخلی</span> : null}
                      {!plugin.enabled ? <span className="badge">غیرفعال</span> : null}
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 3, maxWidth: 480 }}>{plugin.description}</div>
                  </div>
                </div>
                {statusBadge(plugin.lastStatus)}
              </div>
              <div className="row row--wrap" style={{ gap: 6, marginTop: 10 }}>
                <span className="badge mono">{plugin.name}@{plugin.version}</span>
                <span className="badge">{plugin.runtime}</span>
                {plugin.requiresNetwork ? <span className="badge badge--warn"><Icon name="globe" size={11} /> شبکه</span> : null}
                {plugin.requiresProjectWrite ? <span className="badge badge--warn"><Icon name="save" size={11} /> نوشتن در پروژه</span> : null}
                <span className="badge"><Icon name="clock" size={11} /> {plugin.lastRunAt ? timeAgo(plugin.lastRunAt) : 'اجرا نشده'}</span>
                {plugin.runtime === 'node' ? (
                  <span className={`badge ${plugin.hasDependencies ? 'badge--success' : 'badge--warn'}`}>
                    {plugin.hasDependencies ? 'وابستگی آماده' : 'وابستگی نصب نشده'}
                  </span>
                ) : null}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <Button size="sm" variant="primary" icon="play" onClick={() => setRunningPlugin(plugin)} disabled={!plugin.enabled}>
                  اجرا
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggle(plugin)}>
                  {plugin.enabled ? 'غیرفعال' : 'فعال'}
                </Button>
                {plugin.runtime === 'node' ? (
                  <Button size="sm" variant="ghost" icon="cpu" onClick={() => void installDeps(plugin)} loading={depLoading === plugin.id}>
                    نصب وابستگی‌ها
                  </Button>
                ) : null}
                <span className="spacer" />
                {plugin.runtime !== 'builtin' ? (
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(plugin)} aria-label="حذف" />
                ) : null}
              </div>
            </section>
          ))}
        </div>

        <section className="card">
          <div style={{ padding: '14px 16px 8px' }}>
            <SectionTitle title="تاریخچهٔ اجرا" hint="آخرین اجراهای همهٔ ابزارها" />
          </div>
          {runs.length === 0 ? (
            <Empty icon="terminal" title="هنوز اجرایی ثبت نشده" />
          ) : (
            <div className="list">
              {runs.slice(0, 15).map((run) => {
                const plugin = plugins.find((item) => item.id === run.pluginId)
                return (
                  <div key={run.id} className="list__item" style={{ alignItems: 'flex-start' }}>
                    <span className="list__icon"><Icon name="terminal" size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row row--between">
                        <span className="list__title">{plugin?.displayName ?? run.pluginId}</span>
                        {statusBadge(run.status)}
                      </div>
                      <div className="list__meta" style={{ direction: 'rtl', textAlign: 'right' }}>
                        {date(run.startedAt)} — کد خروج {run.exitCode === null ? '—' : fa(run.exitCode)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {runningPlugin ? (
        <RunModal
          plugin={runningPlugin}
          projects={projects}
          defaultProjectId={activeProjectId ?? projects[0]?.id ?? null}
          onClose={() => { setRunningPlugin(null); void load() }}
        />
      ) : null}

      {depResult ? (
        <Modal
          title={depResult.ok ? 'وابستگی‌ها نصب شدند' : 'نصب وابستگی‌ها ناموفق بود'}
          onClose={() => setDepResult(null)}
          width={820}
          footer={<Button variant="primary" onClick={() => setDepResult(null)}>بستن</Button>}
        >
          <div className="stack">
            <div className={`alert ${depResult.ok ? 'alert--success' : 'alert--error'}`}>
              <Icon name={depResult.ok ? 'check' : 'alert'} size={16} />
              <span>کد خروج: {depResult.exitCode === null ? '—' : fa(depResult.exitCode)}</span>
            </div>
            <pre className="log" style={{ maxHeight: 380 }}>{depResult.logs || 'خروجی نداشت.'}</pre>
          </div>
        </Modal>
      ) : null}

      {removing ? (
        <Confirm
          title="حذف ابزار"
          danger
          confirmLabel="حذف ثبت"
          onClose={() => setRemoving(null)}
          onConfirm={() => void remove()}
          message={<span>ثبت ابزار <b>{removing.displayName}</b> حذف می‌شود، اما فایل‌های اصلی خودت دست‌نخورده می‌مانند.</span>}
        />
      ) : null}
    </div>
  )
}

function RunModal({
  plugin,
  projects,
  defaultProjectId,
  onClose
}: {
  plugin: Plugin
  projects: Array<{ id: string; name: string }>
  defaultProjectId: string | null
  onClose: () => void
}): React.JSX.Element {
  const toast = useApp((state) => state.toast)
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => {
    const initial: Record<string, string | number | boolean> = {}
    for (const input of plugin.manifest.inputs) {
      if (input.default !== undefined) initial[input.key] = input.default
      if (input.type === 'projectPath' && defaultProjectId) initial[input.key] = defaultProjectId
    }
    return initial
  })
  const [runProjectId, setRunProjectId] = useState<string | null>(defaultProjectId)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [result, setResult] = useState<{ status: string; outputs: string[]; logPath: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const unsubscribe = window.webforge.plugins.onEvent((event: PluginRunEvent) => {
      if (runId && event.runId !== runId) return
      if (!runId) setRunId(event.runId)
      if (event.chunk) setLogs((current) => [...current.slice(-2000), event.chunk])
    })
    return unsubscribe
  }, [runId])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs])

  const pickPath = async (input: PluginInput): Promise<void> => {
    try {
      const value = input.type === 'folder'
        ? await unwrap(window.webforge.app.pickFolder(input.label))
        : await unwrap(window.webforge.app.pickFile('any'))
      if (value) setValues((current) => ({ ...current, [input.key]: value }))
    } catch (err) {
      toast('error', 'انتخاب مسیر ناموفق بود', errorMessage(err))
    }
  }

  const start = async (): Promise<void> => {
    setError(null)
    setLogs([])
    setResult(null)
    for (const input of plugin.manifest.inputs) {
      if (input.required && (values[input.key] === undefined || values[input.key] === '')) {
        setError(`فیلد «${input.label}» الزامی است.`)
        return
      }
    }
    setRunning(true)
    try {
      const response = await unwrap(window.webforge.plugins.run(plugin.id, runProjectId, values))
      setRunId(response.run.id)
      setResult({ status: response.run.status, outputs: response.outputPaths, logPath: response.run.logPath })
      setLogs(response.logs.split('\n'))
      toast(response.run.status === 'success' ? 'success' : 'warn', response.run.status === 'success' ? 'ابزار با موفقیت اجرا شد' : 'اجرای ابزار با هشدار تمام شد')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (!runId) return
    try {
      await unwrap(window.webforge.plugins.cancel(runId))
    } catch (err) {
      toast('error', 'لغو اجرا ناموفق بود', errorMessage(err))
    }
  }

  const projectInput = useMemo(() => plugin.manifest.inputs.find((input) => input.type === 'projectPath'), [plugin])

  return (
    <Modal
      title={`اجرای ${plugin.displayName}`}
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{result ? 'بستن' : 'انصراف'}</Button>
          {running ? <Button variant="danger" icon="stop" onClick={() => void cancel()}>توقف</Button> : <Button variant="primary" icon="play" onClick={() => void start()}>اجرا</Button>}
        </>
      }
    >
      <div className="stack">
        <div className="alert alert--info">
          <Icon name="shield" size={16} />
          <span>
            اجرا با محدودیت زمان {fa(plugin.manifest.timeoutSeconds)} ثانیه، محیط محدود و لاگ کامل. مجوزها: شبکه {plugin.requiresNetwork ? 'بله' : 'خیر'} — نوشتن در پروژه {plugin.requiresProjectWrite ? 'بله' : 'خیر'}.
          </span>
        </div>

        {!projectInput ? (
          <Field label="پروژه (اختیاری)" hint="اگر ابزار به فایل‌های پروژه نیاز ندارد، خالی بگذار.">
            <select className="select" value={runProjectId ?? ''} onChange={(event) => setRunProjectId(event.target.value || null)}>
              <option value="">بدون پروژه</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </Field>
        ) : null}

        {plugin.manifest.inputs.map((input) => (
          <InputField
            key={input.key}
            input={input}
            value={values[input.key]}
            projects={projects}
            onChange={(value) => {
              setValues((current) => ({ ...current, [input.key]: value }))
              if (input.type === 'projectPath' && typeof value === 'string') setRunProjectId(value || null)
            }}
            onPick={() => void pickPath(input)}
          />
        ))}

        {error ? <div className="alert alert--error"><Icon name="alert" size={16} /><span>{error}</span></div> : null}

        {logs.length > 0 || running ? (
          <div>
            <div className="row row--between" style={{ marginBottom: 6 }}>
              <span className="field__label"><Icon name="terminal" size={14} /> لاگ زنده</span>
              {running ? <span className="badge badge--info">در حال اجرا…</span> : result ? statusBadge(result.status) : null}
            </div>
            <div className="log" ref={logRef}>
              {logs.map((line, index) => (
                <div key={index} className={/error|failed|خطا/i.test(line) ? 'log__line--err' : /^\[system\]/.test(line) ? 'log__line--sys' : ''}>{line}</div>
              ))}
              {logs.length === 0 ? <span style={{ color: '#64748b' }}>در انتظار خروجی…</span> : null}
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row">
              <span className="badge">{fa(result.outputs.length)} خروجی</span>
              <span className="path" style={{ flex: 1 }}>{result.logPath}</span>
            </div>
            {result.outputs.map((output) => (
              <div key={output} className="row" style={{ background: 'var(--panel-2)', padding: '7px 9px', borderRadius: 8 }}>
                <Icon name="file" size={14} />
                <span className="path" style={{ flex: 1 }}>{output}</span>
                <Button size="sm" variant="ghost" icon="folder" onClick={() => void window.webforge.app.openPath(output)} aria-label="باز کردن" />
              </div>
            ))}
            {plugin.name === 'admin-panel' ? (
              <div className="alert alert--success">
                <Icon name="check" size={16} />
                <span>پنل نصب شد. از صفحهٔ ویرایشگر پیش‌نمایش را اجرا کن و مسیر <span className="code">/admin.html</span> را باز کن.</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function InputField({
  input,
  value,
  projects,
  onChange,
  onPick
}: {
  input: PluginInput
  value: string | number | boolean | undefined
  projects: Array<{ id: string; name: string }>
  onChange: (value: string | number | boolean) => void
  onPick: () => void
}): React.JSX.Element {
  if (input.type === 'projectPath') {
    return (
      <Field label={input.label} required={input.required} hint={input.help}>
        <select className="select" value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">انتخاب پروژه…</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </Field>
    )
  }
  if (input.type === 'boolean') {
    return (
      <label className="checkbox">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{input.label}</span>
      </label>
    )
  }
  if (input.type === 'select') {
    return (
      <Field label={input.label} required={input.required} hint={input.help}>
        <select className="select" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
          <option value="">انتخاب…</option>
          {(input.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </Field>
    )
  }
  if (input.type === 'textarea') {
    return (
      <Field label={input.label} required={input.required} hint={input.help}>
        <textarea className="textarea" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} placeholder={input.placeholder} />
      </Field>
    )
  }
  if (input.type === 'folder' || input.type === 'file') {
    return (
      <Field label={input.label} required={input.required} hint={input.help}>
        <div className="row">
          <input className="input path" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} dir="ltr" />
          <Button variant="ghost" icon="folder" onClick={onPick} aria-label="انتخاب مسیر" />
        </div>
      </Field>
    )
  }
  return (
    <Field label={input.label} required={input.required} hint={input.help}>
      <input
        className={`input ${input.type === 'url' || input.type === 'number' ? 'input--ltr' : ''}`}
        type={input.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={(event) => onChange(input.type === 'number' ? Number(event.target.value) : event.target.value)}
        placeholder={input.placeholder}
      />
    </Field>
  )
}
