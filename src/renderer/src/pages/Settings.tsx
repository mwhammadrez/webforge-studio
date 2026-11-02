import { useEffect, useState } from 'react'
import type { Diagnostics } from '@shared/types'
import { useApp } from '../store'
import { Button, Field, KeyValue, SectionTitle } from '../components/ui'
import { Icon } from '../components/Icon'
import { errorMessage, unwrap } from '../lib/api'
import { fa } from '../lib/format'

type Section = 'general' | 'extraction' | 'ai' | 'data'

export default function Settings(): React.JSX.Element {
  const { settings, projects } = useApp()
  const refreshSettings = useApp((state) => state.refreshSettings)
  const toast = useApp((state) => state.toast)
  const [section, setSection] = useState<Section>('general')
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [form, setForm] = useState({
    theme: settings?.theme ?? 'dark',
    projectsDir: settings?.projectsDir ?? '',
    pluginDir: settings?.pluginDir ?? '',
    portStart: settings?.portStart ?? 5173,
    portEnd: settings?.portEnd ?? 5273,
    aiBaseUrl: settings?.aiBaseUrl ?? 'https://api.deepseek.com',
    aiModel: settings?.aiModel ?? 'deepseek-flash',
    maxFiles: settings?.extraction.maxFiles ?? 500,
    maxBytesMb: settings?.extraction.maxBytesMb ?? 300,
    maxDepth: settings?.extraction.maxDepth ?? 2,
    timeoutSeconds: settings?.extraction.timeoutSeconds ?? 180,
    concurrency: settings?.extraction.concurrency ?? 4
  })

  useEffect(() => {
    if (!settings) return
    setForm({
      theme: settings.theme,
      projectsDir: settings.projectsDir,
      pluginDir: settings.pluginDir,
      portStart: settings.portStart,
      portEnd: settings.portEnd,
      aiBaseUrl: settings.aiBaseUrl,
      aiModel: settings.aiModel,
      maxFiles: settings.extraction.maxFiles,
      maxBytesMb: settings.extraction.maxBytesMb,
      maxDepth: settings.extraction.maxDepth,
      timeoutSeconds: settings.extraction.timeoutSeconds,
      concurrency: settings.extraction.concurrency
    })
  }, [settings])

  useEffect(() => {
    void (async () => {
      try {
        setDiagnostics(await unwrap(window.webforge.diagnostics.get()))
      } catch {
        setDiagnostics(null)
      }
    })()
  }, [section])

  if (!settings) return <div className="page">در حال بارگذاری…</div>

  const saveGeneral = async (): Promise<void> => {
    setBusy(true)
    try {
      document.documentElement.dataset.theme = form.theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : form.theme
      await unwrap(window.webforge.settings.update({
        theme: form.theme as 'dark' | 'light' | 'system',
        projectsDir: form.projectsDir,
        pluginDir: form.pluginDir,
        portStart: Number(form.portStart),
        portEnd: Number(form.portEnd)
      }))
      await refreshSettings()
      toast('success', 'تنظیمات عمومی ذخیره شد')
    } catch (error) {
      toast('error', 'ذخیرهٔ تنظیمات ناموفق بود', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const saveExtraction = async (): Promise<void> => {
    setBusy(true)
    try {
      await unwrap(window.webforge.settings.update({
        extraction: {
          maxFiles: Number(form.maxFiles),
          maxBytesMb: Number(form.maxBytesMb),
          maxDepth: Number(form.maxDepth),
          timeoutSeconds: Number(form.timeoutSeconds),
          concurrency: Number(form.concurrency)
        }
      }))
      await refreshSettings()
      toast('success', 'محدودیت‌های استخراج ذخیره شد')
    } catch (error) {
      toast('error', 'ذخیرهٔ تنظیمات ناموفق بود', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const saveAi = async (): Promise<void> => {
    setBusy(true)
    try {
      await unwrap(window.webforge.settings.update({
        aiBaseUrl: form.aiBaseUrl,
        aiModel: form.aiModel,
        ...(apiKey.trim() ? { aiKey: apiKey.trim() } : {})
      }))
      setApiKey('')
      await refreshSettings()
      toast('success', 'تنظیمات هوش مصنوعی ذخیره شد')
    } catch (error) {
      toast('error', 'ذخیرهٔ تنظیمات ناموفق بود', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const testAi = async (): Promise<void> => {
    setTesting(true)
    try {
      const result = await unwrap(window.webforge.settings.testAi())
      toast(result.ok ? 'success' : 'error', result.message, result.models?.slice(0, 5).join('، '))
    } catch (error) {
      toast('error', 'تست اتصال ناموفق بود', errorMessage(error))
    } finally {
      setTesting(false)
    }
  }

  const clearKey = async (): Promise<void> => {
    try {
      await unwrap(window.webforge.settings.update({ aiKey: '' }))
      await refreshSettings()
      toast('success', 'کلید API پاک شد')
    } catch (error) {
      toast('error', 'پاک کردن کلید ناموفق بود', errorMessage(error))
    }
  }

  const pick = async (key: 'projectsDir' | 'pluginDir'): Promise<void> => {
    const folder = await unwrap(window.webforge.app.pickFolder(key === 'projectsDir' ? 'پوشهٔ پروژه‌ها' : 'پوشهٔ ابزارها'))
    if (folder) setForm((current) => ({ ...current, [key]: folder }))
  }

  const exportData = async (): Promise<void> => {
    try {
      const path = await unwrap(window.webforge.settings.exportData())
      if (path) toast('success', 'خروجی ذخیره شد', path)
    } catch (error) {
      toast('error', 'خروجی گرفتن ناموفق بود', errorMessage(error))
    }
  }

  const reset = async (): Promise<void> => {
    try {
      await unwrap(window.webforge.settings.reset())
      await refreshSettings()
      toast('success', 'تنظیمات به حالت پیش‌فرض بازگشت')
    } catch (error) {
      toast('error', 'بازنشانی ناموفق بود', errorMessage(error))
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">تنظیمات</h1>
          <p className="page-header__sub">ظاهر، مسیرها، محدودیت‌های استخراج، کلید هوش مصنوعی و داده‌های محلی.</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-nav">
          {[
            { key: 'general', label: 'عمومی و ظاهر' },
            { key: 'extraction', label: 'استخراج' },
            { key: 'ai', label: 'هوش مصنوعی' },
            { key: 'data', label: 'داده و عیب‌یابی' }
          ].map((item) => (
            <button key={item.key} data-active={section === item.key} onClick={() => setSection(item.key as Section)}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="stack">
          {section === 'general' ? (
            <section className="card card--pad stack">
              <SectionTitle title="ظاهر" hint="تم فوراً روی کل برنامه اعمال می‌شود." />
              <div className="grid grid--3" style={{ gap: 8 }}>
                {([
                  { key: 'dark', label: 'تیره', desc: 'خاکستری روشن' },
                  { key: 'light', label: 'روشن', desc: 'سفید و تمیز' },
                  { key: 'system', label: 'سیستم', desc: 'هماهنگ با ویندوز' }
                ] as const).map((theme) => (
                  <button
                    key={theme.key}
                    className="card"
                    style={{
                      padding: 12,
                      textAlign: 'start',
                      cursor: 'pointer',
                      borderColor: form.theme === theme.key ? 'var(--accent)' : 'var(--border)',
                      background: form.theme === theme.key ? 'var(--accent-soft)' : 'var(--panel)'
                    }}
                    onClick={() => setForm((current) => ({ ...current, theme: theme.key }))}
                  >
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>{theme.label}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{theme.desc}</div>
                  </button>
                ))}
              </div>

              <Field label="پوشهٔ پیش‌فرض پروژه‌ها">
                <div className="row">
                  <input className="input path" value={form.projectsDir} onChange={(event) => setForm((current) => ({ ...current, projectsDir: event.target.value }))} dir="ltr" />
                  <Button variant="ghost" icon="folder" onClick={() => void pick('projectsDir')} aria-label="انتخاب" />
                </div>
              </Field>
              <Field label="پوشهٔ ابزارها">
                <div className="row">
                  <input className="input path" value={form.pluginDir} onChange={(event) => setForm((current) => ({ ...current, pluginDir: event.target.value }))} dir="ltr" />
                  <Button variant="ghost" icon="folder" onClick={() => void pick('pluginDir')} aria-label="انتخاب" />
                </div>
              </Field>
              <div className="grid grid--2">
                <Field label="شروع بازهٔ پورت"><input className="input" type="number" value={form.portStart} onChange={(event) => setForm((current) => ({ ...current, portStart: Number(event.target.value) }))} /></Field>
                <Field label="پایان بازهٔ پورت"><input className="input" type="number" value={form.portEnd} onChange={(event) => setForm((current) => ({ ...current, portEnd: Number(event.target.value) }))} /></Field>
              </div>
              <div className="row">
                <Button variant="primary" icon="save" onClick={() => void saveGeneral()} loading={busy}>ذخیره</Button>
              </div>
            </section>
          ) : null}

          {section === 'extraction' ? (
            <section className="card card--pad stack">
              <SectionTitle title="پیش‌فرض‌های استخراج" hint="این مقادیر فقط پیشنهاد فرم هستند؛ قبل از هر اجرا قابل تغییرند." />
              <div className="grid grid--2">
                <Field label="حداکثر فایل"><input className="input" type="number" value={form.maxFiles} onChange={(event) => setForm((current) => ({ ...current, maxFiles: Number(event.target.value) }))} /></Field>
                <Field label="حداکثر حجم (MB)"><input className="input" type="number" value={form.maxBytesMb} onChange={(event) => setForm((current) => ({ ...current, maxBytesMb: Number(event.target.value) }))} /></Field>
                <Field label="عمق خزش"><input className="input" type="number" value={form.maxDepth} onChange={(event) => setForm((current) => ({ ...current, maxDepth: Number(event.target.value) }))} /></Field>
                <Field label="زمان مجاز (ثانیه)"><input className="input" type="number" value={form.timeoutSeconds} onChange={(event) => setForm((current) => ({ ...current, timeoutSeconds: Number(event.target.value) }))} /></Field>
                <Field label="هم‌زمانی دانلود" hint="بین ۱ تا ۸؛ مقدار کمتر مؤدبانه‌تر است."><input className="input" type="number" min={1} max={8} value={form.concurrency} onChange={(event) => setForm((current) => ({ ...current, concurrency: Number(event.target.value) }))} /></Field>
              </div>
              <div className="alert alert--info"><Icon name="shield" size={15} /><span>آدرس‌های private، loopback و link-local همیشه مسدود می‌شوند؛ این محدودیت قابل تغییر نیست.</span></div>
              <div className="row"><Button variant="primary" icon="save" onClick={() => void saveExtraction()} loading={busy}>ذخیره</Button></div>
            </section>
          ) : null}

          {section === 'ai' ? (
            <section className="card card--pad stack">
              <SectionTitle title="سرویس هوش مصنوعی" hint="کلید فقط در فرایند اصلی و با safeStorage سیستم رمز می‌شود." />
              <div className="grid grid--2">
                <Field label="آدرس سرویس"><input className="input input--ltr" value={form.aiBaseUrl} onChange={(event) => setForm((current) => ({ ...current, aiBaseUrl: event.target.value }))} /></Field>
                <Field label="مدل">
                  <select className="select" value={form.aiModel} onChange={(event) => setForm((current) => ({ ...current, aiModel: event.target.value }))}>
                    <option value="deepseek-flash">deepseek-flash</option>
                    <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                  </select>
                </Field>
              </div>
              <Field label="کلید API" hint={settings.aiKeyConfigured ? 'کلید ذخیره شده است. برای تغییر، کلید جدید را وارد کن.' : 'کلید را فقط در همین فیلد وارد کن؛ در چت یا فایل پروژه نگذار.'}>
                <input className="input input--ltr" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.aiKeyConfigured ? '••••••••••••••••' : 'sk-…'} autoComplete="off" />
              </Field>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Button variant="primary" icon="save" onClick={() => void saveAi()} loading={busy}>ذخیره</Button>
                <Button icon="activity" onClick={() => void testAi()} loading={testing} disabled={!settings.aiKeyConfigured}>تست اتصال</Button>
                {settings.aiKeyConfigured ? <Button variant="ghost" icon="trash" onClick={() => void clearKey()}>پاک کردن کلید</Button> : null}
              </div>
              <div className={`alert ${settings.aiKeyConfigured ? 'alert--success' : 'alert--warn'}`}>
                <Icon name={settings.aiKeyConfigured ? 'check' : 'alert'} size={15} />
                <span>{settings.aiKeyConfigured ? 'کلید تنظیم شده و آمادهٔ استفاده است.' : 'بدون کلید، ساخت با AI غیرفعال است و درخواستی ارسال نمی‌شود.'}</span>
              </div>
            </section>
          ) : null}

          {section === 'data' ? (
            <>
              <section className="card card--pad stack">
                <SectionTitle title="داده‌ها" hint="همه‌چیز محلی است؛ هیچ پروژه‌ای به سرویس ابری فرستاده نمی‌شود." />
                <div className="grid grid--3" style={{ gap: 8 }}>
                  <Metric label="پروژه‌ها" value={fa(diagnostics?.counts.projects ?? projects.length)} />
                  <Metric label="ابزارها" value={fa(diagnostics?.counts.plugins ?? 0)} />
                  <Metric label="ویرایش‌ها" value={fa(diagnostics?.counts.edits ?? 0)} />
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Button icon="download" onClick={() => void exportData()}>خروجی JSON</Button>
                  <Button icon="folder" onClick={() => diagnostics && void window.webforge.app.openPath(diagnostics.userData)}>پوشهٔ دادهٔ برنامه</Button>
                  <Button icon="terminal" onClick={() => diagnostics && void window.webforge.app.openPath(diagnostics.logsDir)}>لاگ‌ها</Button>
                  <Button variant="danger" icon="refresh" onClick={() => void reset()}>بازنشانی تنظیمات</Button>
                </div>
                <div className="alert alert--warn"><Icon name="alert" size={15} /><span>بازنشانی تنظیمات، پروژه‌ها و فایل‌های سایت را حذف نمی‌کند.</span></div>
              </section>

              <section className="card card--pad stack">
                <SectionTitle title="عیب‌یابی" hint="وضعیت نسخه‌ها، سرورها و خطاهای اخیر" />
                {diagnostics ? (
                  <>
                    <KeyValue label="نسخهٔ برنامه" value={diagnostics.appVersion} />
                    <KeyValue label="Electron / Chromium" value={`${diagnostics.electron} / ${diagnostics.chrome}`} mono />
                    <KeyValue label="Node" value={diagnostics.node} mono />
                    <KeyValue label="سیستم" value={`${diagnostics.platform} ${diagnostics.arch}`} mono />
                    <KeyValue label="پایگاه داده" value={diagnostics.dbPath} mono />
                    <KeyValue label="پوشهٔ لاگ" value={diagnostics.logsDir} mono />
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <span className="badge">پیش‌نمایش فعال: {fa(diagnostics.activePreviews.length)}</span>
                      <span className="badge">ابزار در حال اجرا: {fa(diagnostics.runningPlugins.length)}</span>
                    </div>
                    {diagnostics.recentErrors.length > 0 ? (
                      <div className="stack" style={{ gap: 4, maxHeight: 220, overflow: 'auto' }}>
                        {diagnostics.recentErrors.map((error, index) => (
                          <div key={index} className="alert alert--error" style={{ padding: '6px 9px', fontSize: 10.5 }}>
                            <span className="code">{error.code}</span>
                            <span>{error.message}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="alert alert--success"><Icon name="check" size={15} /><span>خطای اخیری ثبت نشده است.</span></div>
                    )}
                  </>
                ) : (
                  <div style={{ color: 'var(--muted)' }}>در حال خواندن اطلاعات…</div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontWeight: 750 }}>{value}</div>
    </div>
  )
}
